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
  SIGHASH_SINGLE,
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

export interface PsbtLocalInfo {
  inputCount: number
  outputCount: number
  /** Formatted fee rate string, e.g. "12.5" or "≈12.5", "-" if unknown */
  feeRate: string
  /** Miner fee in satoshis; 0 if PSBT is not completed */
  fee: number
  /** Total value of all inputs in satoshis; 0 if PSBT is not completed */
  totalInput: number
  isCompleted: boolean
  hasSighashNone: boolean
  parseError: boolean
}

export interface LocalPsbtSummary {
  /** Sum of miner fees across all completed PSBTs */
  totalFee: number
  /** Sum of all input values across all completed PSBTs (total BTC being committed) */
  totalInput: number
  completedCount: number
  hasSighashNone: boolean
  parseErrorCount: number
  /** True if any input UTXO carries inscriptions, runes, or alkanes */
  hasAssets: boolean
  /** Per-PSBT decoded info for display in the multi-sign list */
  items: PsbtLocalInfo[]
}
