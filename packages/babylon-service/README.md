# @unisat/babylon-service

Babylon Bitcoin staking service for UniSat Wallet - handles delegation management and API interactions.

## Features

- 🔗 **Delegation Management**: Get and manage Bitcoin staking delegations
- 🌐 **API Integration**: Interact with Babylon staking APIs
- 📊 **State Management**: Handle delegation states and transitions
- 🛡️ **Error Handling**: Robust error handling with typed errors
- 📦 **TypeScript**: Full TypeScript support with type definitions

## Installation

```bash
npm install @unisat/babylon-service
# or
yarn add @unisat/babylon-service
# or
pnpm add @unisat/babylon-service
```

## Usage

```typescript
import { getDelegationsV2, getDelegationV2, DelegationV2StakingState } from '@unisat/babylon-service';

// Get paginated delegations for a staker
const delegations = await getDelegationsV2(
  'https://api.babylon.io',
  'publicKeyNoCoord',
  'optionalPageKey'
);

// Get a specific delegation
const delegation = await getDelegationV2(
  'https://api.babylon.io',
  'stakingTxHashHex'
);

// Check delegation state
if (delegation?.state === DelegationV2StakingState.ACTIVE) {
  console.log('Delegation is active');
}
```

## API Reference

### Functions

#### `getDelegationsV2(baseUrl, publicKeyNoCoord, pageKey?)`

Get paginated delegations for a staker.

- `baseUrl`: The Babylon API base URL
- `publicKeyNoCoord`: The staker's public key (without coordinate)
- `pageKey`: Optional pagination key for next page

Returns: `Promise<PaginatedDelegations>`

#### `getDelegationV2(baseUrl, stakingTxHashHex)`

Get a specific delegation by staking transaction hash.

- `baseUrl`: The Babylon API base URL
- `stakingTxHashHex`: The staking transaction hash

Returns: `Promise<DelegationV2 | null>`

### Types

#### `DelegationV2`

Complete delegation information including staking details, unbonding info, and slashing data.

#### `DelegationV2StakingState`

Enum of all possible delegation states:
- `PENDING`, `VERIFIED`, `ACTIVE`
- `TIMELOCK_UNBONDING`, `EARLY_UNBONDING`
- `TIMELOCK_WITHDRAWABLE`, `EARLY_UNBONDING_WITHDRAWABLE`
- And more...

#### `BabylonConfig` & `BabylonConfigV2`

Configuration interfaces for Babylon network settings.

## Error Handling

The service includes typed error handling:

```typescript
import { ServerError, ErrorType } from '@unisat/babylon-service';

try {
  const delegations = await getDelegationsV2(baseUrl, publicKey);
} catch (error) {
  if (error instanceof ServerError) {
    console.log('Status:', error.getStatusCode());
    console.log('Message:', error.getDisplayMessage());
    console.log('Type:', error.type);
  }
}
```

## Development

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Build the package
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint
```

## License

MIT
