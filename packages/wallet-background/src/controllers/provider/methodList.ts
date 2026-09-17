import { SignMessageType } from '@unisat/wallet-shared'
import { ChainType, NetworkType } from '@unisat/wallet-types'

export type ProviderMethodList = {
  signPsbt: {
    psbtHex: string
    option?: any
  }
  multiSignPsbt: {
    psbtHexs?: string[]
    options?: any
  }
  signMessage: {
    text: string
    type: SignMessageType
  }
  multiSignMessage: {
    messages: {
      text: string
      type: string
    }[]
  }
  switchChain: {
    chain: ChainType
  }
  switchNetwork: {
    network: NetworkType
  }
  inscribeTransfer: {
    ticker: string
    amount: string
  }
  cosmosEnable: {
    chainId: string
  }
  cosmosSignDirect: {
    signDoc: any
  }
  cosmosSignArbitrary: {
    signerAddress: string
    data: string
  }
  /**
   * @experimental This method may change in future versions.
   */
  deriveContextHash: {
    appName: string
    context: string
  }
  /** Experimental RGB dApp API. Interfaces may change before public release. */
  getRgbAssets: {
    page?: number
    pageSize?: number
  }
  getRgbFundingUtxos: {
    assetId: string
  }
  getRgbFeeUtxos: undefined
  createRgbReceiveInvoice: {
    assetId?: string
    amount?: string
    durationSeconds?: number
    recipientType?: 'blind' | 'witness'
  }
  getRgbPendingReceives: undefined
  acceptRgbReceive: {
    recipientId: string
  }
  rejectRgbReceive: {
    recipientId: string
  }
  prepareRgbPayment: {
    invoice: string
    assetId: string
    amount?: string
    feeRate?: number
  }
  signRgbPayment: {
    transferId: string
  }
  cancelRgbPayment: {
    transferId: string
  }
  getRgbPaymentStatus: {
    transferId: string
  }
  /**
   * Experimental RGB/BTC swap: the maker supplies an unsigned Opret-first
   * template and the wallet colors only the locally reserved RGB inputs.
   */
  prepareRgbSwap: {
    invoice: string
    assetId: string
    amount: string
    btcReceiveAmount: string
    feeRate?: number
    psbt: string
  }
  finalizeRgbSwap: {
    transferId: string
    makerSignedPsbt: string
  }
  /** Validate a completed seller swap; its dApp broadcasts the final PSBT. */
  completeRgbSwap: {
    transferId: string
    signedPsbt: string
  }
  cancelRgbSwap: {
    transferId: string
  }
  getRgbSwapStatus: {
    transferId: string
  }
  /** Complete a buyer-side BTC-for-RGB swap after its consignment is validated. */
  completeRgbBuySwap: {
    recipientId: string
    assetId: string
    amount: string
    maxBtcSpend: string
    makerSignedPsbt: string
  }
}

export type ProviderMethods = keyof ProviderMethodList

export type ProviderMethodArgs<T extends ProviderMethods> = ProviderMethodList[T] extends undefined
  ? { method: T }
  : { method: T; params: ProviderMethodList[T] }
