// Cosmos signing types
export enum CosmosSignDataType {
  amino = 'amino',
  direct = 'direct',
}
export interface CosmosSignRequest {
  signData: string
  dataType: CosmosSignDataType
  path: string
  extra: {
    chainId?: string
    accountNumber?: string
    address?: string
  }
}
