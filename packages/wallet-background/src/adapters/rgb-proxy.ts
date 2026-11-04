import type {
  RgbReceivedConsignment,
  RgbTransport,
  RgbTransportConsignment,
} from '@unisat/rgb-service'
import { rgbProxyInvoiceId, RgbProxyOperationNotFoundError } from '@unisat/rgb-service'
import { ed25519 } from '@noble/curves/ed25519'

import {
  proxyV1DecryptSignedTx,
  proxyV1DecryptBlob,
  proxyV1EncryptBlob,
  proxyV1EncryptSignedTx,
  proxyV1Hash,
  proxyV1Pow,
  proxyV1PublicKey,
  proxyV1Sign,
  proxyV1TransferId,
  proxyV1Verify,
} from './rgb-proxy-v1'

type JsonRpcResponse<T> = {
  result?: T
  error?: { code?: number; message?: string; data?: Record<string, unknown> }
}

type ProxyConsignment = {
  consignment: string
  txid: string
}

type ProxyBatchConsignment = ProxyConsignment & {
  recipient_id: string
}

type ProxyServerInfo = {
  protocol_version: string
  current_time: string
  max_expiry_secs: string
}

type ProxyV1Consignment = {
  consignment: string
  sender_transport_endpoint: string
  sender_pk: string
  consignment_hash: string
  batch: boolean
}

type ProxyV1AckResult = {
  acks: Record<string, boolean>
  signatures: Record<string, string>
}

const NOT_FOUND_CODES = new Set([-302, -400])
const RGB_PROXY_REQUEST_TIMEOUT_MS = 10_000
const MAX_CONSIGNMENT_GET_MANY_RECIPIENTS = 100

export type RgbProxyTransportOptions = {
  authorizeRequest?: (request: {
    endpoint: string
    operation: string
  }) => Promise<{ mode: 'direct' | 'relay' }>
  relayRequest?: (
    request: {
      endpoint: string
      operation: string
      contentType: string
      bodyBase64: string
    },
    signal: AbortSignal
  ) => Promise<{ status: number; contentType?: string; bodyBase64: string }>
}

function normalizeEndpoints(endpoints: string[]) {
  return endpoints.map(endpoint => endpoint.trim()).filter(Boolean)
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export function toHttpEndpoint(endpoint: string) {
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
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.startsWith('[') || hostname.includes(':')
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
  // `rid_nonce` is invoice metadata, not part of the RPC URL. It is consumed
  // by rgb-service to derive the proxy recipient key; strip it before fetch.
  // Reject all other query data so invoice text cannot alter the endpoint.
  if (url.hash) throw new Error(`Unsupported RGB proxy endpoint: ${endpoint}`)
  for (const key of [...url.searchParams.keys()]) {
    if (key !== 'rid_nonce') throw new Error(`Unsupported RGB proxy endpoint: ${endpoint}`)
    const value = url.searchParams.get(key)
    if (!value || !/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
      throw new Error(`Unsupported RGB proxy endpoint: ${endpoint}`)
    }
    url.searchParams.delete(key)
  }
  return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`
}

/** Older senders advertise rpc:// even when their proxy is reachable over TLS. */
function secureSenderEndpoint(endpoint: string) {
  return endpoint.startsWith('rpc://') ? `rpcs://${endpoint.slice('rpc://'.length)}` : endpoint
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

async function postJson<T>(
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
  options?: RgbProxyTransportOptions
) {
  const response = await fetchWithTimeout(
    toHttpEndpoint(endpoint),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId(), method, params }),
    },
    method,
    options
  )
  return readRpcResponse<T>(response)
}

function relayBodyBase64(
  body: NonNullable<Parameters<typeof fetch>[1]>['body'] | null | undefined
) {
  if (typeof body === 'string') return Buffer.from(body).toString('base64')
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('base64')
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('base64')
  }
  throw new Error('RGB proxy request body cannot be relayed')
}

