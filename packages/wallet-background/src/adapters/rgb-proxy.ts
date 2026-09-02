import type {
  RgbReceivedConsignment,
  RgbTransport,
  RgbTransportConsignment,
} from '@unisat/rgb-service'

type JsonRpcResponse<T> = {
  result?: T
  error?: { code?: number; message?: string }
}

type ProxyConsignment = {
  consignment: string
  txid: string
}

type ProxyBatchConsignment = ProxyConsignment & {
  recipient_id: string
}

const NOT_FOUND_CODES = new Set([-302, -400])
const RGB_PROXY_REQUEST_TIMEOUT_MS = 10_000
const MAX_CONSIGNMENT_GET_MANY_RECIPIENTS = 100

function normalizeEndpoints(endpoints: string[]) {
  return endpoints
    .map(endpoint => endpoint.trim())
    .filter(Boolean)
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function toHttpEndpoint(endpoint: string) {
  const value = endpoint.startsWith('rpcs://')
    ? `https://${endpoint.slice('rpcs://'.length)}`
    : endpoint
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Unsupported RGB proxy endpoint: ${endpoint}`)
  }
  const hostname = url.hostname.toLowerCase()
  const isIpLiteral =
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    hostname.startsWith('[') ||
    hostname.includes(':')
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    isIpLiteral
  ) {
    throw new Error(`Unsupported RGB proxy endpoint: ${endpoint}`)
  }
  // Query strings and fragments are not part of an RGB proxy endpoint and
  // would otherwise make endpoint normalization ambiguous.
  if (url.search || url.hash) throw new Error(`Unsupported RGB proxy endpoint: ${endpoint}`)
  return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`
}

function rpcId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function readRpcResponse<T>(response: Response): Promise<JsonRpcResponse<T>> {
  let body: JsonRpcResponse<T>
  try {
    body = (await response.json()) as JsonRpcResponse<T>
  } catch {
    throw new Error(`RGB proxy returned an invalid JSON-RPC response (${response.status})`)
  }
  if (!response.ok) throw new Error(`RGB proxy request failed (${response.status})`)
  return body
}

async function postJson<T>(endpoint: string, method: string, params: Record<string, unknown>) {
  const response = await fetchWithTimeout(toHttpEndpoint(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId(), method, params }),
  })
  return readRpcResponse<T>(response)
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RGB_PROXY_REQUEST_TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function base64ToBytes(value: string) {
  const decoded = atob(value)
  return Uint8Array.from(decoded, character => character.charCodeAt(0))
}

async function postConsignment(endpoint: string, consignment: RgbTransportConsignment) {
  const form = new FormData()
  form.set('jsonrpc', '2.0')
  form.set('id', rpcId())
  form.set('method', 'consignment.post')
  form.set('params[recipient_id]', consignment.recipientId)
  form.set('params[txid]', consignment.txid)
  form.set(
    'file',
    new Blob([base64ToBytes(consignment.payload)], { type: 'application/octet-stream' }),
    'consignment.rgb'
  )
  const response = await fetchWithTimeout(toHttpEndpoint(endpoint), { method: 'POST', body: form })
  const body = await readRpcResponse<boolean>(response)
  if (body.error)
    throw new Error(`RGB proxy consignment.post failed: ${body.error.message || body.error.code}`)
}

