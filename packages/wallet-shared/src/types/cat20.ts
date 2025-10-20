export interface CAT721Balance {
  collectionId: string
  name: string
  count: number
  previewLocalIds: string[]
  contentType: string
}

export interface CAT721CollectionInfo {
  collectionId: string
  name: string
  symbol: string
  max: string
  premine: string
  description: string
  contentType: string
}

export interface AddressCAT721CollectionSummary {
  collectionInfo: CAT721CollectionInfo
  localIds: string[]
}

export interface CAT20Balance {
  tokenId: string
  amount: string
  name: string
  symbol: string
  decimals: number
}

export interface CAT20TokenInfo {
  tokenId: string
  name: string
  symbol: string
  max: string
  premine: string
  limit: number
  logo?: string
}

export interface AddressCAT20TokenSummary {
  cat20Info: CAT20TokenInfo
  cat20Balance: CAT20Balance
}

export interface AddressCAT20UtxoSummary {
  availableTokenAmounts: string[]
  availableUtxoCount: number
  totalUtxoCount: number
}

export interface CAT20MergeOrder {
  id: string
  batchIndex: number
  batchCount: number
  ct: number
}

export enum CAT_VERSION {
  V1 = 'v1',
  V2 = 'v2',
}