async function waitForRelay<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([request, aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: NonNullable<Parameters<typeof fetch>[1]>,
  operation = 'request',
  options?: RgbProxyTransportOptions
) {
  const endpoint = String(input)
  const access = await options?.authorizeRequest?.({ endpoint, operation })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RGB_PROXY_REQUEST_TIMEOUT_MS)
  try {
    if (access?.mode === 'relay') {
      if (!options?.relayRequest) throw new Error('RGB proxy relay is not configured')
      const contentType = new Headers(init.headers).get('Content-Type') || ''
      const relayed = await waitForRelay(
        options.relayRequest(
          {
            endpoint,
            operation,
            contentType,
            bodyBase64: relayBodyBase64(init.body),
          },
          controller.signal
        ),
        controller.signal
      )
      return new Response(base64ToBytes(relayed.bodyBase64), {
        status: relayed.status,
        headers: relayed.contentType ? { 'Content-Type': relayed.contentType } : undefined,
      })
    }
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    })
    if (response.redirected || (response.url && toHttpEndpoint(response.url) !== endpoint)) {
      throw new Error('RGB proxy redirects are not allowed')
    }
    return response
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `RGB proxy ${operation} timed out after ${RGB_PROXY_REQUEST_TIMEOUT_MS / 1000} seconds`
      )
    }
    if (error instanceof TypeError) {
      throw new Error(
        `RGB proxy ${operation} could not connect to the endpoint: ${String(error.message || error)}`
      )
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function base64ToBytes(value: string) {
  const decoded = atob(value)
  return Uint8Array.from(decoded, character => character.charCodeAt(0))
}

async function postConsignment(
  endpoint: string,
  consignment: RgbTransportConsignment,
  options?: RgbProxyTransportOptions
) {
  // React Native cannot create Blob from ArrayBuffer/Uint8Array. Send the
  // same multipart fields as a binary request body, without changing bytes.
  const boundary = `----unisat-rgb-${rpcId()}`
  const fields = [
    ['jsonrpc', '2.0'],
    ['id', rpcId()],
    ['method', 'consignment.post'],
    ['params[recipient_id]', consignment.recipientId],
    ['params[txid]', consignment.txid],
  ]
  const encoder = new TextEncoder()
  const prefix = encoder.encode(
    fields
      .map(
        ([name, value]) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
      .join('') +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="consignment.rgb"\r\nContent-Type: application/octet-stream\r\n\r\n`
  )
  const payload = base64ToBytes(consignment.payload)
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`)
  const multipart = new Uint8Array(prefix.length + payload.length + suffix.length)
  multipart.set(prefix)
  multipart.set(payload, prefix.length)
  multipart.set(suffix, prefix.length + payload.length)
  const response = await fetchWithTimeout(
    toHttpEndpoint(endpoint),
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: multipart.buffer,
    },
    'consignment.post',
    options
  )
  const body = await readRpcResponse<boolean>(response)
  if (body.error)
    throw new Error(`RGB proxy consignment.post failed: ${body.error.message || body.error.code}`)
}

async function postProxyV1Consignment(
  endpoint: string,
  consignment: RgbTransportConsignment,
  senderEndpoints: string[],
  options?: RgbProxyTransportOptions
) {
  const invoiceId = consignment.proxyInvoiceId
  const recipientPublicKey = consignment.proxyRecipientPublicKey
  const senderPrivateKey = consignment.proxySenderPrivateKey
  const rawTx = consignment.signedRawTx
  if (!invoiceId || !recipientPublicKey || !senderPrivateKey || !rawTx) {
    throw new Error('RGB proxy v1 send state is incomplete')
  }
  const senderPublicKey = proxyV1PublicKey(senderPrivateKey)
  const transferId = proxyV1TransferId(invoiceId, senderPublicKey)
  const plaintext = base64ToBytes(consignment.payload)
  const consignmentHash = proxyV1Hash(plaintext)
  const file = consignment.proxyEncryption === 'unsupported'
    ? plaintext
    : proxyV1EncryptBlob(plaintext, senderPrivateKey, recipientPublicKey)
  const blobHash = proxyV1Hash(file)
  const check = await postJson<Record<string, { status: string; pow_difficulty: string }>>(
    endpoint,
    'invoice.check',
    {
      invoice_ids: [invoiceId],
    },
    options
  )
  if (check.error)
    throw new Error(`RGB proxy invoice.check failed: ${check.error.message || check.error.code}`)
  const invoiceStatus = check.result?.[invoiceId]
  if (!invoiceStatus || invoiceStatus.status === 'unknown') {
    throw new Error('RGB invoice is unavailable on the proxy')
  }
  let senderEndpoint = senderEndpoints[0] || endpoint
  if (!consignment.donation) {
    const signedTx = await proxyV1EncryptSignedTx(rawTx, senderPrivateKey, recipientPublicKey)
    senderEndpoint = await tryEndpoints(
      senderEndpoints.length ? senderEndpoints : [endpoint],
      async candidate => {
        const senderInfo = await postJson<ProxyServerInfo>(candidate, 'server.info', {}, options)
        if (senderInfo.error || senderInfo.result?.protocol_version !== '1.0') {
          throw new Error('RGB sender proxy does not support protocol v1')
        }
        const expiresAt = consignment.proxyExpirationTimestamp
        if (
          !expiresAt ||
          expiresAt <= Number(senderInfo.result.current_time) ||
          expiresAt >
            Number(senderInfo.result.current_time) + Number(senderInfo.result.max_expiry_secs)
        ) {
          throw new Error('RGB proxy sender operation expiration is invalid')
        }
        const prepared = await postJson<boolean>(
          candidate,
          'ack.prepare',
          {
            transfer_data: {
              [transferId]: {
                recipient_pk: recipientPublicKey,
                consignment_hash: consignmentHash,
                signed_tx: signedTx,
              },
            },
            expires_at: String(expiresAt),
            signed_tx_hash: proxyV1Hash(Buffer.from(rawTx, 'hex')),
            sender_pk: senderPublicKey,
          },
          options
        )
        if (prepared.error)
          throw new Error(
            `RGB proxy ack.prepare failed: ${prepared.error.message || prepared.error.code}`
          )
        return candidate
      }
    )
  }

  let difficulty = Number(invoiceStatus.pow_difficulty)
  for (let attempt = 0; attempt < 3; attempt++) {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = await proxyV1Pow(transferId, difficulty, timestamp)
    const boundary = `----unisat-rgb-${rpcId()}`
    const fields = [
      ['jsonrpc', '2.0'],
      ['id', rpcId()],
      ['method', 'consignment.post'],
      ['params[invoice_id]', invoiceId],
      ['params[transfer_id]', transferId],
      ['params[sender_transport_endpoint]', senderEndpoint],
      ['params[sender_pk]', senderPublicKey],
      ['params[consignment_hash]', consignmentHash],
      ['params[batch]', 'false'],
      ['params[file_size]', String(file.length)],
      ['params[signature]', proxyV1Sign(senderPrivateKey, transferId + consignmentHash + blobHash)],
      ['params[pow_timestamp]', timestamp],
      ['params[pow_nonce]', nonce],
    ]
    const encoder = new TextEncoder()
    const prefix = encoder.encode(
      fields
        .map(
          ([name, value]) =>
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
        )
        .join('') +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="consignment.rgb"\r\nContent-Type: application/octet-stream\r\n\r\n`
    )
    const suffix = encoder.encode(`\r\n--${boundary}--\r\n`)
    const multipart = new Uint8Array(prefix.length + file.length + suffix.length)
    multipart.set(prefix)
    multipart.set(file, prefix.length)
    multipart.set(suffix, prefix.length + file.length)
    const response = await fetchWithTimeout(
      toHttpEndpoint(endpoint),
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: multipart.buffer,
      },
      'consignment.post',
      options
    )
    const body = await readRpcResponse<boolean>(response)
    if (!body.error) return
    const required = body.error.code === -114 ? Number(body.error.data?.['pow_difficulty']) : NaN
    if (Number.isInteger(required) && required >= 0 && required <= 24 && attempt < 2) {
      difficulty = required
      continue
    }
    throw new Error(`RGB proxy consignment.post failed: ${body.error.message || body.error.code}`)
  }
}

async function getProxyV1Consignment(
  input: {
    recipientId: string
    endpoints: string[]
    proxyPrivateKey?: string
    encryption?: 'required' | 'unsupported' | 'optional'
  },
  options?: RgbProxyTransportOptions
): Promise<RgbReceivedConsignment | undefined> {
  const privateKey = input.proxyPrivateKey
  if (!privateKey) throw new Error('RGB proxy v1 invoice signing key is missing')
  const timestamp = String(Math.floor(Date.now() / 1000))
  let lastError: unknown
  let sawHealthyEndpoint = false
  let sawPendingTransfer = false
  for (const endpoint of input.endpoints) {
    try {
      const listed = await postJson<Record<string, string>>(
        endpoint,
        'transfer.list',
        {
          invoice_id: input.recipientId,
          timestamp,
          signature: proxyV1Sign(privateKey, input.recipientId + timestamp),
        },
        options
      )
      if (listed.error)
        throw new Error(
          `RGB proxy transfer.list failed: ${listed.error.message || listed.error.code}`
        )
      sawHealthyEndpoint = true
      const transferId = Object.entries(listed.result || {}).find(
        ([, status]) => status === 'pending'
      )?.[0]
      if (!transferId) continue
      sawPendingTransfer = true
      const received = await postJson<ProxyV1Consignment>(
        endpoint,
        'consignment.get',
        { transfer_id: transferId },
        options
      )
      if (received.error)
        throw new Error(
          `RGB proxy consignment.get failed: ${received.error.message || received.error.code}`
        )
      const result = received.result
      if (
        !result?.consignment ||
        !result.sender_pk ||
        !result.consignment_hash ||
        !result.sender_transport_endpoint
      ) {
        throw new Error('RGB proxy returned an incomplete v1 consignment')
      }
      if (proxyV1TransferId(input.recipientId, result.sender_pk) !== transferId) {
        throw new Error('RGB proxy returned a transfer with an invalid ID')
      }
      const blob = base64ToBytes(result.consignment)
      const cleartext = proxyV1Hash(blob) === result.consignment_hash
      const encryption = input.encryption ?? 'required'
      if (encryption === 'required' && cleartext) {
        throw new Error('RGB proxy returned cleartext for an encrypted invoice')
      }
      if (encryption === 'unsupported' && !cleartext) {
        throw new Error('RGB proxy returned encrypted data for a cleartext invoice')
      }
      let plaintext: Uint8Array
      try {
        plaintext = cleartext
          ? blob
          : proxyV1DecryptBlob(blob, privateKey, result.sender_pk, result.consignment_hash)
      } catch {
        throw new Error('RGB proxy returned a consignment with an invalid hash')
      }
      if (proxyV1Hash(plaintext) !== result.consignment_hash) {
        throw new Error('RGB proxy returned a consignment with an invalid hash')
      }
      return {
        recipientId: input.recipientId,
        payload: Buffer.from(plaintext).toString('base64'),
        endpoint,
        proxyTransferId: transferId,
        proxySenderPublicKey: result.sender_pk,
        proxySenderEndpoint: result.sender_transport_endpoint,
        proxyConsignmentHash: result.consignment_hash,
      }
    } catch (error) {
      lastError = error
    }
  }
  if (lastError && (sawPendingTransfer || !sawHealthyEndpoint)) throw lastError
  return undefined
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

async function getConsignmentFromEndpoints(
  {
    recipientId,
    endpoints,
  }: {
    recipientId: string
    endpoints: string[]
  },
  options?: RgbProxyTransportOptions
): Promise<RgbReceivedConsignment | undefined> {
  for (const endpoint of endpoints) {
    try {
      const body = await postJson<ProxyConsignment>(
        endpoint,
        'consignment.get',
        {
          recipient_id: recipientId,
        },
        options
      )
      if (body.error) {
        if (NOT_FOUND_CODES.has(body.error.code || 0)) {
          continue
        }
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
      }
    } catch (error) {
      if (endpoint === endpoints[endpoints.length - 1]) throw error
    }
  }
  return undefined
}

export function createRgbProxyTransport(
  proxyEndpoints: string[] = [],
  options?: RgbProxyTransportOptions
): RgbTransport {
  const endpoints = normalizeEndpoints(proxyEndpoints)
  // Only endpoints configured by the wallet are operated by us. Invoice
  // endpoints supplied by other wallets remain on the standard single-get
  // protocol path and never receive this extension request.
  const batchEndpoints = new Set(endpoints)
  const unsupportedBatchEndpoints = new Set<string>()
  return {
    getEndpoints: () => endpoints,

    prepareInvoice: async ({ recipientId, endpoints: invoiceEndpoints, expirationTimestamp }) => {
      const serverInfos = await Promise.all(
        invoiceEndpoints.map(async endpoint => {
          const body = await postJson<ProxyServerInfo>(endpoint, 'server.info', {}, options)
          if (body.error?.code === -32601) return { protocol_version: '0.2' } as ProxyServerInfo
          if (body.error || !body.result?.protocol_version) {
            throw new Error(
              `RGB proxy server.info failed: ${body.error?.message || body.error?.code || 'invalid response'}`
            )
          }
          return body.result
        })
      )
      if (serverInfos.every(info => info.protocol_version === '0.2')) return undefined
      if (!serverInfos.every(info => info.protocol_version === '1.0')) {
        throw new Error('RGB invoice endpoints use incompatible proxy protocol versions')
      }
      const now = Math.floor(Date.now() / 1000)
      const expiresAt = expirationTimestamp ?? now + 7 * 24 * 60 * 60
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
        throw new Error('RGB proxy v1 invoice requires a future expiration time')
      }
      for (const info of serverInfos) {
        const serverNow = Number(info.current_time)
        const maxExpiry = Number(info.max_expiry_secs)
        if (
          !Number.isSafeInteger(serverNow) ||
          !Number.isSafeInteger(maxExpiry) ||
          expiresAt <= serverNow ||
          expiresAt > serverNow + maxExpiry
        ) {
          throw new Error('RGB invoice expiration exceeds the proxy v1 limit')
        }
      }
      const privateKey = ed25519.utils.randomPrivateKey()
      const publicKey = Buffer.from(ed25519.getPublicKey(privateKey)).toString('hex')
      const invoiceId = rgbProxyInvoiceId(recipientId, publicKey)
      for (const endpoint of invoiceEndpoints) {
        const body = await postJson<boolean>(
          endpoint,
          'invoice.prepare',
          {
            invoice_id: invoiceId,
            expires_at: String(expiresAt),
            recipient_pk: publicKey,
            quota: '1',
          },
          options
        )
        if (body.error)
          throw new Error(
            `RGB proxy invoice.prepare failed: ${body.error.message || body.error.code}`
          )
      }
      return {
        publicKey,
        privateKey: Buffer.from(privateKey).toString('hex'),
        invoiceId,
        expirationTimestamp: expiresAt,
      }
    },

    publishConsignment: async consignment => {
      if (!consignment.endpoints.length)
        throw new Error('RGB invoice has no proxy transport endpoint')
      if (consignment.proxyInvoiceId) {
        await tryEndpoints(consignment.endpoints, endpoint =>
          postProxyV1Consignment(endpoint, consignment, endpoints, options)
        )
        return
      }
      await tryEndpoints(consignment.endpoints, endpoint =>
        postConsignment(endpoint, consignment, options)
      )
    },

    getAcknowledgement: async consignment => {
      if (consignment.proxyInvoiceId) {
        const privateKey = consignment.proxySenderPrivateKey
        const publicKey = consignment.proxyRecipientPublicKey
        if (!privateKey || !publicKey) throw new Error('RGB proxy v1 sender key is missing')
        const transferId = proxyV1TransferId(
          consignment.proxyInvoiceId,
          proxyV1PublicKey(privateKey)
        )
        const timestamp = String(Math.floor(Date.now() / 1000))
        const consignmentHash = proxyV1Hash(base64ToBytes(consignment.payload))
        let lastError: unknown
        let sawHealthyEndpoint = false
        for (const senderEndpoint of endpoints.length ? endpoints : consignment.endpoints) {
          let body: JsonRpcResponse<ProxyV1AckResult>
          try {
            body = await postJson<ProxyV1AckResult>(
              senderEndpoint,
              'ack.get',
              {
                transfer_ids: [transferId],
                timestamp,
                signature: proxyV1Sign(privateKey, transferId + timestamp),
              },
              options
            )
          } catch (error) {
            lastError = error
            continue
          }
          if (body.error) {
            if (body.error.code === -104) {
              sawHealthyEndpoint = true
              continue
            }
            lastError = new Error(
              `RGB proxy ack.get failed: ${body.error.message || body.error.code}`
            )
            continue
          }
          sawHealthyEndpoint = true
          const ack = body.result?.acks?.[transferId]
          if (ack === undefined) continue
          if (
            !proxyV1Verify(
              publicKey,
              body.result?.signatures?.[transferId] || '',
              transferId + String(ack) + consignmentHash
            )
          ) {
            throw new Error('RGB proxy acknowledgement signature is invalid')
          }
          return ack
        }
        if (!sawHealthyEndpoint && lastError) throw lastError
        return undefined
      }
      let pending = false
      let lastError: unknown
      for (const endpoint of consignment.endpoints) {
        try {
          const body = await postJson<boolean | null>(
            endpoint,
            'ack.get',
            {
              recipient_id: consignment.recipientId,
            },
            options
          )
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

    getConsignment: input =>
      input.proxyPrivateKey
        ? getProxyV1Consignment(input, options)
        : getConsignmentFromEndpoints(input, options),

    getConsignments: async inputs => {
      const grouped = new Map<string, Array<(typeof inputs)[number]>>()
      const individual: typeof inputs = []
      for (const input of inputs) {
        if (input.proxyPrivateKey) {
          individual.push(input)
          continue
        }
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
            const body = await postJson<ProxyBatchConsignment[]>(
              endpoint,
              'consignment.get_many',
              {
                recipient_ids: recipientIds,
              },
              options
            )
            if (body.error) {
              // During a rolling proxy upgrade, retain compatibility with the
              // standard endpoint rather than failing receive polling.
              if (body.error.code === -32601) {
                unsupportedBatchEndpoints.add(endpoint)
                return Promise.all(group.map(input => getConsignmentFromEndpoints(input, options)))
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
        individual.map(input =>
          input.proxyPrivateKey
            ? getProxyV1Consignment(input, options)
            : getConsignmentFromEndpoints(input, options)
        )
      )
      return [...batched.flat(), ...individuallyFetched].filter(
        (item): item is RgbReceivedConsignment => !!item
      )
    },

    checkConsignmentAvailability: async ({
      recipientId,
      endpoints: invoiceEndpoints,
      protocol,
    }) => {
      if (protocol === 'v1') {
        const statuses = await Promise.all(
          invoiceEndpoints.map(async endpoint => {
            const body = await postJson<Record<string, { status: string }>>(
              endpoint,
              'invoice.check',
              {
                invoice_ids: [recipientId],
              },
              options
            )
            if (body.error)
              throw new Error(
                `RGB proxy invoice.check failed: ${body.error.message || body.error.code}`
              )
            return body.result?.[recipientId]?.status
          })
        )
        return statuses.some(status => status === 'available')
      }
      let occupiedEndpoints = 0
      let lastError: unknown
      for (const endpoint of invoiceEndpoints) {
        try {
          const body = await postJson<{ consignment?: string; txid?: string } | null>(
            endpoint,
            'consignment.get',
            { recipient_id: recipientId },
            options
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

    acknowledgeConsignment: async ({
      recipientId,
      endpoints,
      acknowledged,
      proxyPrivateKey,
      proxyTransferId,
      proxySenderPublicKey,
      proxySenderEndpoint,
      proxyConsignmentHash,
    }) => {
      if (proxyPrivateKey) {
        if (
          !proxyTransferId ||
          !proxySenderPublicKey ||
          !proxySenderEndpoint ||
          !proxyConsignmentHash
        ) {
          throw new Error('RGB proxy v1 acknowledgement state is incomplete')
        }
        const body = await postJson<{
          sender_pk?: string
          signed_tx?: string
          signed_tx_hash?: string
        }>(
          secureSenderEndpoint(proxySenderEndpoint),
          'ack.post',
          {
            transfer_id: proxyTransferId,
            ack: acknowledged,
            signature: proxyV1Sign(
              proxyPrivateKey,
              proxyTransferId + String(acknowledged) + proxyConsignmentHash
            ),
          },
          options
        )
        if (body.error?.code === -104) throw new RgbProxyOperationNotFoundError()
        if (body.error)
          throw new Error(`RGB proxy ack.post failed: ${body.error.message || body.error.code}`)
        if (acknowledged) {
          if (!body.result?.signed_tx || !body.result.sender_pk || !body.result.signed_tx_hash) {
            throw new Error('RGB proxy signed transaction was cleared by sender')
          }
          if (body.result.sender_pk !== proxySenderPublicKey) {
            throw new Error('RGB proxy returned a different signed transaction sender')
          }
          const rawTx = await proxyV1DecryptSignedTx(
            body.result.signed_tx,
            proxyPrivateKey,
            body.result.sender_pk,
            body.result.signed_tx_hash
          )
          if (proxyV1Hash(Buffer.from(rawTx, 'hex')) !== body.result.signed_tx_hash) {
            throw new Error('RGB proxy returned a signed transaction with an invalid hash')
          }
        }
        return
      }
      await tryEndpoints(endpoints, async endpoint => {
        const body = await postJson<boolean>(
          endpoint,
          'ack.post',
          {
            recipient_id: recipientId,
            ack: acknowledged,
          },
          options
        )
        if (body.error)
          throw new Error(`RGB proxy ack.post failed: ${body.error.message || body.error.code}`)
      })
    },

    markConsignmentRetrieved: async ({ endpoint, proxyTransferId, proxyPrivateKey }) => {
      const body = await postJson<boolean>(
        endpoint,
        'transfer.retrieved',
        {
          transfer_id: proxyTransferId,
          signature: proxyV1Sign(proxyPrivateKey, proxyTransferId + 'retrieved'),
        },
        options
      )
      if (body.error) {
        throw new Error(
          `RGB proxy transfer.retrieved failed: ${body.error.message || body.error.code}`
        )
      }
    },

    cancelConsignment: async ({
      proxyInvoiceId,
      proxySenderPrivateKey,
      endpoints: invoiceEndpoints,
      allowMissing,
    }) => {
      const transferId = proxyV1TransferId(proxyInvoiceId, proxyV1PublicKey(proxySenderPrivateKey))
      const senderEndpoints = endpoints.length ? endpoints : invoiceEndpoints
      if (!senderEndpoints.length) throw new Error('RGB sender proxy endpoint is missing')
      let cleaned = false
      let lastError: unknown
      for (const endpoint of senderEndpoints) {
        try {
          const body = await postJson<boolean>(
            endpoint,
            'ack.clean',
            {
              transfer_ids: [transferId],
              signature: proxyV1Sign(proxySenderPrivateKey, transferId),
            },
            options
          )
          if (body.error) {
            if (body.error.code === -104) continue
            throw new Error(`RGB proxy ack.clean failed: ${body.error.message || body.error.code}`)
          }
          cleaned = true
        } catch (error) {
          lastError = error
        }
      }
      if (lastError) throw lastError
      if (!cleaned && !allowMissing) throw new RgbProxyOperationNotFoundError()
    },
  }
}
