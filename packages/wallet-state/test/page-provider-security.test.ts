import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/utils', () => ({
  objToUint8Array: (value: Record<string, number> | Uint8Array) =>
    value instanceof Uint8Array ? value : Uint8Array.from(Object.values(value)),
}))

import {
  CosmosAPIMethods,
  CosmJSOfflineSigner,
} from '../../../apps/extension/src/content-script/pageProvider/cosmosAPI'
import { createProviderProxy } from '../../../apps/extension/src/content-script/pageProvider/providerInjection'
import { requestMethodKey } from '../../../apps/extension/src/content-script/pageProvider/providerState'

afterEach(() => vi.restoreAllMocks())

describe('page provider private request surface', () => {
  it('does not expose private provider members through the top-level proxy', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const provider = {
      _request: vi.fn(),
      bitcoinAPI: { provider: 'raw-provider' },
      publicMethod: vi.fn(),
      [requestMethodKey]: vi.fn(),
    }
    const proxy = createProviderProxy(provider, requestMethodKey)

    expect(proxy._request).toBeUndefined()
    expect(proxy.bitcoinAPI).toBeUndefined()
    expect(proxy[requestMethodKey]).toBeUndefined()
    expect('_request' in proxy).toBe(false)
    expect('bitcoinAPI' in proxy).toBe(false)
    expect(Object.getOwnPropertyDescriptor(proxy, '_request')).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(proxy, 'bitcoinAPI')).toBeUndefined()
    expect(Reflect.ownKeys(proxy)).not.toContain('_request')
    expect(Reflect.ownKeys(proxy)).not.toContain('bitcoinAPI')
    expect(proxy.publicMethod).toBe(provider.publicMethod)
  })

  it('keeps the raw provider private in Keplr API objects', async () => {
    const request = vi.fn().mockResolvedValue({
      signed: {
        bodyBytes: { 0: 10 },
        authInfoBytes: { 0: 18 },
        chainId: 'bbn-1',
        accountNumber: '0',
      },
      signature: { signature: 'signed' },
    })
    const rawProvider = { [requestMethodKey]: request }
    const keplr = new CosmosAPIMethods(rawProvider)
    const signer = keplr.getOfflineSigner('bbn-1') as CosmJSOfflineSigner

    expect('provider' in keplr).toBe(false)
    expect('provider' in signer).toBe(false)
    expect(Object.getOwnPropertyNames(keplr)).not.toContain('provider')
    expect(Object.getOwnPropertyNames(signer)).not.toContain('provider')

    await signer.signDirect('bbn1signer', {
      bodyBytes: new Uint8Array([10]),
      authInfoBytes: new Uint8Array([18]),
      chainId: 'bbn-1',
      accountNumber: 0,
    })

    expect(request).toHaveBeenCalledWith({
      method: 'cosmos_signDirect',
      params: {
        chainId: 'bbn-1',
        signerAddress: 'bbn1signer',
        signDoc: {
          bodyBytes: new Uint8Array([10]),
          authInfoBytes: new Uint8Array([18]),
          chainId: 'bbn-1',
          accountNumber: '0',
        },
      },
    })
  })
})
