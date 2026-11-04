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
    createRgbBlindReceive: vi.fn(),
    getRgbPaymentOrigin: vi.fn(),
    getRgbPaymentStatus: vi.fn(),
    abortRgbAcknowledgedSwap: vi.fn(),
    abortRgbVanillaTx: vi.fn(),
    getRgbBuySwapReceive: vi.fn(),
    getRgbPendingReceiveInvoices: vi.fn(),
    abandonRgbAcceptedReceive: vi.fn(),
    getRgbProxyApprovalRequirement: vi.fn(),
    approveRgbProxyEndpoints: vi.fn(),
  },
}))

import providerController from '../src/controllers/provider/controller'
import wallet from '../src/controllers/wallet'
import { MAX_FEE_RATE } from '@unisat/base-utils'

describe('provider RGB payment ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires wallet unlock for every account-bound RGB method', () => {
    const accountBoundMethods = [
      'getRgbAssets',
      'webRgbEnable',
      'webRgbGetInfo',
      'webRgbGetAddress',
      'webRgbListAssets',
      'webRgbGetAssetBalance',
      'webRgbListTransfers',
      'webRgbGetTransferStatus',
      'webRgbReleasePreparedPayment',
      'getRgbFundingUtxos',
      'getRgbFeeUtxos',
      'getRgbIssueAvailability',
      'getRgbPendingReceives',
      'getRgbPaymentStatus',
      'confirmRgbSellSwap',
      'getRgbSwapStatus',
    ]

    for (const method of accountBoundMethods) {
      expect(Reflect.getMetadata('SAFE', providerController, method), method).not.toBe(true)
    }
  })

  it('keeps account-independent invoice helpers callable while locked', () => {
    expect(Reflect.getMetadata('SAFE', providerController, 'webRgbDecodeInvoice')).toBe(true)
    expect(Reflect.getMetadata('SAFE', providerController, 'webRgbBuildInvoice')).toBe(true)
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

  it('normalizes a numeric payment amount before approval and preparation', async () => {
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'prepareRgbPayment')
    const invoice =
      'rgb:BQUFBQUF-BQUFBQU-FBQUFBQ-UFBQUFB-QUFBQUF-BQUFBQU/~/~/bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw?amount=42&endpoints=rpcs%3A%2F%2Fproxy.example'
    const request = {
      data: {
        params: { invoice, assetId: 'rgb:asset', amount: 100 } as Record<string, any>,
      },
      session: { origin: 'https://dapp.example' },
    }
    vi.mocked(wallet.getRgbProxyApprovalRequirement).mockResolvedValue({ endpoints: [] })
    vi.mocked(wallet.createRgbSendBegin).mockResolvedValue({ id: 'transfer-1' } as any)

    await approval[1](request)
    expect(request.data.params.amount).toBe('100')

    await providerController.prepareRgbPayment(request as any)
    expect(wallet.createRgbSendBegin).toHaveBeenCalledWith({
      invoice,
      assetId: 'rgb:asset',
      amount: '100',
      providerOrigin: 'https://dapp.example',
    })
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, {}, '1.5', '01']) (
    'rejects invalid payment amount %j before approval',
    async amount => {
      const approval = Reflect.getMetadata('APPROVAL', providerController, 'prepareRgbPayment')
      const request = {
        data: { params: { invoice: 'rgb:invoice', assetId: 'rgb:asset', amount } },
        session: { origin: 'https://dapp.example' },
      }

      expect(() => approval[1](request)).toThrow(/amount must be/)
      expect(wallet.getRgbProxyApprovalRequirement).not.toHaveBeenCalled()
    }
  )

  it.each(['prepareRgbPayment', 'prepareRgbSwap'])(
    'adds untrusted invoice proxies to the existing %s approval',
    async method => {
      const invoice =
        'rgb:BQUFBQUF-BQUFBQU-FBQUFBQ-UFBQUFB-QUFBQUF-BQUFBQU/~/~/bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw?amount=42&endpoints=rpcs%3A%2F%2Fproxy.example'
      vi.mocked(wallet.getRgbProxyApprovalRequirement).mockResolvedValue({
        endpoints: ['https://proxy.example'],
      })
      const approval = Reflect.getMetadata('APPROVAL', providerController, method)
      const request = {
        data: { params: { invoice, assetId: 'rgb:asset' } as Record<string, any> },
        session: { origin: 'https://dapp.example' },
      }

      await approval[1](request)

      expect(wallet.getRgbProxyApprovalRequirement).toHaveBeenCalledWith({
        endpoints: ['rpcs://proxy.example'],
      })
      expect(request.data.params.rgbProxyApproval).toEqual({
        endpoints: ['https://proxy.example'],
      })
    }
  )

  it('binds the proxy approval result before preparing the payment', async () => {
    vi.mocked(wallet.createRgbSendBegin).mockResolvedValue({ id: 'transfer-1' } as any)
    await providerController.prepareRgbPayment({
      data: {
        params: {
          invoice: 'rgb:invoice',
          assetId: 'rgb:asset',
          rgbProxyApproval: { endpoints: ['https://proxy.example'] },
        },
      },
      session: { origin: 'https://dapp.example' },
      approvalRes: { approvedRgbProxyEndpoints: ['https://proxy.example'] },
    })

    expect(wallet.approveRgbProxyEndpoints).toHaveBeenCalledWith({
      endpoints: ['https://proxy.example'],
    })
    expect(vi.mocked(wallet.approveRgbProxyEndpoints).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(wallet.createRgbSendBegin).mock.invocationCallOrder[0]!
    )
  })

  it('rejects a payment when the approved proxy does not exactly match the invoice', async () => {
    await expect(
      providerController.prepareRgbPayment({
        data: {
          params: {
            invoice: 'rgb:invoice',
            assetId: 'rgb:asset',
            rgbProxyApproval: { endpoints: ['https://proxy.example'] },
          },
        },
        session: { origin: 'https://dapp.example' },
        approvalRes: { approvedRgbProxyEndpoints: ['https://other.example'] },
      })
    ).rejects.toThrow('Third-party RGB proxy was not approved')
    expect(wallet.approveRgbProxyEndpoints).not.toHaveBeenCalled()
    expect(wallet.createRgbSendBegin).not.toHaveBeenCalled()
  })

  it('persists the trusted request origin while creating a receive invoice', async () => {
    vi.mocked(wallet.createRgbBlindReceive).mockResolvedValue({ recipientId: 'recipient-1' } as any)

    await providerController.createRgbReceiveInvoice({
      data: { params: { assetId: 'rgb:asset', amount: '1' } },
      session: { origin: 'https://dapp.example' },
    })

    expect(wallet.createRgbBlindReceive).toHaveBeenCalledWith({
      assetId: 'rgb:asset',
      amount: '1',
      providerOrigin: 'https://dapp.example',
    })
  })

  it('rejects an excessive payment fee rate before opening approval', async () => {
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'prepareRgbPayment')
    const request = {
      data: { params: { invoice: 'rgb:invoice', assetId: 'rgb:asset', feeRate: MAX_FEE_RATE + 1 } },
      session: { origin: 'https://dapp.example' },
    }

    expect(() => approval[1](request)).toThrow('fee rate must be between')
    expect(wallet.createRgbSendBegin).not.toHaveBeenCalled()
  })

  it('rejects an excessive swap fee rate before opening approval', () => {
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'prepareRgbSwap')
    const request = {
      data: { params: { feeRate: MAX_FEE_RATE + 1 } },
      session: { origin: 'https://dapp.example' },
    }

    expect(() => approval[1](request)).toThrow('fee rate must be between')
    expect(wallet.createRgbSendBegin).not.toHaveBeenCalled()
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

  it.each(['applyRgbSellSwapAbort', 'cancelRgbSwap'])(
    'rejects cross-origin %s before opening approval',
    async method => {
      vi.mocked(wallet.getRgbPaymentOrigin).mockResolvedValue('https://owner.example')
      const approval = Reflect.getMetadata('APPROVAL', providerController, method)

      await expect(
        approval[1]({
          data: { params: { transferId: 'transfer-1' } },
          session: { origin: 'https://other.example' },
        })
      ).rejects.toThrow('RGB payment is not available to this site')
      expect(wallet.abortRgbAcknowledgedSwap).not.toHaveBeenCalled()
      expect(wallet.abortRgbVanillaTx).not.toHaveBeenCalled()
    }
  )

  it('adds the origin-owned transaction identity to cancellation approval', async () => {
    vi.mocked(wallet.getRgbPaymentOrigin).mockResolvedValue('https://owner.example')
    vi.mocked(wallet.getRgbPaymentStatus).mockResolvedValue({
      transferId: 'transfer-1',
      assetId: 'rgb:asset',
      amount: '10',
      status: 'waiting_ack',
    } as any)
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'cancelRgbSwap')
    const request = {
      data: { params: { transferId: 'transfer-1' } as Record<string, unknown> },
      session: { origin: 'https://owner.example' },
    }

    await approval[1](request)

    expect(request.data.params.payment).toMatchObject({
      transferId: 'transfer-1',
      assetId: 'rgb:asset',
      amount: '10',
      status: 'waiting_ack',
    })
  })

  it('rejects a cross-origin buyer abort', async () => {
    vi.mocked(wallet.getRgbBuySwapReceive).mockResolvedValue({
      providerOrigin: 'https://owner.example',
    } as any)

    await expect(
      providerController.applyRgbBuySwapAbort({
        data: { params: { recipientId: 'recipient-1' } },
        session: { origin: 'https://other.example' },
      })
    ).rejects.toThrow('RGB receive is not available to this site')
    expect(wallet.abandonRgbAcceptedReceive).not.toHaveBeenCalled()
  })

  it('rejects a buyer abort before approval when the receive is not owned by the origin', async () => {
    vi.mocked(wallet.getRgbPendingReceiveInvoices).mockResolvedValue({ list: [] } as any)
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'applyRgbBuySwapAbort')

    await expect(
      approval[1]({
        data: { params: { recipientId: 'recipient-1' } },
        session: { origin: 'https://other.example' },
      })
    ).rejects.toThrow('RGB receive is not available for swap abort')
    expect(wallet.getRgbPendingReceiveInvoices).toHaveBeenCalledWith({
      providerOrigin: 'https://other.example',
    })
  })

  it('filters pending receives to the requesting origin', async () => {
    vi.mocked(wallet.getRgbPendingReceiveInvoices).mockResolvedValue({ list: [] } as any)

    await providerController.getRgbPendingReceives({
      session: { origin: 'https://dapp.example' },
    })

    expect(wallet.getRgbPendingReceiveInvoices).toHaveBeenCalledWith({
      providerOrigin: 'https://dapp.example',
    })
  })
})
