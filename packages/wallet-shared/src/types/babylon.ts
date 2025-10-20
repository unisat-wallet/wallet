export interface BabylonStakingStatusV2 {
  active_tvl: number
  active_delegations: number
  active_stakers: number
  active_finality_providers: number
  total_finality_providers: number
}

export interface CosmosBalance {
  denom: string
  amount: string
}

export interface BabylonAddressSummary {
  address: string
  balance: CosmosBalance
  rewardBalance: number
  stakedBalance: number
}

export interface BabylonTxInfo {
  toAddress: string
  balance: CosmosBalance
  unitBalance: CosmosBalance
  memo: string
  txFee: CosmosBalance
  gasLimit: number
  gasPrice: string
  gasAdjustment?: number
}

/**
 * Sign data type
 * @enum {number}
 * @readonly
 * @enum {number}
 * @readonly
 */
export enum CosmosSignDataType {
  COSMOS_AMINO = 1,
  COSMOS_DIRECT = 2,
}
