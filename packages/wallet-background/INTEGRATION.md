# Wallet Background Integration Guide

This document explains how to integrate `@unisat/wallet-background` into existing `unisat-extension`.

## 🎯 Integration Goals

- **Cross-platform**: Unified wallet background services supporting browser extensions, mobile and desktop
- **Modular**: Service decoupling for easier testing and maintenance
- **Backward compatible**: Smooth migration without breaking existing functionality
- **Progressive**: Can migrate gradually without need for complete replacement at once

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd unisat-extension
pnpm add @unisat/wallet-background
```

### 2. Basic Integration

In `unisat-extension/src/background/index.ts`:

```typescript
import { initializeWalletBackground } from '@unisat/wallet-background'

async function initializeServices() {
  // Initialize new background services
  const bridge = await initializeWalletBackground({
    enablePhishingDetection: true,
    enableNotifications: true,
    autoStart: true
  })

  // Get services compatible with existing code
  const services = bridge.createLegacyExports()

  return services
}

// Use new services
initializeServices().then(services => {
  const { walletController, keyringService, permissionService } = services
  
  // Existing code can directly use these services
  chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    // Use services.providerController to handle messages
  })
})
```

## 📋 Migration Strategies

### Method 1: Complete Replacement (Recommended)

Suitable for new projects or large-scale refactoring:

```typescript
import { replaceBackgroundServices } from '@unisat/wallet-background/integration'

const services = await replaceBackgroundServices()
// All services use new wallet-background implementation
```

### Method 2: Progressive Migration

Suitable for smooth migration in production environment:

```typescript
import { partialMigration } from '@unisat/wallet-background/integration'

// Only migrate specific services
const { phishingService, preferenceService } = await partialMigration()

// Other services continue using existing implementation
import { keyringService } from '@/background/service' // Existing service
```

### Method 3: Hybrid Mode

New features use new architecture, existing features remain unchanged:

```typescript
import { createExtensionBridge } from '@unisat/wallet-background'

const bridge = await createExtensionBridge()
await bridge.initialize()

// New features use new services
const newPhishingService = bridge.getService('phishing')

// Existing features remain unchanged
import { walletController } from '@/background/controller' // Existing controller
```

## 🔧 Service Mapping

Mapping between new and old services:

| Existing Service | New Service Path | Description |
|---------|-----------|------|
| `keyringService` | `bridge.getService('keyring')` | Keyring management |
| `permissionService` | `bridge.getService('permission')` | Permission management |
| `preferenceService` | `bridge.getService('preference')` | User preferences |
| `phishingService` | `bridge.getService('phishing')` | Phishing detection |
| `walletController` | `bridge.getService('wallet')` | Wallet controller |
| `providerController` | `bridge.getService('provider')` | Provider API |

## ⚙️ Configuration Options

```typescript
interface ExtensionBridgeConfig {
  enablePhishingDetection?: boolean  // Enable phishing detection (default: true)
  enableNotifications?: boolean      // Enable notifications (default: true)  
  autoStart?: boolean               // Auto start (default: false)
}
```

## 🎭 Adapter System

wallet-background uses adapter pattern for cross-platform support:

- **StorageAdapter**: Storage adapter (chrome.storage)
- **NotificationAdapter**: Notification adapter (chrome.notifications)
- **NetworkAdapter**: Network adapter (fetch API)
- **PlatformAdapter**: Platform adapter (chrome APIs)

## 🔍 Troubleshooting

### Common Issues

1. **Service Initialization Failure**
   ```typescript
   try {
     const bridge = await initializeWalletBackground()
   } catch (error) {
     console.error('Initialization failed:', error)
     // Fallback to existing services
   }
   ```

2. **Dependency Conflicts**
   Ensure workspace package versions are consistent:
   ```bash
   pnpm list @unisat/keyring-service
   pnpm list @unisat/permission-service
   ```

3. **Type Errors**
   Add type declarations:
   ```typescript
   /// <reference types="chrome" />
   ```

### Debug Mode

Enable verbose logging:

```typescript
const bridge = await initializeWalletBackground({
  // ... other configuration
})

// Listen for events
bridge.getBackgroundManager().on('service:ready', (name) => {
  console.log(`Service ${name} is ready`)
})

bridge.getBackgroundManager().on('service:error', (name, error) => {
  console.error(`Service ${name} error:`, error)
})
```

## 📈 Performance Optimization

1. **Lazy Load Services**
   ```typescript
   // Only initialize specific services when needed
   const phishingService = bridge.getService('phishing')
   ```

2. **Service Caching**
   ```typescript
   // Cache frequently used services
   const services = bridge.createLegacyExports()
   ```

## 🧪 Testing

```typescript
import { createExtensionBridge } from '@unisat/wallet-background'

// Test environment uses memory adapters
const testBridge = createExtensionBridge({
  autoStart: false
})

await testBridge.initialize()
const keyringService = testBridge.getService('keyring')
// Perform tests...
```

## 📚 More Resources

- [Architecture Overview](./ARCHITECTURE.md)
- [API Reference](./API.md)
- [Migration Guide](./MIGRATION.md)
- [Examples](./src/integration/usage-example.ts)