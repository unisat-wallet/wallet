# @unisat/wallet-api

Unified API client for UniSat wallet services, providing a comprehensive TypeScript interface for interacting with the UniSat API.

## Features

- 🔧 **Unified Client**: Single package for all UniSat API services
- 📦 **Modular Design**: Organized services for Bitcoin, BRC20, Runes, Inscriptions, and Config
- 🛡️ **Type Safe**: Full TypeScript support with comprehensive type definitions
- 🔄 **Retry Logic**: Built-in retry mechanism with exponential backoff
- ⚡ **Error Handling**: Comprehensive error types and handling
- 🌐 **HTTP Client**: Robust HTTP client with timeout and authentication support
- ✅ **Well Tested**: Comprehensive test suite with integration tests

## Installation

```bash
npm install @unisat/wallet-api
```

## Quick Start

```typescript
import { createClient } from '@unisat/wallet-api'

// Create a new client
const client = createClient({
  baseURL: 'https://api.unisat.io',
  timeout: 30000,
})

// Configure authentication (optional)
client.setApiKey('your-api-key')
client.setUserAgent('YourApp/1.0.0')

// Use the client
const balance = await client.bitcoin.getAddressBalance('bc1qaddress...')
const tokens = await client.brc20.getAddressBRC20List('bc1qaddress...', { start: 0, limit: 10 })
```

## Available Services

### Bitcoin Service
Handle Bitcoin transactions, UTXOs, balances, and fee estimation:

```typescript
// Get address balance
const balance = await client.bitcoin.getAddressBalance(address)

// Send Bitcoin
const result = await client.bitcoin.sendBitcoin({
  toAddress: 'recipient-address',
  toAmount: 100000, // satoshis
  feeRate: 10
})

// Get fee rates
const feeRates = await client.bitcoin.getFeeRates()
```

### BRC20 Service
Manage BRC20 tokens:

```typescript
// Get BRC20 tokens for address
const tokens = await client.brc20.getAddressBRC20List(address, { start: 0, limit: 20 })

// Get token information
const tokenInfo = await client.brc20.getBRC20TokenInfo('ordi')

// Send BRC20 tokens
const result = await client.brc20.sendBRC20({
  toAddress: 'recipient-address',
  ticker: 'ordi',
  amount: '100'
})
```

### Runes Service
Work with Runes tokens:

```typescript
// Get Runes tokens
const runes = await client.runes.getAddressRunesList(address, { start: 0, limit: 20 })

// Get Rune information
const runeInfo = await client.runes.getRuneInfo('1:0')

// Mint Runes
const mintResult = await client.runes.mintRunes({
  runeid: '1:0',
  feeRate: 10
})
```

### Inscriptions Service
Handle inscription operations:

```typescript
// Get inscriptions for address
const inscriptions = await client.inscriptions.getAddressInscriptions(address, { start: 0, limit: 10 })

// Get inscription details
const inscription = await client.inscriptions.getInscription('inscription-id')

// Send inscription
const result = await client.inscriptions.sendInscription({
  toAddress: 'recipient-address',
  inscriptionId: 'inscription-id'
})
```

### Config Service
Access system configuration and utilities:

```typescript
// Get wallet configuration
const config = await client.config.getWalletConfig()

// Health check
const health = await client.config.healthCheck()

// Get Bitcoin price
const price = await client.config.getBitcoinPrice()
```

## Configuration Options

```typescript
const client = createClient({
  baseURL: 'https://api.unisat.io',  // API base URL
  timeout: 30000,                    // Request timeout in ms
  retries: 3,                        // Number of retry attempts
  headers: {                         // Default headers
    'User-Agent': 'MyApp/1.0.0'
  }
})
```

## Authentication

```typescript
// Set API key for authenticated requests
client.setApiKey('your-api-key')

// Set client address for tracking
client.setClientAddress('bc1q...', 1)

// Remove authentication
client.removeApiKey()
```

## Error Handling

The client provides detailed error types for different scenarios:

```typescript
import { ApiError, NetworkError, TimeoutError } from '@unisat/wallet-api'

try {
  const balance = await client.bitcoin.getAddressBalance(address)
} catch (error) {
  if (error instanceof ApiError) {
    console.log('API Error:', error.message, error.code)
  } else if (error instanceof NetworkError) {
    console.log('Network Error:', error.message)
  } else if (error instanceof TimeoutError) {
    console.log('Request timed out')
  }
}
```

## TypeScript Support

The package provides comprehensive TypeScript definitions:

```typescript
import type { 
  BitcoinBalance, 
  BRC20Balance, 
  RuneBalance, 
  Inscription, 
  UTXO 
} from '@unisat/wallet-api'
```

## Testing

Run the test suite:

```bash
npm test
```

The package includes comprehensive unit tests and integration tests to ensure reliability.

## License

This package is part of the UniSat wallet project and follows the same licensing terms.
