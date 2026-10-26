import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAINS_MAP } from '@unisat/wallet-shared'
import { bitcoin } from '@unisat/wallet-bitcoin'
import { ChainType, NetworkType } from '@unisat/wallet-types'

vi.mock('@unisat/babylon-service', () => ({
  arbitrarySignDocToBytesHex: vi.fn(),
  directSignDocToBytesHex: vi.fn(),
  encodeSignature: vi.fn(),
}))
vi.mock('../src/services', () => ({
  permissionService: { hasPermission: vi.fn() },
  sessionService: { broadcastEvent: vi.fn() },
  walletApiService: {},
}))
vi.mock('../src/controllers/wallet', () => ({
  default: {
    getChainType: vi.fn(),
    setChainType: vi.fn(),
    getNetworkType: vi.fn(),
    getCurrentAccount: vi.fn(),
    createRgbUtxosBegin: vi.fn(),
    createRgbUtxosEnd: vi.fn(),
    createRgbIssueNia: vi.fn(),
  },
}))

import providerController from '../src/controllers/provider/controller'
import wallet from '../src/controllers/wallet'

const orderId = '202610-RGB20-ABC12345'
const params = { orderId, ticker: 'TOK', name: 'Token', precision: 0, amount: '100' }
const chainType = ChainType.BITCOIN_MAINNET
const feeAddress = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 2), network: bitcoin.networks.bitcoin }).address!
const paidOrder = {
  code: 0,
  data: {
    status: 'paid', network: chainType, address: 'bc1qowner',
    ticker: 'TOK', name: 'Token', precision: 0, amount: '100', feeSats: 1500,
    feeAddress,
    paymentTxid: 'a'.repeat(64),
  },
}
const originalEndpoints = CHAINS_MAP[chainType]!.endpoints

