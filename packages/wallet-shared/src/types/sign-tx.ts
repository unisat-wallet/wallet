interface BaseUserToSignInput {
  index: number
  sighashTypes: number[] | undefined
  useTweakedSigner?: boolean
  disableTweakSigner?: boolean
  tapLeafHashToSign?: string
}

export interface AddressUserToSignInput extends BaseUserToSignInput {
  address: string
}

export interface PublicKeyUserToSignInput extends BaseUserToSignInput {
  publicKey: string
}

export interface AddressUserToSignInput extends BaseUserToSignInput {
  address: string
}

export interface PublicKeyUserToSignInput extends BaseUserToSignInput {
  publicKey: string
}

export type UserToSignInput = AddressUserToSignInput | PublicKeyUserToSignInput
export interface SignPsbtOptions {
  autoFinalized?: boolean
  toSignInputs?: UserToSignInput[]
  contracts?: any[]
}

export interface ToSignInput {
  index: number
  publicKey: string
  sighashTypes?: number[]
  tapLeafHashToSign?: Buffer
}
