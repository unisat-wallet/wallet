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
  signRgbSellSwapAndPublishConsignment: {
    transferId: string
    makerSignedPsbt: string
  }
  /** Confirm the buyer-signed seller swap; its dApp broadcasts the final PSBT. */
  confirmRgbSellSwap: {
    transferId: string
    signedPsbt: string
  }
  /** Apply an already mutually agreed abort and release the seller RGB lock. */
  applyRgbSellSwapAbort: {
    transferId: string
  }
  /** Read the original dApp origin before applying a mutually agreed seller abort. */
  getRgbSellSwapAbortOrigin: {
    transferId: string
  }
  /** Mark an ACKed but mutually abandoned RGB receipt as canceled locally. */
  applyRgbBuySwapAbort: {
    recipientId: string
  }
  cancelRgbSwap: {
    transferId: string
  }
  getRgbSwapStatus: {
    transferId: string
  }
  /** Sign buyer BTC inputs and accept a validated BTC-for-RGB consignment. */
  signRgbBuySwapAndAcceptConsignment: {
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
