# @unisat/keyring-service

A TypeScript library for managing Bitcoin wallets with support for multiple keyring types including HD wallets, simple key pairs, and hardware wallets.

## Features

- **Multiple Keyring Types**: Support for HD wallets (mnemonic), simple key pairs (private keys), hardware wallets (Keystone), and cold wallets
- **Encrypted Storage**: Secure password-based encryption for storing wallet data
- **Multi-Chain Support**: Support for Bitcoin mainnet, testnet, signet, and Fractal Bitcoin networks
- **Storage Adapters**: Flexible storage system with memory and Chrome extension adapters
- **TypeScript**: Full type safety and excellent developer experience
- **Extensible**: Easy to add new keyring types and storage backends

## Installation

```bash
npm install @unisat/keyring-service
# or
yarn add @unisat/keyring-service
```

## Basic Usage

```typescript
import { KeyringService, MemoryStorageAdapter, AddressType } from '@unisat/keyring-service'

// Create service with memory storage
const keyringService = new KeyringService({
  storage: new MemoryStorageAdapter(),
  logger: console,
})

// Initialize the service
await keyringService.init()

// Boot with password
await keyringService.boot('your-secure-password')

// Generate mnemonic
const mnemonic = keyringService.generateMnemonic()
console.log('Generated mnemonic:', mnemonic)

// Create HD wallet (requires wallet-sdk integration)
// const keyring = await keyringService.createKeyringWithMnemonic(
//   mnemonic,
//   "m/84'/0'/0'", // BIP84 path for native segwit
//   '', // passphrase
//   AddressType.P2WPKH,
//   1 // account count
// );
```

## Extension Usage

For Chrome extension integration:

```typescript
import { KeyringService, ExtensionPersistStoreAdapter } from '@unisat/keyring-service'

// Extension storage adapter
const storage = new ExtensionPersistStoreAdapter(
  createPersistStore, // Your extension's createPersistStore function
  'keyring'
)

const keyringService = new KeyringService({
  storage,
  logger: console,
})
```

## Storage Adapters

### Memory Storage

For testing and development:

```typescript
import { MemoryStorageAdapter } from '@unisat/keyring-service/adapters/memory'

const storage = new MemoryStorageAdapter()
```

### Extension Storage

For Chrome extensions:

```typescript
import { ExtensionPersistStoreAdapter } from '@unisat/keyring-service/adapters/extensionPersist'

const storage = new ExtensionPersistStoreAdapter(createPersistStore, 'keyring')
```

## API Reference

### KeyringService

Main service class for managing keyrings.

#### Methods

##### Basic Operations

- `init(): Promise<void>` - Initialize the service
- `boot(password: string): Promise<void>` - Boot wallet with password
- `isBooted(): Promise<boolean>` - Check if wallet is booted
- `hasVault(): Promise<boolean>` - Check if vault exists

##### Password Management

- `verifyPassword(password: string): Promise<void>` - Verify password
- `submitPassword(password: string): Promise<MemStoreState>` - Unlock with password
- `changePassword(oldPassword: string, newPassword: string): Promise<void>` - Change password
- `setLocked(): Promise<MemStoreState>` - Lock wallet

##### Mnemonic Operations

- `generateMnemonic(): string` - Generate new mnemonic
- `generatePreMnemonic(): Promise<string>` - Generate and store temporary mnemonic
- `getPreMnemonic(): Promise<string>` - Get stored pre-mnemonic
- `removePreMnemonic(): void` - Clear pre-mnemonic

##### Account Management

- `getAccounts(): Promise<string[]>` - Get all accounts
- `getKeyringForAccount(address: string, type?: string): Promise<Keyring>` - Find keyring for address
- `exportAccount(address: string): Promise<string>` - Export private key
- `removeAccount(address: string, type: string): Promise<void>` - Remove account

##### Signing Operations

- `signTransaction(keyring: Keyring, psbt: any, inputs: ToSignInput[]): Promise<any>` - Sign transaction
- `signMessage(address: string, keyringType: string, message: string): Promise<string>` - Sign message
- `verifyMessage(address: string, message: string, signature: string): Promise<boolean>` - Verify message

##### Key Derivation

- `deriveContextHash(publicKey: string, appName: string, context: string): Promise<string>` - Derive a deterministic 32-byte value from the wallet's key material, an application name, and a hex-encoded context string using HKDF-SHA-256 (RFC 5869). The `appName` must be 1-64 bytes, lowercase `[a-z0-9\-]`. Supported by all keyring types: HD (mnemonic), HD (xpriv), and imported private keys.

### Types

```typescript
import {
  ChainType,
  AddressType,
  KeyringType,
  Keyring,
  StorageAdapter,
  KeyringServiceConfig,
  MemStoreState,
} from '@unisat/keyring-service/types'
```

## Supported Keyring Types

- **HD Key Tree**: BIP44/BIP84 hierarchical deterministic wallets from mnemonic
- **Simple Key Pair**: Individual private key imports
- **Keystone**: Hardware wallet integration via QR codes or USB
- **Cold Wallet**: Watch-only wallets for monitoring addresses
- **Empty**: Placeholder keyring type

## Supported Networks

- Bitcoin Mainnet
- Bitcoin Testnet
- Bitcoin Signet
- Fractal Bitcoin Mainnet
- Fractal Bitcoin Testnet

## Address Types

- P2PKH (Legacy)
- P2WPKH (Native SegWit)
- P2TR (Taproot)
- P2SH-P2WPKH (Nested SegWit)

## Development

```bash
# Install dependencies
yarn install

# Build the package
yarn build

# Run tests
yarn test

# Run tests in watch mode
yarn test:watch

# Lint code
yarn lint

# Clean build artifacts
yarn clean
```

## Integration with Wallet SDK

This package is designed to work with `@unisat/wallet-sdk` for complete keyring implementations. The service provides the management layer while the SDK provides the actual keyring implementations.

```typescript
// Example with wallet SDK integration
import { keyring } from '@unisat/wallet-sdk'

const { SimpleKeyring, HdKeyring, KeystoneKeyring } = keyring

// Register keyring types with the service
// (Implementation details depend on final SDK integration)
```

## Security Considerations

- Passwords are used to encrypt sensitive data
- Private keys and mnemonics are encrypted at rest
- Memory is cleared when wallet is locked
- Use secure storage adapters in production
- The simple encryptor is for development only - use stronger encryption in production

## License

MIT

## Contributing

Please read the contributing guidelines and submit pull requests for any improvements.
