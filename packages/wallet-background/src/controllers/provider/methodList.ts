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
  getLamportPublicKey: {
    context: string
  }
  signWithLamport: {
    context: string
    proofBits: number[]
  }
}

export type ProviderMethods = keyof ProviderMethodList

export type ProviderMethodArgs<T extends ProviderMethods> = ProviderMethodList[T] extends undefined
  ? { method: T }
  : { method: T; params: ProviderMethodList[T] }
