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
  sighashTypes?: number[] | undefined
  tapLeafHashToSign?: Buffer

  // special
  useTweakedSigner?: boolean
  disableTweakSigner?: boolean
}

export interface ToSignData {
  psbtHex: string
  toSignInputs: ToSignInput[]
  autoFinalized?: boolean

  // extra info for display
  estimatedFee?: number
  action?: PsbtActionInfo
}

export interface SignedData {
  psbtHex?: string
  rawtx?: string
  signature?: string
}

export interface SignPsbtParams {
  data: {
    toSignDatas: ToSignData[]
  }
}

export type SignPsbtResult = SignedData[]

export enum SignState {
  PENDING,
  SUCCESS,
  FAILED,
}

export enum PsbtActionType {
  DEFAULT = 'DEFAULT',
  CUSTOM = 'CUSTOM',
  SEND_INSCRIPTION = 'SEND_INSCRIPTION',
  SEND_RUNES = 'SEND_RUNES',
  SEND_ALKANES = 'SEND_ALKANES',
}

export enum PsbtActionDetailType {
  TEXT = 'TEXT',
  ADDRESS = 'ADDRESS',
  AMOUNT = 'AMOUNT',
  SATOSHIS = 'SATOSHIS',
  RUNES = 'RUNES',
  ALKANES = 'ALKANES',
  INSCRIPTION = 'INSCRIPTION',
  MULTIASSETS = 'MULTIASSETS',
}

export interface PsbtActionDetail {
  label: string // label, e.g., "Lockup Period", "Fee Rate"
  value: any // value, e.g., "10 days", "0.5%"
  type?: PsbtActionDetailType
  highlight?: boolean // whether to highlight
  warning?: boolean // whether to show warning style
}

export interface PsbtActionInfo {
  name: string // action name, e.g., "Send BTC"
  description: string // action description, e.g., "Sell your Ordinal #12345 for 0.01 BTC"
  details?: PsbtActionDetail[] // key information about the action
  icon?: string // action icon
  warning?: string // warning message, e.g., "This action is irreversible"
  type?: PsbtActionType
  extraProps?: any
}

export interface ApprovalSession {
  origin: string
  icon: string
  name: string
}
