export interface AlkanesBalance {
  amount: string
  alkaneid: string
  name: string
  symbol: string
  divisibility: number
  available: string
}

export interface AlkanesInfo {
  alkaneid: string
  name: string
  symbol: string
  spacers?: number
  divisibility?: number
  height?: number
  totalSupply: string
  cap: number
  minted: number
  mintable: boolean
  perMint: string
  holders: number
  timestamp?: number
  type?: string
  maxSupply?: string
  premine?: string
  aligned?: boolean
  nftData?: {
    collectionId: string
    attributes?: any
    contentType?: string
    image?: string
    contentUrl?: string
  }
  logo?: string
  collectionData?: {
    holders: number
  }
}

export interface AddressAlkanesTokenSummary {
  tokenInfo: AlkanesInfo
  tokenBalance: AlkanesBalance
  tradeUrl?: string
  mintUrl?: string
}

export interface AlkanesCollection {
  alkaneid: string
  name: string
  count: number
  image: string
}