async function tryEndpoints<T>(endpoints: string[], request: (endpoint: string) => Promise<T>) {
  let lastError: unknown
  for (const endpoint of endpoints) {
    try {
      return await request(endpoint)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('RGB proxy endpoint is missing')
}

async function getConsignmentFromEndpoints({
  recipientId,
  endpoints,
}: {
  recipientId: string
  endpoints: string[]
}): Promise<RgbReceivedConsignment | undefined> {
  for (const endpoint of endpoints) {
    try {
      const body = await postJson<ProxyConsignment>(endpoint, 'consignment.get', {
        recipient_id: recipientId,
      })
      if (body.error) {
        if (NOT_FOUND_CODES.has(body.error.code || 0)) continue
        throw new Error(`RGB proxy consignment.get failed: ${body.error.message || body.error.code}`)
      }
      if (!body.result?.consignment || !body.result.txid) {
        throw new Error('RGB proxy returned an incomplete consignment')
      }
      return {
        recipientId,
        payload: body.result.consignment,
        txid: body.result.txid,
        endpoint,
      }
    } catch (error) {
      if (endpoint === endpoints[endpoints.length - 1]) throw error
    }
  }
  return undefined
}

export function createRgbProxyTransport(proxyEndpoints: string[] = []): RgbTransport {
  const endpoints = normalizeEndpoints(proxyEndpoints)
  // Only endpoints configured by the wallet are operated by us. Invoice
  // endpoints supplied by other wallets remain on the standard single-get
  // protocol path and never receive this extension request.
  const batchEndpoints = new Set(endpoints)
  const unsupportedBatchEndpoints = new Set<string>()
  return {
    getEndpoints: () => endpoints,

    publishConsignment: async consignment => {
      if (!consignment.endpoints.length)
        throw new Error('RGB invoice has no proxy transport endpoint')
      await tryEndpoints(consignment.endpoints, endpoint => postConsignment(endpoint, consignment))
    },

    getAcknowledgement: async consignment => {
      let pending = false
      let lastError: unknown
      for (const endpoint of consignment.endpoints) {
        try {
          const body = await postJson<boolean | null>(endpoint, 'ack.get', {
            recipient_id: consignment.recipientId,
          })
          if (body.error) {
            if (NOT_FOUND_CODES.has(body.error.code || 0)) {
              pending = true
              continue
            }
            throw new Error(`RGB proxy ack.get failed: ${body.error.message || body.error.code}`)
          }
          if (body.result === true || body.result === false) return body.result
          pending = true
        } catch (error) {
          lastError = error
        }
      }
      if (pending) return undefined
      throw lastError || new Error('RGB invoice has no proxy transport endpoint')
    },

    getConsignment: getConsignmentFromEndpoints,

    getConsignments: async inputs => {
      const grouped = new Map<string, Array<(typeof inputs)[number]>>()
      const individual: typeof inputs = []
      for (const input of inputs) {
        const [endpoint] = input.endpoints
        if (
          input.endpoints.length === 1 &&
          endpoint &&
          batchEndpoints.has(endpoint) &&
          !unsupportedBatchEndpoints.has(endpoint)
        ) {
          const group = grouped.get(endpoint) || []
          group.push(input)
          grouped.set(endpoint, group)
        } else {
          individual.push(input)
        }
      }
      for (const [endpoint, group] of grouped) {
        if (group.length > 1) continue
        individual.push(group[0]!)
        grouped.delete(endpoint)
      }

      const batched = await Promise.all(
        [...grouped.entries()].flatMap(([endpoint, group]) =>
          chunk(group, MAX_CONSIGNMENT_GET_MANY_RECIPIENTS).map(async group => {
            const recipientIds = [...new Set(group.map(input => input.recipientId))]
            const body = await postJson<ProxyBatchConsignment[]>(endpoint, 'consignment.get_many', {
              recipient_ids: recipientIds,
            })
            if (body.error) {
              // During a rolling proxy upgrade, retain compatibility with the
              // standard endpoint rather than failing receive polling.
              if (body.error.code === -32601) {
                unsupportedBatchEndpoints.add(endpoint)
                return Promise.all(group.map(input => getConsignmentFromEndpoints(input)))
              }
              throw new Error(
                `RGB proxy consignment.get_many failed: ${body.error.message || body.error.code}`
              )
            }
            if (!Array.isArray(body.result)) {
              throw new Error('RGB proxy returned an invalid consignment.get_many response')
            }
            const byRecipientId = new Map(body.result.map(item => [item.recipient_id, item]))
            return group.map(input => {
              const result = byRecipientId.get(input.recipientId)
              if (!result?.consignment || !result.txid) return undefined
              return {
                recipientId: input.recipientId,
                payload: result.consignment,
                txid: result.txid,
                endpoint,
              } satisfies RgbReceivedConsignment
            })
          })
        )
      )
      const individuallyFetched = await Promise.all(
        individual.map(input => getConsignmentFromEndpoints(input))
      )
      return [...batched.flat(), ...individuallyFetched].filter(
        (item): item is RgbReceivedConsignment => !!item
      )
    },

    checkConsignmentAvailability: async ({ recipientId, endpoints: invoiceEndpoints }) => {
      let occupiedEndpoints = 0
      let lastError: unknown
      for (const endpoint of invoiceEndpoints) {
        try {
          const body = await postJson<{ consignment?: string; txid?: string } | null>(
            endpoint,
            'consignment.get',
            { recipient_id: recipientId }
          )
          if (body.error) {
            if (NOT_FOUND_CODES.has(body.error.code || 0)) return true
            throw new Error(
              `RGB proxy consignment.get failed: ${body.error.message || body.error.code}`
            )
          }
          // A present consignment means this endpoint cannot accept another
          // upload for the same blinded recipient ID. `null` is treated as an
          // empty endpoint for proxy implementations that use JSON-RPC null
          // instead of a not-found error.
          if (!body.result?.consignment) return true
          occupiedEndpoints += 1
        } catch (error) {
          lastError = error
        }
      }
      if (occupiedEndpoints === invoiceEndpoints.length) return false
      throw lastError || new Error('Unable to check RGB invoice transport endpoint')
    },

    acknowledgeConsignment: async ({ recipientId, endpoints, acknowledged }) => {
      await tryEndpoints(endpoints, async endpoint => {
        const body = await postJson<boolean>(endpoint, 'ack.post', {
          recipient_id: recipientId,
          ack: acknowledged,
        })
        if (body.error)
          throw new Error(`RGB proxy ack.post failed: ${body.error.message || body.error.code}`)
      })
    },
  }
}