describe('provider RGB issue payment gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    CHAINS_MAP[chainType]!.endpoints = ['https://wallet.example']
    vi.mocked(wallet.getChainType).mockReturnValue(chainType)
    vi.mocked(wallet.getNetworkType).mockReturnValue(NetworkType.MAINNET)
    vi.mocked(wallet.getCurrentAccount).mockResolvedValue({ address: 'bc1qowner' } as any)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => paidOrder }))
  })

  afterEach(() => {
    CHAINS_MAP[chainType]!.endpoints = originalEndpoints
    vi.unstubAllGlobals()
  })

  it('rejects a mismatched order before asking for a signature', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ...paidOrder, data: { ...paidOrder.data, ticker: 'OTHER' } }),
    }))
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'issueRgbNia')
    await expect(approval[1]({ data: { params: { ...params } } })).rejects.toThrow('does not match')
    expect(wallet.createRgbIssueNia).not.toHaveBeenCalled()
  })

  it('adds the verified order fee to the RGB funding transaction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ...paidOrder, data: { ...paidOrder.data, status: 'pending' } }),
    }))
    vi.mocked(wallet.createRgbUtxosBegin).mockResolvedValue({ toSignData: { psbtHex: 'psbt' } } as any)
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'issueRgbNia')
    const request = { data: { params: {
      ...params,
      toSignData: { psbtHex: 'untrusted' },
      serviceFeeSats: 1,
    } } }
    await approval[1](request)
    expect(wallet.createRgbUtxosBegin).toHaveBeenCalledWith({
      num: 1,
      payment: { address: feeAddress, satoshis: 1500 },
      issue: { ticker: 'TOK', name: 'Token', amount: '100', precision: 0 },
    })
    expect(request.data.params.toSignData).toEqual({ psbtHex: 'psbt' })
    expect(request.data.params.serviceFeeSats).toBe(1500)
  })

  it('does not prepare or trust a site-supplied PSBT when retrying a broadcast payment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ...paidOrder, data: { ...paidOrder.data, status: 'pending' } }),
    }))
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'issueRgbNia')
    const request = {
      data: { params: { ...params, paymentTxid: 'b'.repeat(64), toSignData: { psbtHex: 'untrusted' } } },
    }
    await approval[1](request)
    expect(wallet.createRgbUtxosBegin).not.toHaveBeenCalled()
    expect(request.data.params).not.toHaveProperty('toSignData')
  })

  it('signs, broadcasts, claims, and issues through one wallet request', async () => {
    const txid = 'c'.repeat(64)
    const signedPsbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin })
      .addInput({
        hash: 'd'.repeat(64), index: 0,
        witnessUtxo: { script: bitcoin.address.toOutputScript(feeAddress), value: 10_000 },
      })
      .addOutput({ address: feeAddress, value: 1500 })
    signedPsbt.updateInput(0, { finalScriptWitness: Buffer.from([1, 0]) })
    const pending = { ...paidOrder.data, status: 'pending', paymentTxid: undefined }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, options?: { method?: string }) => ({
      ok: true,
      json: async () => options?.method === 'POST'
        ? { code: 0, data: { ...paidOrder.data, paymentTxid: txid } }
        : { code: 0, data: pending },
    })))
    vi.mocked(wallet.createRgbUtxosBegin).mockResolvedValue({ toSignData: { psbtHex: signedPsbt.toHex() } } as any)
    vi.mocked(wallet.createRgbUtxosEnd).mockResolvedValue({ txid } as any)
    vi.mocked(wallet.createRgbIssueNia).mockResolvedValue({ assetId: 'rgb:issued' } as any)
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'issueRgbNia')
    const request = { data: { params: { ...params } } }
    await approval[1](request)
    const result = await providerController.issueRgbNia({
      data: request.data,
      approvalRes: { signedPsbt: signedPsbt.toHex() },
    })
    expect(wallet.createRgbUtxosEnd).toHaveBeenCalledWith({ signedPsbt: signedPsbt.toHex() })
    expect(result).toMatchObject({ status: 'issued', paymentTxid: txid, assetId: 'rgb:issued' })
  })

  it('reports when wallet API has no issuance verification route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(providerController.issueRgbNia({ data: { params } }))
      .rejects.toThrow('wallet API (HTTP 404)')
    expect(wallet.createRgbIssueNia).not.toHaveBeenCalled()
  })

  it('claims an existing funding transaction and issues without another payment', async () => {
    const txid = 'b'.repeat(64)
    const pending = { ...paidOrder.data, status: 'pending', paymentTxid: undefined }
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options?: { method?: string }) => ({
      ok: true,
      json: async () => options?.method === 'POST'
        ? { code: 0, data: { ...paidOrder.data, paymentTxid: txid } }
        : { code: 0, data: pending },
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(wallet.createRgbIssueNia).mockResolvedValue({
      assetId: 'rgb:issued', pendingConfirmation: true, syncPending: false,
    } as any)
    const result = await providerController.issueRgbNia({
      data: { params: { ...params, paymentTxid: txid } },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `https://wallet.example/v5/rgb/issue/order/${orderId}/claim-payment`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ txid }) }),
    )
    expect(wallet.createRgbUtxosBegin).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'issued', paymentTxid: txid, assetId: 'rgb:issued' })
  })

  it('recovers when a timed-out claim was committed before the retry', async () => {
    const txid = 'b'.repeat(64)
    const pending = { ...paidOrder.data, status: 'pending', paymentTxid: undefined }
    let reads = 0
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') {
        return { ok: true, json: async () => ({ code: -1, msg: 'Payment transaction is being claimed' }) }
      }
      reads++
      return {
        ok: true,
        json: async () => ({ code: 0, data: reads === 1 ? pending : { ...paidOrder.data, paymentTxid: txid } }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(wallet.createRgbIssueNia).mockResolvedValue({ assetId: 'rgb:issued' } as any)

    const result = await providerController.issueRgbNia({
      data: { params: { ...params, paymentTxid: txid } },
    })

    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    expect(result).toMatchObject({ status: 'issued', paymentTxid: txid, assetId: 'rgb:issued' })
  })

  it('returns only the asset ID and status after verified local issuance', async () => {
    vi.mocked(wallet.createRgbIssueNia).mockResolvedValue({
      assetId: 'rgb:issued', genesis: 'secret-genesis', contract: 'secret-contract',
      pendingConfirmation: false, syncPending: false,
    })
    const result = await providerController.issueRgbNia({ data: { params } })
    expect(fetch).toHaveBeenCalledWith(`https://wallet.example/v5/rgb/issue/order/${orderId}`)
    expect(result).toEqual({
      status: 'issued', paymentTxid: 'a'.repeat(64), assetId: 'rgb:issued',
      pendingConfirmation: false, syncPending: false,
    })
    expect(wallet.createRgbIssueNia).toHaveBeenCalledWith({
      orderId, issuanceTxid: 'a'.repeat(64),
      ticker: 'TOK', name: 'Token', precision: 0, amounts: ['100'],
    })
  })
})

describe('provider chain validation', () => {
  it.each(['constructor', 'toString', 'valueOf', '__proto__'])(
    'rejects inherited object key %s before switching',
    async chain => {
      const approval = Reflect.getMetadata('APPROVAL', providerController, 'switchChain')
      await expect(approval[1]({ data: { params: { chain } } })).rejects.toThrow('chain is invalid')
      await expect(
        providerController.switchChain({ data: { params: { chain } } } as any)
      ).rejects.toThrow('chain is invalid')
      expect(wallet.setChainType).not.toHaveBeenCalled()
    }
  )
})
