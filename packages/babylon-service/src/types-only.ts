// Pure type definitions and enums - no business logic
// This file only exports types, enums, and constants that can be tree-shaken

// Configuration types and enums
export { BabylonPhaseState, ChainType, BABYLON_CONFIG_MAP, PHASE1 } from './types/config';

// Chain configurations (pure data)
export { COSMOS_CHAINS, COSMOS_CHAINS_MAP, bbnTestnet5, bbnDevnet, bbnMainnet } from './types/cosmosChain';

// Delegation types and enums
export { DelegationV2StakingState, DELEGATION_STATUSES } from './types/delegationsV2';

// Error types
export { ErrorType } from './types/errors';

// Cosmos types
export type { Key, CosmosBalance, CosmosChainInfo, BabylonAddressSummary } from './cosmos/types';
export { CosmosSignDataType } from './cosmos/types';

// API types (interfaces and type definitions only)
export type * from './types/api';

// Constants (can be tree-shaken as they're just data)
export { DEFAULT_BBN_GAS_PRICE, DEFAULT_BBN_GAS_LIMIT } from './cosmos/CosmosKeyring';