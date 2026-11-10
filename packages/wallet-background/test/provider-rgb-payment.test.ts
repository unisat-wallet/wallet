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
    stageRgbBuySwapIntent: vi.fn(),
    acceptRgbBuySwap: vi.fn(),
    getRgbPendingReceiveInvoices: vi.fn(),
    abandonRgbAcceptedReceive: vi.fn(),
    getRgbProxyApprovalRequirement: vi.fn(),
    approveRgbProxyEndpoints: vi.fn(),
    getCurrentRgbWalletRef: vi.fn(),
    exportRgbBurnConsignment: vi.fn(),
    getRgbFeatureStatus: vi.fn(),
    getRgbReceiveProxyConfig: vi.fn(),
    getChainType: vi.fn(),
    getCurrentAccount: vi.fn(),
    getNetworkType: vi.fn(),
    getToSignData: vi.fn(),
  },
}))

import providerController from '../src/controllers/provider/controller'
import wallet from '../src/controllers/wallet'
import { MAX_FEE_RATE } from '@unisat/base-utils'
import { proxyV1PublicKey, proxyV1Sign } from '../src/adapters/rgb-proxy-v1'
import { NetworkType } from '@unisat/wallet-types'
import * as bitcoin from 'bitcoinjs-lib'

describe('provider RGB payment ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(wallet.getRgbReceiveProxyConfig).mockResolvedValue({
      profiles: [],
    } as any)
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
      'webRgbPrepareBurn',
      'webRgbGetConsignment',
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

  it('advertises the WebRGB burn and proof routes with supported namespaces', async () => {
    vi.mocked(wallet.getRgbFeatureStatus).mockResolvedValue({ enabled: true, supported: true } as any)
    vi.mocked(wallet.getCurrentRgbWalletRef).mockResolvedValue({ network: 'T0' } as any)
    vi.mocked(wallet.getRgbReceiveProxyConfig).mockResolvedValue({
      profiles: [
        {
          id: 'legacy',
          name: 'Proxy 0.3',
          endpoint: 'rpcs://proxy.example/v1',
          protocolVersion: '1.0',
          serverVersion: '0.3.0',
        },
        {
          id: 'current',
          name: 'Proxy 0.4',
          endpoint: 'rpcs://proxy.example/v0_4_0/v1',
          protocolVersion: '1.0',
          serverVersion: '0.4.0',
        },
      ],
      defaultProxyId: 'current',
    } as any)

    await expect(providerController.webRgbGetInfo()).resolves.toMatchObject({
      ready: true,
      network: 'T0',
      protocol: 'RGB_L1',
      methods: expect.arrayContaining(['burnAsset', 'getConsignment']),
      burnRecipientNamespaces: ['eip155', 'tron'],
      defaultProxyId: 'current',
      proxyProfiles: [
        expect.objectContaining({
          id: 'legacy', protocolVersion: '1.0', serverVersion: '0.3.0', recommended: false,
        }),
        expect.objectContaining({
          id: 'current', protocolVersion: '1.0', serverVersion: '0.4.0', recommended: true,
        }),
      ],
    })
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

  it('resolves the trusted receive proxy profile before opening approval', async () => {
    vi.mocked(wallet.getRgbReceiveProxyConfig).mockResolvedValue({
      profiles: [
        {
          id: 'legacy',
          name: 'Proxy 0.3',
          endpoint: 'rpcs://proxy.example/v1',
          protocolVersion: '1.0',
          serverVersion: '0.3.0',
        },
        {
          id: 'current',
          name: 'Proxy 0.4',
          endpoint: 'rpcs://proxy.example/v0_4_0/v1',
          protocolVersion: '1.0',
          serverVersion: '0.4.0',
        },
      ],
      defaultProxyId: 'current',
    } as any)
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'createRgbReceiveInvoice')
    const request = {
      data: {
        params: {
          proxyId: 'legacy',
          proxyProfile: { id: 'forged', endpoint: 'rpcs://evil.example' },
        },
      },
      session: { origin: 'https://dapp.example' },
    }

    await approval[1](request)

    expect(request.data.params.proxyProfile).toEqual({
      id: 'legacy',
      name: 'Proxy 0.3',
      endpoint: 'rpcs://proxy.example/v1',
      protocolVersion: '1.0',
      serverVersion: '0.3.0',
      recommended: false,
    })
  })

  it('pins the configured default proxy before opening receive approval', async () => {
    vi.mocked(wallet.getRgbReceiveProxyConfig).mockResolvedValue({
      profiles: [{
        id: 'current',
        name: 'Proxy 0.4',
        endpoint: 'rpcs://proxy.example/v0_4_0/v1',
        protocolVersion: '1.0',
        serverVersion: '0.4.0',
      }],
      defaultProxyId: 'current',
    } as any)
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'createRgbReceiveInvoice')
    const request = {
      data: { params: {} as Record<string, any> },
      session: { origin: 'https://dapp.example' },
    }

    await approval[1](request)

    expect(request.data.params.proxyId).toBe('current')
    expect(request.data.params.proxyProfile).toEqual(expect.objectContaining({
      id: 'current',
      recommended: true,
    }))
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
      data: { params: { assetId: 'rgb:asset', amount: '1', proxyId: 'legacy' } },
      session: { origin: 'https://dapp.example' },
    })

    expect(wallet.createRgbBlindReceive).toHaveBeenCalledWith({
      assetId: 'rgb:asset',
      amount: '1',
      proxyId: 'legacy',
      providerOrigin: 'https://dapp.example',
    })
  })

  it('marks buy-swap invoices as backend-committed ACK only', async () => {
    vi.mocked(wallet.createRgbBlindReceive).mockResolvedValue({ recipientId: 'recipient-1' } as any)

    await providerController.createRgbReceiveInvoice({
      data: { params: { assetId: 'rgb:asset', amount: '1', purpose: 'buy_swap' } },
      session: { origin: 'https://dapp.example' },
    })

    expect(wallet.createRgbBlindReceive).toHaveBeenCalledWith({
      assetId: 'rgb:asset',
      amount: '1',
      acceptancePolicy: 'buy_swap_backend_commit',
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

  it('validates and origin-binds a WebRGB BFA burn before reserving funds', async () => {
    vi.mocked(wallet.getCurrentRgbWalletRef).mockResolvedValue({ network: 'T0' } as any)
    vi.mocked(wallet.createRgbSendBegin).mockResolvedValue({ id: 'burn-1' } as any)
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'webRgbPrepareBurn')
    const params: Record<string, any> = {
      network: 'T0',
      assetId: 'rgb:bfa',
      amount: '18446744073709551615',
      burnRecipient: { chainId: 'eip155:42161', address: `0x${'11'.repeat(20)}` },
      minConfirmations: 1,
    }
    await approval[1]({ data: { params } })
    expect(params.minConfirmations).toBe(3)
    expect(params.burnDestination).toMatchObject({
      destinationChainId: 42161,
      recipient: '11'.repeat(20),
    })

    await providerController.webRgbPrepareBurn({
      data: { params },
      session: { origin: 'https://dapp.example' },
    } as any)
    expect(wallet.createRgbSendBegin).toHaveBeenCalledWith(expect.objectContaining({
      invoice: '',
      assetId: 'rgb:bfa',
      amount: '18446744073709551615',
      burn: true,
      minConfirmations: 3,
      providerOrigin: 'https://dapp.example',
    }))
  })

  it.each([
    ['18446744073709551616', 'T0'],
    ['01', 'T0'],
    ['1', 'OTHER'],
  ])('rejects an invalid WebRGB burn amount/network before preparation', async (amount, network) => {
    vi.mocked(wallet.getCurrentRgbWalletRef).mockResolvedValue({ network: 'T0' } as any)
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'webRgbPrepareBurn')
    await expect(approval[1]({ data: { params: {
      network, assetId: 'rgb:bfa', amount,
      burnRecipient: { chainId: 'eip155:42161', address: `0x${'11'.repeat(20)}` },
    } } })).rejects.toThrow()
    expect(wallet.createRgbSendBegin).not.toHaveBeenCalled()
  })

  it('validates a saved burn proof before opening the sharing approval', async () => {
    vi.mocked(wallet.exportRgbBurnConsignment).mockResolvedValue(Buffer.from('RGB\0TFRproof').toString('base64'))
    const txid = 'ab'.repeat(32)
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'webRgbGetConsignment')
    const request = { data: { params: { assetId: 'rgb:bfa', txid } as Record<string, any> } }
    await approval[1](request)
    expect(request.data.params.proof).toMatchObject({
      byteLength: 12,
      digest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    })
    await expect(providerController.webRgbGetConsignment(request as any)).resolves.toMatchObject({
      assetId: 'rgb:bfa',
      txid,
      encoding: 'base64',
      byteLength: 12,
      digest: { algorithm: 'keccak256', value: expect.stringMatching(/^0x[0-9a-f]{64}$/) },
    })
    expect(wallet.exportRgbBurnConsignment).toHaveBeenCalledWith(txid, 'rgb:bfa')
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

  it('rejects maker signatures before opening buy-swap signing approval', async () => {
    const buyer = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'),
      network: bitcoin.networks.bitcoin,
    })
    const maker = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from('0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'),
      network: bitcoin.networks.bitcoin,
    })
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin })
      .addInput({
        hash: '11'.repeat(32), index: 0,
        witnessUtxo: { script: buyer.output!, value: 20_000 },
      })
      .addInput({
        hash: '22'.repeat(32), index: 0,
        witnessUtxo: { script: maker.output!, value: 10_000 },
      })
      .addOutput({ script: buyer.output!, value: 5_000 })
    psbt.updateInput(1, { finalScriptWitness: Buffer.from([0]) })
    const unsignedTx = (psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx
    vi.mocked(wallet.getRgbBuySwapReceive).mockResolvedValue({
      providerOrigin: 'https://dapp.example',
      assetId: 'rgb:asset', amount: '1', txid: unsignedTx.getId(), accepted: false,
    } as any)
    vi.mocked(wallet.getCurrentAccount).mockResolvedValue({ address: buyer.address } as any)
    vi.mocked(wallet.getNetworkType).mockReturnValue(NetworkType.MAINNET)
    const approval = Reflect.getMetadata('APPROVAL', providerController, 'signRgbBuySwap')

    await expect(approval[1]({
      data: { params: {
        recipientId: 'recipient-1', assetId: 'rgb:asset', amount: '1',
        maxBtcSpend: '20000', swapPsbt: psbt.toHex(),
      } },
      session: { origin: 'https://dapp.example' },
    })).rejects.toThrow('must not expose maker signatures')
    expect(wallet.getToSignData).not.toHaveBeenCalled()
  })

  it('accepts a buy swap only with the bound Proxy v1 sender commitment', async () => {
    const senderPrivateKey = '11'.repeat(32)
    const receive = {
      providerOrigin: 'https://dapp.example',
      proxyTransferId: '22'.repeat(32),
      proxySenderPublicKey: proxyV1PublicKey(senderPrivateKey),
      buySwapIntent: {
        txid: '33'.repeat(32),
        buyerSignedPsbtHash: '44'.repeat(32),
      },
    }
    vi.mocked(wallet.getRgbBuySwapReceive).mockResolvedValue(receive as any)
    vi.mocked(wallet.acceptRgbBuySwap).mockResolvedValue({
      accepted: true,
      status: 'accepted',
    } as any)
    const message = `rgb-buy-swap/commit/v1:${receive.proxyTransferId}:${receive.buySwapIntent.txid}:${receive.buySwapIntent.buyerSignedPsbtHash}`

    await expect(providerController.acceptRgbBuySwap({
      data: {
        params: {
          recipientId: 'recipient-1',
          backendCommit: proxyV1Sign(senderPrivateKey, message),
        },
      },
      session: { origin: 'https://dapp.example' },
    })).resolves.toEqual({ recipientId: 'recipient-1', status: 'accepted' })
    expect(wallet.acceptRgbBuySwap).toHaveBeenCalledWith({ recipientId: 'recipient-1' })
  })

  it('rejects a forged buy swap backend commitment before ACK', async () => {
    vi.mocked(wallet.getRgbBuySwapReceive).mockResolvedValue({
      providerOrigin: 'https://dapp.example',
      proxyTransferId: '22'.repeat(32),
      proxySenderPublicKey: proxyV1PublicKey('11'.repeat(32)),
      buySwapIntent: {
        txid: '33'.repeat(32),
        buyerSignedPsbtHash: '44'.repeat(32),
      },
    } as any)

    await expect(providerController.acceptRgbBuySwap({
      data: { params: { recipientId: 'recipient-1', backendCommit: '55'.repeat(64) } },
      session: { origin: 'https://dapp.example' },
    })).rejects.toThrow('backend commitment is invalid')
    expect(wallet.acceptRgbBuySwap).not.toHaveBeenCalled()
  })
})
