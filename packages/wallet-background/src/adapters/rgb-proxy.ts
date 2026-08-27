import type {
  RgbReceivedConsignment,
  RgbTransport,
  RgbTransportConsignment,
} from '@unisat/rgb-service'

type JsonRpcResponse<T> = {
  result?: T
  error?: { code?: number; message?: string }
}

const NOT_FOUND_CODES = new Set([-302, -400])

function normalizeEndpoints(endpoints: string[]) {
  return endpoints
    .map(endpoint => endpoint.trim())
    .filter(Boolean)
}

function toHttpEndpoint(endpoint: string) {
  if (endpoint.startsWith('rpcs://')) return `https://${endpoint.slice('rpcs://'.length)}`
  if (endpoint.startsWith('rpc://')) return `http://${endpoint.slice('rpc://'.length)}`
  if (endpoint.startsWith('https://') || endpoint.startsWith('http://')) return endpoint
  throw new Error(`Unsupported RGB proxy endpoint: ${endpoint}`)
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
  const response = await fetch(toHttpEndpoint(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId(), method, params }),
  })
  return readRpcResponse<T>(response)
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
  const response = await fetch(toHttpEndpoint(endpoint), { method: 'POST', body: form })
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

export function createRgbProxyTransport(proxyEndpoints: string[] = []): RgbTransport {
  const endpoints = normalizeEndpoints(proxyEndpoints)
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

    getConsignment: async ({ recipientId, endpoints }) => {
      for (const endpoint of endpoints) {
        try {
          const body = await postJson<{ consignment: string; txid: string }>(
            endpoint,
            'consignment.get',
            {
              recipient_id: recipientId,
            }
          )
          if (body.error) {
            if (NOT_FOUND_CODES.has(body.error.code || 0)) continue
            throw new Error(
              `RGB proxy consignment.get failed: ${body.error.message || body.error.code}`
            )
          }
          if (!body.result?.consignment || !body.result.txid) {
            throw new Error('RGB proxy returned an incomplete consignment')
          }
          return {
            recipientId,
            payload: body.result.consignment,
            txid: body.result.txid,
            endpoint,
          } satisfies RgbReceivedConsignment
        } catch (error) {
          if (endpoint === endpoints[endpoints.length - 1]) throw error
        }
      }
      return undefined
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
