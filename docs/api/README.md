# UniSat Wallet API — dApp Integration Guide

The `window.unisat` object is injected by the UniSat Wallet extension into every web page. dApps use this API to interact with the user's Bitcoin wallet.

Experimental RGB interfaces are documented separately because they have
different method names, amount types, capabilities, and error codes:

- [Native RGB API (`window.unisat.rgb`)](./rgb.md)
- [WebRGB v1 Provider (`window.rgb`)](./webrgb.md)

## Getting Started

1. [Detect the extension](./browser-detection.md)
2. [Connect and request accounts](./connect-extension.md)
3. [Access account info](./access-accounts.md)

## Reference

| Topic                                                          | Description                                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Browser Detection](./browser-detection.md)                    | Check if UniSat is installed                                                      |
| [Connect Extension](./connect-extension.md)                    | Request wallet connection and accounts                                            |
| [Access Accounts](./access-accounts.md)                        | Get current account, address, public key                                          |
| [Address Types](./address-types.md)                            | Supported address formats                                                         |
| [Manage Assets](./manage-assets.md)                            | Send BTC, inscriptions, Runes, BRC-20                                             |
| [Native RGB API (Experimental)](./rgb.md)                      | UniSat-specific issuance, receive, payment, and RGB/BTC swap API                  |
| [WebRGB v1 Provider](./webrgb.md)                              | Standard provider discovery, receive, send, transfer tracking, events, and errors |
| [Manage Networks](./manage-networks.md)                        | Switch networks, listen for changes                                               |
| [Derive Context Hash (Experimental)](./derive-context-hash.md) | Deterministic secret derivation from wallet seed (experimental)                   |
| [Sign Message](./sign-message.md)                              | BIP-322 and ECDSA message signing                                                 |
| [Sign Transaction](./sign-transaction.md)                      | PSBT signing and transaction broadcasting                                         |
| [Mobile Integration](./mobile-integration.md)                  | Deep-link integration for mobile dApps                                            |
