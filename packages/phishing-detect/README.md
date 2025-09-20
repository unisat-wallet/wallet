# @unisat/phishing-detect

Cross-platform phishing detection library for browser extensions, mobile apps, and web applications.

## Features

- 🔒 Real-time phishing site detection
- 🌐 Cross-platform support (browser extensions, mobile, web)
- 📦 Lightweight with zero platform dependencies
- 🔄 Automatic blacklist updates
- 🎯 Exact and fuzzy matching
- 📝 Full TypeScript support

## Installation

```bash
npm install @unisat/phishing-detect
```

## Usage

### Basic Usage

```typescript
import { PhishingService, LocalStorageAdapter } from '@unisat/phishing-detect';

// Create adapter
const adapter = new LocalStorageAdapter();

// Create service instance with config (recommended)
const phishingService = new PhishingService({
  adapter,
  logger: console, // Optional: custom logger
  t: (key) => key   // Optional: translation function
});

// Or use legacy format (backward compatible)
// const phishingService = new PhishingService(adapter);

// Initialize
await phishingService.initialize();

// Check hostname
const result = phishingService.checkPhishing('example.com');
console.log(result.isPhishing); // false

// Simplified boolean check
const isPhishing = phishingService.isPhishing('malicious-site.com');
```

### Adapters

The service provides multiple adapters to support different platforms:

#### LocalStorage Adapter (Browser)

```typescript
import { LocalStorageAdapter } from '@unisat/phishing-detect';

const adapter = new LocalStorageAdapter('my-app:');
```

#### Extension Adapter (Chrome Extension)

```typescript
import { ExtensionAdapter } from '@unisat/phishing-detect';

const adapter = new ExtensionAdapter();
```

#### Memory Adapter (Testing/Temporary)

```typescript
import { MemoryAdapter } from '@unisat/phishing-detect';

const adapter = new MemoryAdapter();
```

### Custom Adapter

```typescript
import { PhishingAdapter } from '@unisat/phishing-detect';

class CustomAdapter implements PhishingAdapter {
  async get(key: string): Promise<any> {
    // Implement storage read
  }

  async set(key: string, value: any): Promise<void> {
    // Implement storage write
  }

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    // Implement network request
    return fetch(url, options);
  }
}
```

### Event Listening

```typescript
phishingService.on('phishing:detected', (hostname, reason) => {
  console.log(`Phishing site detected: ${hostname}, reason: ${reason}`);
});

phishingService.on('phishing:updated', (config) => {
  console.log('Phishing list updated', config);
});

phishingService.on('phishing:error', (error) => {
  console.error('Phishing detection error:', error);
});
```

### Whitelist Management

```typescript
// Add to temporary whitelist (session only)
phishingService.addToWhitelist('trusted-site.com');

// Add to permanent whitelist
await phishingService.addToPermanentWhitelist('trusted-site.com');

// Remove from whitelist
await phishingService.removeFromWhitelist('trusted-site.com');
```

### Force Update

```typescript
// Force update phishing site list
await phishingService.forceUpdate();
```

### Get Statistics

```typescript
const stats = phishingService.getStats();
console.log(stats);
// {
//   blacklistSize: 1000,
//   whitelistSize: 50,
//   fuzzylistSize: 200,
//   temporaryWhitelistSize: 5,
//   lastUpdate: 1640995200000,
//   isUpdating: false
// }
```

## API

### PhishingService

#### Methods

- `initialize(): Promise<void>` - Initialize the service
- `destroy(): void` - Destroy the service
- `checkPhishing(hostname: string): PhishingCheckResult` - Check hostname (detailed result)
- `isPhishing(hostname: string): boolean` - Check hostname (boolean result)
- `addToWhitelist(hostname: string): void` - Add to temporary whitelist
- `addToPermanentWhitelist(hostname: string): Promise<void>` - Add to permanent whitelist
- `removeFromWhitelist(hostname: string): Promise<void>` - Remove from whitelist
- `forceUpdate(): Promise<void>` - Force update list
- `getConfig(): PhishingConfig` - Get configuration
- `getStats()` - Get statistics

#### Events

- `phishing:detected` - Phishing site detected
- `phishing:updated` - Configuration updated
- `phishing:error` - Error occurred

### Types

```typescript
interface PhishingCheckResult {
  isPhishing: boolean;
  reason?: string;
  matchedPattern?: string;
}

interface PhishingConfig {
  version: number;
  tolerance: number;
  fuzzylist: string[];
  whitelist: string[];
  blacklist: string[];
  lastFetchTime: number;
  cacheExpireTime: number;
}
```

## License

MIT