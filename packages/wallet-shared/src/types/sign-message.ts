export enum SignMessageType {
  ECDSA = 'ecdsa',
  BIP322_SIMPLE = 'bip322-simple',
}

export interface ToSignMessage {
  text: string
  type: SignMessageType
}

export interface SignedMessage {
  signature: string
}

export interface SignMessageParams {
  data: {
    toSignMessages: ToSignMessage[]
  }
}

export type SignMessageResult = SignedMessage[]
