import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RgbProxyOperationNotFoundError } from '@unisat/rgb-service'

import { createRgbProxyTransport } from '../src/adapters/rgb-proxy'
import { proxyV1DecryptBlob, proxyV1EncryptBlob, proxyV1Hash, proxyV1PublicKey, proxyV1TransferId, proxyV1Verify } from '../src/adapters/rgb-proxy-v1'

const endpoint = 'rpcs://proxy.example'
const recipientId = 'bc:utxob:recipient'

function rpcResponse(result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: '1', result }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

function rpcError(code: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: '1', error: { code, message } }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('RGB proxy transport', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts a binary consignment to a rpcs endpoint before requesting its acknowledgement', async () => {
    fetchMock.mockResolvedValueOnce(rpcResponse(true)).mockResolvedValueOnce(rpcResponse(null))
    const transport = createRgbProxyTransport([endpoint])
    const consignment = {
      recipientId,
      payload: Buffer.from('consignment').toString('base64'),
      assetId: 'rgb:asset',
      opIds: ['a'.repeat(64)],
      txid: 'b'.repeat(64),
      endpoints: [endpoint],
    }

    expect(transport.getEndpoints?.()).toEqual([endpoint])
    await transport.publishConsignment(consignment)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example',
      expect.objectContaining({ method: 'POST' })
    )
    const request = fetchMock.mock.calls[0]![1]
    expect(request.body).toBeInstanceOf(ArrayBuffer)
    const form = await new Response(request.body, { headers: request.headers }).formData()
    expect(form.get('method')).toBe('consignment.post')
    expect(form.get('params[recipient_id]')).toBe(recipientId)
    expect(form.get('params[txid]')).toBe(consignment.txid)
    const file = form.get('file') as File
    expect(file.name).toBe('consignment.rgb')
    expect(file.type).toBe('application/octet-stream')
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('consignment')

    await expect(transport.getAcknowledgement?.(consignment)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://proxy.example',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('ack.get'),
      })
    )
  })

  it('registers and completes a proxy v1 invoice with signed transfer and ACK', async () => {
    const transport = createRgbProxyTransport([endpoint])
    const recipient = 'bc:utxob:recipient-v1'
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const payload = Buffer.from('v1 consignment').toString('base64')
    const rawTx = '01000000'
    let invoiceId = ''
    let recipientPk = ''
    let transferId = ''
    let senderPk = ''
    let consignmentHash = ''
    let postedPayload = ''
    let signedTx = ''
    let signedTxHash = ''
    let ackSignature = ''
    let ack: boolean | undefined
    fetchMock.mockImplementation(async (_url, init: RequestInit) => {
      const json = typeof init.body === 'string'
        ? JSON.parse(init.body)
        : undefined
      const form = json ? undefined : await new Response(init.body, { headers: init.headers }).formData()
      const method = json?.method || form?.get('method')
      const params = json?.params || Object.fromEntries(
        [...form!.entries()].filter(([key]) => key.startsWith('params['))
          .map(([key, value]) => [key.slice(7, -1), value])
      )
      switch (method) {
        case 'server.info':
          return rpcResponse({ protocol_version: '1.0', current_time: String(Math.floor(Date.now() / 1000)), max_expiry_secs: '86400' })
        case 'invoice.prepare':
          invoiceId = params.invoice_id
          recipientPk = params.recipient_pk
          expect(params.expires_at).toBe(String(expiresAt))
          return rpcResponse(true)
        case 'invoice.check':
          return rpcResponse({ [invoiceId]: { status: 'available', pow_difficulty: '0' } })
        case 'ack.prepare':
          transferId = Object.keys(params.transfer_data)[0]!
          senderPk = params.sender_pk
          signedTx = params.transfer_data[transferId].signed_tx
          signedTxHash = params.signed_tx_hash
          expect(transferId).toBe(proxyV1TransferId(invoiceId, senderPk))
          expect(params.transfer_data[transferId].recipient_pk).toBe(recipientPk)
          return rpcResponse(true)
        case 'consignment.post': {
          consignmentHash = params.consignment_hash
          const file = Buffer.from(await (form!.get('file') as File).arrayBuffer())
          const blobHash = proxyV1Hash(file)
          expect(blobHash).not.toBe(consignmentHash)
          expect(file[0]).toBe(1)
          postedPayload = file.toString('base64')
          expect(Buffer.from(proxyV1DecryptBlob(file, prepared!.privateKey, senderPk, consignmentHash)).toString('base64')).toBe(payload)
          expect(params.transfer_id).toBe(transferId)
          expect(proxyV1Verify(senderPk, params.signature, transferId + consignmentHash + blobHash)).toBe(true)
          return rpcResponse(true)
        }
        case 'transfer.list':
          expect(proxyV1Verify(recipientPk, params.signature, invoiceId + params.timestamp)).toBe(true)
          return rpcResponse({ [transferId]: 'pending' })
        case 'consignment.get':
          return rpcResponse({ consignment: postedPayload, sender_transport_endpoint: 'rpc://proxy.example/json-rpc', sender_pk: senderPk, consignment_hash: consignmentHash, batch: false })
        case 'ack.post':
          ack = params.ack
          ackSignature = params.signature
          expect(proxyV1Verify(recipientPk, ackSignature, transferId + 'true' + consignmentHash)).toBe(true)
          return rpcResponse({ sender_pk: senderPk, signed_tx: signedTx, signed_tx_hash: signedTxHash, expires_at: String(expiresAt) })
        case 'ack.get':
          expect(proxyV1Verify(senderPk, params.signature, transferId + params.timestamp)).toBe(true)
          return rpcResponse({ acks: { [transferId]: ack }, signatures: { [transferId]: ackSignature } })
        default:
          throw new Error(`Unexpected proxy method ${method}`)
      }
    })

    const prepared = await transport.prepareInvoice?.({ recipientId: recipient, endpoints: [endpoint], expirationTimestamp: expiresAt })
    expect(prepared?.invoiceId).toBe(invoiceId)
    const senderPrivateKey = '11'.repeat(32)
    const consignment = {
      recipientId: invoiceId,
      payload,
      assetId: 'rgb:asset',
      opIds: ['aa'.repeat(32)],
      txid: 'bb'.repeat(32),
      endpoints: [endpoint],
      proxyInvoiceId: invoiceId,
      proxyRecipientPublicKey: prepared!.publicKey,
      proxySenderPrivateKey: senderPrivateKey,
      signedRawTx: rawTx,
      proxyExpirationTimestamp: expiresAt,
    }
    await transport.publishConsignment(consignment)
    const received = await transport.getConsignment?.({ recipientId: invoiceId, endpoints: [endpoint], proxyPrivateKey: prepared!.privateKey })
    expect(received?.proxyTransferId).toBe(transferId)
    expect(received?.payload).toBe(payload)
    await transport.acknowledgeConsignment?.({
      recipientId: invoiceId,
      endpoints: [endpoint],
      acknowledged: true,
      proxyPrivateKey: prepared!.privateKey,
      proxyTransferId: received!.proxyTransferId,
      proxySenderPublicKey: received!.proxySenderPublicKey,
      proxySenderEndpoint: received!.proxySenderEndpoint,
      proxyConsignmentHash: received!.proxyConsignmentHash,
    })
    expect(fetchMock.mock.calls.find(([, options]) =>
      typeof options?.body === 'string' && JSON.parse(options.body).method === 'ack.post'
    )?.[0]).toBe('https://proxy.example/json-rpc')
    await expect(transport.getAcknowledgement?.(consignment)).resolves.toBe(true)
  })

  it('posts a proxy v1 donation without preparing an ACK operation', async () => {
    const invoiceId = '22'.repeat(32)
    const senderPrivateKey = '11'.repeat(32)
    const senderPk = proxyV1PublicKey(senderPrivateKey)
    const recipientPk = proxyV1PublicKey('33'.repeat(32))
    const transferId = proxyV1TransferId(invoiceId, senderPk)
    const methods: string[] = []
    fetchMock.mockImplementation(async (_url, init: RequestInit) => {
      const json = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      const form = json ? undefined : await new Response(init.body, { headers: init.headers }).formData()
      const method = json?.method || form?.get('method')
      methods.push(method)
      if (method === 'invoice.check') {
        return rpcResponse({ [invoiceId]: { status: 'available', pow_difficulty: '0' } })
      }
      expect(method).toBe('consignment.post')
      expect(form?.get('params[transfer_id]')).toBe(transferId)
      return rpcResponse(true)
    })
    const transport = createRgbProxyTransport([endpoint])
    await transport.publishConsignment({
      recipientId: invoiceId, payload: Buffer.from('donation').toString('base64'),
      assetId: 'rgb:asset', opIds: ['aa'.repeat(32)], txid: 'bb'.repeat(32),
      endpoints: [endpoint], proxyInvoiceId: invoiceId, proxyRecipientPublicKey: recipientPk,
      proxySenderPrivateKey: senderPrivateKey, signedRawTx: '01000000', donation: true,
    })
    expect(methods).toEqual(['invoice.check', 'consignment.post'])
  })

  it.each(['transfer.list', 'consignment.get'])(
    'tries the next v1 endpoint when %s fails', async failedMethod => {
      const firstEndpoint = 'rpcs://first.example/json-rpc'
      const nextEndpoint = 'rpcs://next.example/json-rpc'
      const invoiceId = '22'.repeat(32)
      const senderPk = proxyV1PublicKey('11'.repeat(32))
      const transferId = proxyV1TransferId(invoiceId, senderPk)
      const plaintext = Buffer.from('v1 fallback consignment')
      fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
        const { method } = JSON.parse(init.body as string)
        if (url === 'https://first.example/json-rpc') {
          if (method === failedMethod) {
            if (method === 'transfer.list') throw new Error('first proxy offline')
            return rpcError(-32000, 'first proxy unavailable')
          }
          return rpcResponse({ [transferId]: 'pending' })
        }
        expect(url).toBe('https://next.example/json-rpc')
        if (method === 'transfer.list') return rpcResponse({ [transferId]: 'pending' })
        expect(method).toBe('consignment.get')
        return rpcResponse({
          consignment: plaintext.toString('base64'),
          sender_transport_endpoint: nextEndpoint,
          sender_pk: senderPk,
          consignment_hash: proxyV1Hash(plaintext),
          batch: false,
        })
      })

      await expect(createRgbProxyTransport([endpoint]).getConsignment?.({
        recipientId: invoiceId, endpoints: [firstEndpoint, nextEndpoint],
        proxyPrivateKey: '33'.repeat(32),
      })).resolves.toMatchObject({
        recipientId: invoiceId,
        payload: plaintext.toString('base64'),
        endpoint: nextEndpoint,
        proxyTransferId: transferId,
      })
    }
  )

  it('reports the final v1 endpoint error when every endpoint fails', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('first proxy offline'))
      .mockResolvedValueOnce(rpcError(-32000, 'second proxy unavailable'))

    await expect(createRgbProxyTransport([endpoint]).getConsignment?.({
      recipientId: '22'.repeat(32),
      endpoints: ['rpcs://first.example/json-rpc', 'rpcs://next.example/json-rpc'],
      proxyPrivateKey: '33'.repeat(32),
    })).rejects.toThrow('RGB proxy transfer.list failed: second proxy unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns no v1 consignment when a healthy fallback has no pending transfer', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('first proxy offline'))
      .mockResolvedValueOnce(rpcResponse({}))

    await expect(createRgbProxyTransport([endpoint]).getConsignment?.({
      recipientId: '22'.repeat(32),
      endpoints: ['rpcs://first.example/json-rpc', 'rpcs://next.example/json-rpc'],
      proxyPrivateKey: '33'.repeat(32),
    })).resolves.toBeUndefined()
  })

  it('decrypts proxy v1 consignments across the 64 KiB chunk boundary and rejects altered ciphertext', () => {
    const senderKey = '11'.repeat(32)
    const recipientKey = '22'.repeat(32)
    const senderPk = proxyV1PublicKey(senderKey)
    const recipientPk = proxyV1PublicKey(recipientKey)
    const plaintext = Uint8Array.from({ length: 65_537 }, (_, index) => index % 251)
    const encrypted = proxyV1EncryptBlob(plaintext, senderKey, recipientPk)
    expect(proxyV1EncryptBlob(plaintext, senderKey, recipientPk)).toEqual(encrypted)
    expect(proxyV1DecryptBlob(encrypted, recipientKey, senderPk, proxyV1Hash(plaintext))).toEqual(plaintext)
    encrypted[encrypted.length - 1] ^= 1
    expect(() => proxyV1DecryptBlob(encrypted, recipientKey, senderPk, proxyV1Hash(plaintext))).toThrow()
  })

  it('keeps legacy invoices unchanged when server.info is unavailable', async () => {
    fetchMock.mockResolvedValueOnce(rpcError(-32601, 'Method not found'))
    await expect(createRgbProxyTransport([endpoint]).prepareInvoice?.({
      recipientId,
      endpoints: [endpoint],
    })).resolves.toBeUndefined()
  })

  it('clears an unreleased v1 signed transaction before canceling locally', async () => {
    const senderPrivateKey = '11'.repeat(32)
    const invoiceId = '22'.repeat(32)
    fetchMock.mockImplementationOnce(async (_url, init: RequestInit) => {
      const { method, params } = JSON.parse(init.body as string)
      expect(method).toBe('ack.clean')
      const transferId = params.transfer_ids[0]
      expect(transferId).toMatch(/^[0-9a-f]{64}$/)
      const publicKey = Buffer.from(
        (await import('@noble/curves/ed25519')).ed25519.getPublicKey(Buffer.from(senderPrivateKey, 'hex'))
      ).toString('hex')
      expect(transferId).toBe(proxyV1TransferId(invoiceId, publicKey))
      expect(proxyV1Verify(publicKey, params.signature, transferId)).toBe(true)
      return rpcResponse(true)
    })
    await expect(createRgbProxyTransport([endpoint]).cancelConsignment?.({
      proxyInvoiceId: invoiceId,
      proxySenderPrivateKey: senderPrivateKey,
      endpoints: [endpoint],
      allowMissing: false,
    })).resolves.toBeUndefined()
  })

  it('uploads exact binary bytes when native Blob rejects ArrayBuffer parts', async () => {
    const originalBlob = globalThis.Blob
    class NativeBlob extends originalBlob {
      constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
        if (parts.some(part => part instanceof ArrayBuffer || ArrayBuffer.isView(part))) {
          throw new Error("Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported")
        }
        super(parts, options)
      }
    }
    vi.stubGlobal('Blob', NativeBlob)
    fetchMock.mockResolvedValueOnce(rpcResponse(true))
    const bytes = Buffer.from(Array.from({ length: 2048 }, (_, index) => index % 256))
    await createRgbProxyTransport([endpoint]).publishConsignment({
      recipientId,
      payload: bytes.toString('base64'),
      assetId: 'rgb:asset',
      opIds: ['a'.repeat(64)],
      txid: 'b'.repeat(64),
      endpoints: [endpoint],
    })
    const request = fetchMock.mock.calls[0]![1]
    expect(request.body).toBeInstanceOf(ArrayBuffer)
    const form = await new Response(request.body, { headers: request.headers }).formData()
    const file = form.get('file') as File
    expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes)
    expect(form.get('jsonrpc')).toBe('2.0')
    expect(form.get('params[recipient_id]')).toBe(recipientId)
  })

  it('gets a consignment and acknowledges it through the endpoint that supplied it', async () => {
    fetchMock
      .mockResolvedValueOnce(
        rpcResponse({ consignment: Buffer.from('consignment').toString('base64'), txid: 'c'.repeat(64) })
      )
      .mockResolvedValueOnce(rpcResponse(true))
    const transport = createRgbProxyTransport([endpoint])

    await expect(transport.getConsignment?.({ recipientId, endpoints: [endpoint] })).resolves.toEqual({
      recipientId,
      payload: Buffer.from('consignment').toString('base64'),
      txid: 'c'.repeat(64),
      endpoint,
    })
    await transport.acknowledgeConsignment?.({ recipientId, endpoints: [endpoint], acknowledged: true })

    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://proxy.example',
      expect.objectContaining({ body: expect.stringContaining('ack.post') })
    )
  })

  it('gets multiple consignments from a configured proxy in one request', async () => {
    const firstRecipientId = 'bc:utxob:first'
    const secondRecipientId = 'bc:utxob:second'
    fetchMock.mockResolvedValueOnce(
      rpcResponse([
        {
          recipient_id: secondRecipientId,
          consignment: Buffer.from('second consignment').toString('base64'),
          txid: 'd'.repeat(64),
        },
      ])
    )
    const transport = createRgbProxyTransport([endpoint])

    await expect(
      transport.getConsignments?.([
        { recipientId: firstRecipientId, endpoints: [endpoint] },
        { recipientId: secondRecipientId, endpoints: [endpoint] },
      ])
    ).resolves.toEqual([
      {
        recipientId: secondRecipientId,
        payload: Buffer.from('second consignment').toString('base64'),
        txid: 'd'.repeat(64),
        endpoint,
      },
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('consignment.get_many'),
      })
    )
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).params).toEqual({
      recipient_ids: [firstRecipientId, secondRecipientId],
    })
  })

  it('keeps using standard consignment.get for a third-party invoice endpoint', async () => {
    const externalEndpoint = 'rpcs://third-party.example/json-rpc'
    fetchMock.mockResolvedValueOnce(
      rpcResponse({ consignment: Buffer.from('consignment').toString('base64'), txid: 'c'.repeat(64) })
    )
    const transport = createRgbProxyTransport([endpoint])

    await expect(
      transport.getConsignments?.([{ recipientId, endpoints: [externalEndpoint] }])
    ).resolves.toEqual([
      {
        recipientId,
        payload: Buffer.from('consignment').toString('base64'),
        txid: 'c'.repeat(64),
        endpoint: externalEndpoint,
      },
    ])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://third-party.example/json-rpc',
      expect.objectContaining({ body: expect.stringContaining('consignment.get') })
    )
    expect(fetchMock.mock.calls[0]![1].body).not.toContain('consignment.get_many')
  })

  it('checks invoice availability without uploading a consignment', async () => {
    fetchMock
      .mockResolvedValueOnce(
        rpcResponse({ consignment: Buffer.from('existing').toString('base64'), txid: 'c'.repeat(64) })
      )
      .mockResolvedValueOnce(rpcError(-302, 'not found'))
    const transport = createRgbProxyTransport([endpoint])

    await expect(
      transport.checkConsignmentAvailability?.({
        recipientId,
        endpoints: [endpoint, 'rpcs://backup.example'],
      })
    ).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([, options]) => String(options?.body).includes('consignment.get'))).toBe(
      true
    )
  })

  it('marks an invoice unavailable when every endpoint already has a consignment', async () => {
    fetchMock
      .mockResolvedValueOnce(
        rpcResponse({ consignment: Buffer.from('existing').toString('base64'), txid: 'c'.repeat(64) })
      )
      .mockResolvedValueOnce(
        rpcResponse({ consignment: Buffer.from('existing').toString('base64'), txid: 'c'.repeat(64) })
      )
    const transport = createRgbProxyTransport([endpoint])

    await expect(
      transport.checkConsignmentAvailability?.({
        recipientId,
        endpoints: [endpoint, 'rpcs://backup.example'],
      })
    ).resolves.toBe(false)
  })

  it.each(['rpc://proxy.example', 'http://proxy.example'])('rejects insecure endpoint %s', async insecureEndpoint => {
    const transport = createRgbProxyTransport([insecureEndpoint])
    const consignment = {
      recipientId,
      payload: Buffer.from('consignment').toString('base64'),
      assetId: 'rgb:asset',
      opIds: ['a'.repeat(64)],
      txid: 'b'.repeat(64),
      endpoints: [insecureEndpoint],
    }

    await expect(transport.publishConsignment(consignment)).rejects.toThrow(
      `Unsupported RGB proxy endpoint: ${insecureEndpoint}`
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not send a v1 ACK to a local sender endpoint', async () => {
    const transport = createRgbProxyTransport([endpoint])
    await expect(transport.acknowledgeConsignment?.({
      recipientId,
      endpoints: [endpoint],
      acknowledged: true,
      proxyPrivateKey: '11'.repeat(32),
      proxyTransferId: '22'.repeat(32),
      proxySenderPublicKey: '33'.repeat(32),
      proxySenderEndpoint: 'rpc://localhost:13000/json-rpc',
      proxyConsignmentHash: '44'.repeat(32),
    })).rejects.toThrow('Unsupported RGB proxy endpoint: rpcs://localhost:13000/json-rpc')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves proxy v1 operation-not-found so donation receives can use chain status', async () => {
    fetchMock.mockResolvedValueOnce(rpcError(-104, 'Operation not found'))
    const transport = createRgbProxyTransport([endpoint])
    await expect(transport.acknowledgeConsignment?.({
      recipientId,
      endpoints: [endpoint],
      acknowledged: true,
      proxyPrivateKey: '11'.repeat(32),
      proxyTransferId: '22'.repeat(32),
      proxySenderPublicKey: '33'.repeat(32),
      proxySenderEndpoint: endpoint,
      proxyConsignmentHash: '44'.repeat(32),
    })).rejects.toBeInstanceOf(RgbProxyOperationNotFoundError)
  })

  it.each(['rpcs://127.0.0.1:3000', 'https://[::1]', 'https://localhost'])
  ('rejects local or IP-literal endpoint %s', async unsafeEndpoint => {
    const transport = createRgbProxyTransport([unsafeEndpoint])
    const consignment = {
      recipientId,
      payload: Buffer.from('consignment').toString('base64'),
      assetId: 'rgb:asset',
      opIds: ['a'.repeat(64)],
      txid: 'b'.repeat(64),
      endpoints: [unsafeEndpoint],
    }

    await expect(transport.publishConsignment(consignment)).rejects.toThrow(
      `Unsupported RGB proxy endpoint: ${unsafeEndpoint}`
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
