import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    createRgbSendBegin: vi.fn(),
    getRgbPaymentOrigin: vi.fn(),
    getRgbPaymentStatus: vi.fn(),
  },
}))

import providerController from '../src/controllers/provider/controller'
import wallet from '../src/controllers/wallet'

describe('provider RGB payment ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists the trusted request origin while preparing a payment', async () => {
    vi.mocked(wallet.createRgbSendBegin).mockResolvedValue({ id: 'transfer-1' } as any)

    await providerController.prepareRgbPayment({
      data: { params: { invoice: 'rgb:invoice', assetId: 'rgb:asset' } },
      session: { origin: 'https://dapp.example' },
    })

    expect(wallet.createRgbSendBegin).toHaveBeenCalledWith({
      invoice: 'rgb:invoice',
      assetId: 'rgb:asset',
      providerOrigin: 'https://dapp.example',
    })
  })

  it('authorizes payment status from the persisted owner after a worker restart', async () => {
    vi.mocked(wallet.getRgbPaymentOrigin).mockResolvedValue('https://dapp.example')
    vi.mocked(wallet.getRgbPaymentStatus).mockResolvedValue({
      transferId: 'transfer-1',
      status: 'prepared',
    } as any)
    const request = {
      data: { params: { transferId: 'transfer-1' } },
      session: { origin: 'https://dapp.example' },
    }

    await expect(providerController.getRgbPaymentStatus(request)).resolves.toEqual({
      transferId: 'transfer-1',
      status: 'prepared',
    })
    expect(wallet.getRgbPaymentOrigin).toHaveBeenCalledWith({ transferId: 'transfer-1' })

    await expect(
      providerController.getRgbPaymentStatus({
        ...request,
        session: { origin: 'https://other.example' },
      })
    ).rejects.toThrow('RGB payment is not available to this site')
  })
})
