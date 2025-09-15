// Business logic exports - includes runtime classes and functions
// For types only, import from '@unisat/babylon-service/types'

// API functions and classes
export { apiWrapper, ServerError } from './api';
export { getDelegationV2, getDelegationsV2 } from './api';
export { getDelegationV2StakingState } from './types/delegationsV2';

// Cosmos functionality 
export { CosmosKeyring } from './cosmos';
export { 
  Bech32Address, 
  PrivKeySecp256k1, 
  PubKeySecp256k1,
  convertBech32Address,
  publicKeyHexToAddress 
} from './cosmos';
export {
  sortObjectByKey,
  sortedJsonByKeyStringify,
  escapeHTML,
  serializeSignDoc,
  makeADR36AminoSignDoc,
  encodeSecp256k1Pubkey,
  encodeSecp256k1Signature
} from './cosmos';

// Utility functions
export { calculateFeeOptions, formatFee } from './utils';

// Re-export types and constants for convenience
// Users can also import these from '@unisat/babylon-service/types' for better tree-shaking
export type * from './types';
export type { Key, CosmosBalance, CosmosChainInfo, BabylonAddressSummary } from './cosmos';

// Constants and enums (these are actually needed at runtime)
export { 
  BabylonPhaseState, 
  ChainType, 
  BABYLON_CONFIG_MAP, 
  PHASE1,
  COSMOS_CHAINS,
  COSMOS_CHAINS_MAP,
  bbnTestnet5,
  bbnDevnet,
  bbnMainnet,
  DelegationV2StakingState,
  DELEGATION_STATUSES,
  ErrorType,
  CosmosSignDataType,
  DEFAULT_BBN_GAS_PRICE,
  DEFAULT_BBN_GAS_LIMIT
} from './types-only';
