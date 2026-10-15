import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAINS_MAP } from '@unisat/wallet-shared'
import { ChainType } from '@unisat/wallet-types'

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
    getCurrentAccount: vi.fn(),
    createRgbIssueNia: vi.fn(),
  },
}))

import providerController from '../src/controllers/provider/controller'
import wallet from '../src/controllers/wallet'

const orderId = 'f7f0e1f0-0000-4000-8000-000000000001'
const params = { orderId, ticker: 'TOK', name: 'Token', precision: 0, amount: '100' }
const paidOrder = {
  code: 0,
  data: {
    status: 'paid', network: ChainType.BITCOIN_TESTNET4, address: 'tb1qowner',
    ticker: 'TOK', name: 'Token', precision: 0, amount: '100', feeSats: 1500,
    paymentTxid: 'a'.repeat(64),
  },
}
const originalEndpoints = CHAINS_MAP[ChainType.BITCOIN_TESTNET4]!.endpoints

describe('provider RGB issue payment gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    CHAINS_MAP[ChainType.BITCOIN_TESTNET4]!.endpoints = ['https://wallet.example']
    vi.mocked(wallet.getChainType).mockReturnValue(ChainType.BITCOIN_TESTNET4)
    vi.mocked(wallet.getCurrentAccount).mockResolvedValue({ address: 'tb1qowner' } as any)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => paidOrder }))
  })

  afterEach(() => {
    CHAINS_MAP[ChainType.BITCOIN_TESTNET4]!.endpoints = originalEndpoints
    vi.unstubAllGlobals()
  })

  it('rejects an unpaid or mismatched order before local issuance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ...paidOrder, data: { ...paidOrder.data, status: 'pending' } }),
    }))
    await expect(providerController.issueRgbNia({ data: { params } })).rejects.toThrow('does not match')
    expect(wallet.createRgbIssueNia).not.toHaveBeenCalled()
  })

  it('returns only the asset ID and status after verified local issuance', async () => {
    vi.mocked(wallet.createRgbIssueNia).mockResolvedValue({
      assetId: 'rgb:issued', genesis: 'secret-genesis', contract: 'secret-contract',
      pendingConfirmation: false, syncPending: false,
    })
    const result = await providerController.issueRgbNia({ data: { params } })
    expect(fetch).toHaveBeenCalledWith(`https://wallet.example/v5/rgb/issue/order/${orderId}`)
    expect(result).toEqual({ assetId: 'rgb:issued', pendingConfirmation: false, syncPending: false })
    expect(wallet.createRgbIssueNia).toHaveBeenCalledWith({
      orderId, ticker: 'TOK', name: 'Token', precision: 0, amounts: ['100'],
    })
  })
})
