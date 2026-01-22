import { AlkanesBalance } from './alkanes'
import { Inscription } from './inscription'
import { RuneBalance } from './runes'

export enum RiskType {
  SIGHASH_NONE,
  SCAMMER_ADDRESS,
  NETWORK_NOT_MATCHED,
  INSCRIPTION_BURNING,
  ATOMICALS_DISABLE, // deprecated
  ATOMICALS_NFT_BURNING, // deprecated
  ATOMICALS_FT_BURNING, // deprecated
  MULTIPLE_ASSETS,
  LOW_FEE_RATE,
  HIGH_FEE_RATE,
  SPLITTING_INSCRIPTIONS,
  MERGING_INSCRIPTIONS,
  CHANGING_INSCRIPTION,
  RUNES_BURNING,
  RUNES_MULTIPLE_ASSETS,
  INDEXER_API_DOWN,
  ATOMICALS_API_DOWN, // deprecated
  RUNES_API_DOWN,
  ALKANES_BURNING,
  ALKANES_MULTIPLE_ASSETS,
  UTXO_INDEXING,
}

export interface Risk {
  type: RiskType
  level: 'danger' | 'warning' | 'critical'
  title: string
  desc: string
}

export interface DecodedPsbtInput {
  txid: string
  vout: number
  address: string
  value: number
  inscriptions: Inscription[]
  sighashType: number
  runes: RuneBalance[]
  alkanes: AlkanesBalance[]
  contract?: ContractResult
}

export interface DecodedPsbtOutput {
  address: string
  value: number
  inscriptions: Inscription[]
  runes: RuneBalance[]
  alkanes: AlkanesBalance[]
  contract?: ContractResult
}

export interface DecodedPsbt {
  inputInfos: DecodedPsbtInput[]
  outputInfos: DecodedPsbtOutput[]
  inscriptions: { [key: string]: Inscription }
  feeRate: number
  fee: number
  features: {
    rbf: boolean
  }
  risks: Risk[]
  isScammer: boolean
  recommendedFeeRate: number
  shouldWarnFeeRate: boolean
  isCompleted: boolean
}

export interface ContractResult {
  id: string
  name: string
  description: string
  address: string
  script: string
  isOwned: boolean
}
