export interface Atomical {
  atomicalId: string
  atomicalNumber: number
  type: 'FT' | 'NFT'
  ticker?: string
  atomicalValue: number

  // mint info
  address: string
  outputValue: number
  preview: string
  content: string
  contentType: string
  contentLength: number
  timestamp: number
  genesisTransaction: string
  location: string
  output: string
  offset: number
  contentBody: string
  utxoHeight: number
  utxoConfirmation: number
}
