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
  createRgbBlindReceive: {
    assetId?: string
    amount?: number | string
    minConfirmations?: number
    durationSeconds?: number
  }
  createRgbWitnessReceive: {
    assetId?: string
    amount: number | string
    minConfirmations?: number
    durationSeconds?: number
  }
  getRgbFundingAddress: undefined
  signRgbPsbt: {
    psbt: string
    toSignDatas?: any[]
  }
}

export type ProviderMethods = keyof ProviderMethodList

export type ProviderMethodArgs<T extends ProviderMethods> = ProviderMethodList[T] extends undefined
  ? { method: T }
  : { method: T; params: ProviderMethodList[T] }
