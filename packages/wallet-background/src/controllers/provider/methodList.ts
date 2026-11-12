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
    chainId: string
    signerAddress: string
    signDoc: any
  }
  cosmosSignArbitrary: {
    chainId: string
    signerAddress: string
    type: 'string' | 'Uint8Array'
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
  webRgbEnable: undefined
  webRgbGetInfo: undefined
  webRgbGetAddress: undefined
  webRgbListAssets: undefined
  webRgbGetAssetBalance: { assetId: string }
  webRgbListTransfers: { assetId?: string }
  webRgbGetTransferStatus: { transferId: string; assetId?: string }
  webRgbPrepareBurn: {
    network: string
    assetId: string
    amount: string
    burnRecipient: { chainId: string; address: string }
    feeRate?: number
    minConfirmations?: number
  }
  webRgbGetConsignment: { assetId: string; txid: string }
  webRgbDecodeInvoice: { invoice: string }
  webRgbBuildInvoice: {
    assetId: string
    amount: number
    recipientId: string
    transportEndpoints?: string[]
  }
  webRgbReleasePreparedPayment: { transferId: string }
  getRgbFundingUtxos: {
    assetId: string
  }
  getRgbFeeUtxos: undefined
  getRgbIssueAvailability: undefined
  issueRgbNia: {
    orderId: string
    ticker: string
    name: string
    precision: number
    amount: string
    paymentTxid?: string
  }
  createRgbReceiveInvoice: {
    assetId?: string
    amount?: string
    durationSeconds?: number
    recipientType?: 'blind' | 'witness'
    minConfirmations?: number
    purpose?: 'buy_swap'
    proxyId?: string
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
    amount?: string | number
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
    backendPublicKey?: string
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
  /** Accept a backend-held final transaction after its commitment and Proxy ACK verify. */
  acceptRgbSellSwap: {
    transferId: string
    txid: string
    transactionCommitment: string
  }
  /** Apply an already mutually agreed abort and release the seller RGB lock. */
  applyRgbSellSwapAbort: {
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
  /** Sign only buyer BTC inputs; maker signatures and ACK remain server-controlled. */
  signRgbBuySwap: {
    recipientId: string
    assetId: string
    amount: string
    maxBtcSpend: string
    swapPsbt: string
  }
  /** ACK only after the Proxy v1 sender proves its backend committed this buyer PSBT. */
  acceptRgbBuySwap: {
    recipientId: string
    backendCommit: string
  }
}

export type ProviderMethods = keyof ProviderMethodList

export type ProviderMethodArgs<T extends ProviderMethods> = ProviderMethodList[T] extends undefined
  ? { method: T }
  : { method: T; params: ProviderMethodList[T] }
