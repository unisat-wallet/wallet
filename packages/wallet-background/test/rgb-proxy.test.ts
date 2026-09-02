import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRgbProxyTransport } from '../src/adapters/rgb-proxy'

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
    const form = fetchMock.mock.calls[0]![1].body as FormData
    expect(form.get('method')).toBe('consignment.post')
    expect(form.get('params[recipient_id]')).toBe(recipientId)
    expect(form.get('params[txid]')).toBe(consignment.txid)
    expect(form.get('file')).toBeInstanceOf(Blob)

    await expect(transport.getAcknowledgement?.(consignment)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://proxy.example',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('ack.get'),
      })
    )
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
