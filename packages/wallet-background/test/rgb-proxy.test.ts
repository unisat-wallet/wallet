import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRgbProxyTransport } from '../src/adapters/rgb-proxy'

const endpoint = 'rpcs://proxy.example'
const recipientId = 'bc:utxob:recipient'

function rpcResponse(result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: '1', result }), {
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
})
