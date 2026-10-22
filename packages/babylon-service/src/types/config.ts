// Phase 1 configuration (legacy)
export const PHASE1: {
  [key: string]: string
} = {}

export enum BabylonPhaseState {
  NONE,
  PENDING,
  ACTIVE,
  CLOSED,
}

export interface BabylonConfig {
  chainId: string
}

export interface BabylonConfigV2 {
  chainId: string
  phase1: {
    state: BabylonPhaseState
    title: string
    stakingUrl: string
    stakingApi: string
  }
  phase2: {
    state: BabylonPhaseState
    title: string
    stakingUrl: string
    stakingApi: string

    stakingStatus: {
      active_tvl: number
      active_delegations: number
      active_stakers: number
      active_finality_providers: number
      total_finality_providers: number
    }
  }
  showClaimed?: boolean
}

// Chain types enum - imported from extension for compatibility
export enum BabylonChainType {
  BITCOIN_MAINNET = 'BITCOIN_MAINNET',
  BITCOIN_SIGNET = 'BITCOIN_SIGNET',
}

export const BABYLON_CONFIG_MAP: { [key: string]: BabylonConfig } = {
  [BabylonChainType.BITCOIN_MAINNET]: {
    chainId: 'bbn-1',
  },
  [BabylonChainType.BITCOIN_SIGNET]: {
    chainId: 'bbn-test-6',
  },
}

// Default gas price for BABY
export const DEFAULT_BBN_GAS_PRICE = '0.007'
export const DEFAULT_BBN_GAS_LIMIT = '300000'
