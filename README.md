# UniSat Wallet

UniSat Wallet is an open-source Bitcoin wallet built for Ordinals, BRC-20, and the Bitcoin native ecosystem.

You can find the latest version of UniSat Wallet on our official website.  
For user guides, FAQs, and general documentation, please visit our documentation site.

If you encounter any wallet-related issues or need support, please submit a support ticket via our Discord.

For announcements and the latest updates, follow us on X.

For developers building on Bitcoin and Ordinals, see our developer documentation.

---

### Official Links

- 🌐 Website: https://unisat.io
- 📖 Documentation: https://docs.unisat.io
- 💬 Support (Discord): https://discord.com/invite/EMskB2sMz8
- 🐦 X / Twitter: https://x.com/unisat_wallet

---

## Repository Overview

This is a **monorepo** managed with **pnpm workspaces**, designed to support multi-platform wallet development with a single source of truth.

### Apps

Runnable end-user applications:

```
apps/
├── extension        # UniSat Browser Extension
└── mobile           # UniSat Mobile Wallet (iOS & Android) (Comming Soon)
```

### Packages

Shared wallet core, services, and utilities used across all platforms:

```
packages/
├── wallet-bitcoin        # Bitcoin protocol & transaction logic
├── wallet-background     # Background runtime & message handling
├── wallet-api            # Public wallet APIs
├── wallet-state          # Global wallet state management
├── wallet-storage        # Persistence & storage layer
├── keyring-service       # Key management & signing
├── permission-service    # DApp permission system
├── notification-service # Notification system
├── phishing-detect       # Phishing & security detection
├── tx-helpers            # Transaction helpers
├── wallet-shared         # Shared business logic
├── wallet-types          # Shared TypeScript types
└── base-utils             # Common utilities
```

> Packages are **not published independently**. Versions are tracked via Git commits and tags at the application level.

---

## Versioning & Release Strategy

This repository uses **Git tags** to track releases.

### Platform-specific tags

```
extension/v1.7.6
ios/v0.2.28
android/v0.2.47
```

### Pre-release tags

```
extension-v1.7.6-beta.1
ios-v0.2.28-rc.1
android-v0.2.47-beta.2
```

All tags reference commits in this repository. Shared package changes are reflected across platforms through these tags.

---

## Development Setup

### Requirements

- Node.js >= 18
- pnpm >= 8

### Install dependencies

```bash
pnpm install
```

### Run apps

```bash
# Browser extension
cd apps/extension
pnpm build:chrome:mv3:dev

```

---

## Project Principles

- **Single source of truth** for wallet core logic
- **Shared packages first**, platform code as thin layers
- **Strict dependency boundaries** between apps and packages
- **Security-oriented design**, especially around key management and permissions

---

## Repository Status

This repository is the **only active development repository** for UniSat Wallet.

Previous standalone repositories have been deprecated:

- `unisat-wallet/extension`
- `unisat-wallet/wallet-sdk`

---

## License

This project is licensed under the MIT License.
