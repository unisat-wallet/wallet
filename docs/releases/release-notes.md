# UniSat Wallet Release Notes

## v1.8.4

This release expands RGB/BTC trading support, improves RGB balance and UTXO recovery, and strengthens wallet security around phishing, provider access, signing, and key handling.

### RGB Trading and Integration APIs

- Added direct Proxy ACK synchronization for backend-controlled seller swaps without importing or exposing the final transaction.
- Added seller-wallet commitments for pure P2P swaps, allowing the buyer to verify the seller's per-transfer Proxy identity without exposing private keys.
- Added an Instant Swap flow for NIA assets, including seller listings and buyer completion with exact asset, amount, price, outpoint, output, and signature validation.
- Added restart-safe and idempotent swap handling, provider-origin binding, buyer spend limits, and protection against changing committed proposals or seller signatures.
- Preserved RGB allocation locks and swap state until the externally broadcast transaction is observed, acknowledged, or safely canceled.
- Added dedicated backend-coordinated and pure P2P integration guides covering call order, commitments, broadcast ownership, cancellation, and recovery responsibilities.

### RGB Balance, UTXO, and Transfer Recovery

- Added pending-balance diagnostics that explain confirmation, snapshot synchronization, missing-history, and receive-processing states.
- Improved automatic and manual cleanup of spent, replaced, stale, and locally overlaid RGB UTXOs so balances and UTXO inspection converge with Bitcoin chain state.
- Added searchable RGB UTXO inspection with asset names, clearer loading states, history repair actions, and improved fee-pool inspection.
- Improved recovery for interrupted broadcasts, reviewed cancellations, incomplete transfers, missing allocation history, expired invoices, and stale fee-pool outputs.
- Fixed balance and history consistency across consecutive sends, donations, self-transfers, burns, externally broadcast swaps, and asset-scoped activity lists.
- Improved transfer status, amount precision, cancellation presentation, and failed-transfer indicators.

### Asset and UI Improvements

- Added exact-asset lifecycle policies for active, deprecated, and disabled assets, including official labels, notices, ordering, and optional zero-balance visibility.
- Improved configured official USDT presentation and fixed-price display.
- Added a fallback path for opening the Alkanes mint flow when indexed mint information is unavailable.

### Security and Privacy

- Hardened phishing-domain normalization, subdomain matching, warning-page redirects, temporary exceptions, and remote phishing-rule updates.
- Centralized external URL opening and limited remote or untrusted links to validated HTTP and HTTPS destinations.
- Prevented connected account data from being exposed while the wallet is locked, while allowing interrupted approval flows to resume safely after unlock.
- Strengthened validation of externally signed PSBTs before accepting them back into wallet flows.
- Enforced a minimum vault KDF strength, rejected unsafe legacy password-verifier states, and cleared cached derived private keys when appropriate.
- Removed unnecessary clipboard-read behavior from private-key export while retaining explicit clipboard writes.
- Required unlock before Cosmos key access and rejected unsupported Babylon network fallbacks.

### Other Fixes

- Cleared unsupported restore parameters when switching wallet recovery types.
- Improved the Connected Sites empty state and safely handled notification identifiers containing special characters.

## v1.8.3

This release focuses on improving the stability, compatibility, and usability of RGB asset transfers. It also enhances transaction recovery, batch receiving, and asset management while fixing several known issues.

### RGB Transfer Reliability

- Fixed some RGB transfers becoming stuck, balances remaining unavailable, and broadcast prompts continuing after a transaction had already been published.
- Improved transfer cancellation, status synchronization, and recovery to reduce the impact of failed or interrupted transfers.
- Fixed transfer-history recovery issues affecting consecutive transfers, asset burns, self-transfers, and related scenarios.
- Improved error isolation so one problematic transfer does not prevent other assets from synchronizing normally.

### RGB Compatibility and Connectivity

- Added support for RGB Proxy v0.4.0 while retaining compatibility with legacy v0.3 proxies.
- Improved RGB data uploads, receive acknowledgements, retries, and endpoint failover for more reliable transfers.
- Strengthened RGB invoice validation and error messages, with better compatibility across RGB asset and transfer-data versions.

### Batch Receive and Performance

- Improved the presentation of large pending-acceptance sets with a summary view and a dedicated View All screen.
- Improved batch-acceptance progress and transaction-status feedback for a clearer receive flow.
- Reduced repeated network requests to improve batch transfer synchronization and acceptance performance.

### RGB Asset Management and WebRGB

- Expanded BFA asset support and improved minting, burning, and related validation flows.
- Improved BFA asset burns with more flexible asset selection and burn-proof export.
- Added compatibility warnings for non-standard NIA assets to help users identify potential risks.
- Expanded the WebRGB API with asset burning, consignment lookup, and burn-proof retrieval.

### Other Improvements

- Improved RGB asset receiving and recovery to reduce the impact of expired or invalid records.
- Improved the display of transfer statuses, failure reasons, cancellation actions, and UniScan confirmations.
- Improved RGB key handling and cache cleanup for better wallet security.
- Fixed other known issues to improve overall stability and usability.

## v1.8.2

### Dependency and Build Security

- Updated Bitcoin cryptography dependencies to reject malformed proof-of-work targets, unsafe BIP39 wordlist property lookups, and invalid secp256k1 recovery identifiers.
- Updated vulnerable runtime dependencies used for HTTP requests, object utilities, identifier generation, query serialization, date handling, and WebSocket communication.
- Removed unused dependency paths that included vulnerable legacy Protobuf and Sentry packages.
- Updated the extension build, test, SVG, and QR toolchains to patched releases and removed obsolete vulnerable transitive dependencies.
- Standardized Chrome, Brave, and Edge builds on Manifest V3 while retaining the existing MV3 command aliases for compatibility.
- Raised the release environment baseline to Node.js 22.23.4 and documented reproducible installs using the frozen pnpm lockfile.

### PSBT Signing Security

- Added an explicit risk confirmation when a PSBT requests a signature from a public key that standard script inspection cannot associate with the input, while preserving compatibility with specialized signing protocols.
- Tightened Taproot script-path signing so automatic selection only signs leaves containing the signing public key. Specialized leaves must be selected explicitly and now display the same risk confirmation when the key is not directly referenced by the script.
- Removed the automatic fallback that signed every PSBT input when none belonged to the current account; callers must now explicitly select specialized inputs.
- Hardened batch signing with local asset checks split into supported 100-outpoint requests and limits of 50 transactions and 1,000 total inputs per request, with explicit invalid-parameter errors when exceeded.

### Cosmos and Babylon

- Redesigned Cosmos connection and signing approvals with clearer network, selected-account, permission, transaction, fee, gas, memo, and signer details.
- Hardened Direct signing by validating the SignDoc structure, configured chain ID, account number, sequence, signer public key, and message signer before authorization.
- Added readable transaction summaries for Cosmos sends and Babylon delegation, undelegation, redelegation, unbonding cancellation, reward withdrawal, and reward-address operations.
- Improved ADR-36 review with domain-separated signing, UTF-8 and Hex previews, and prominent warnings for binary, malformed, or otherwise unreadable content.

## v1.8.1

### RGB Improvements

- Added support for RGB burns on Arbitrum V1 destinations, including clearer destination-network details and a unified burn-proof JSON export.
- Strengthened RGB asset validation with backend attestations, durable validation snapshots, and compatibility for legacy NIA assets.
- Improved RGB receive and recovery reliability by retrying transfers awaiting EVM finality, recovering uncertain payment claims, serializing recovery conflict checks, and ignoring unrelated unconfirmed witness branches.
- Improved invoice and asset presentation by filtering invoices already used by received assets, normalizing configured USDT names, and using consistent token-detail labels.

### Transaction Security

- Improved PSBT signing review for `SIGHASH_NONE`, `SIGHASH_SINGLE`, `ANYONECANPAY` combinations, and invalid sighash values.
- Added clearer warnings and output-scope details so users can see which transaction outputs a signature commits to before signing.

### Interface and Reliability

- Increased the extension popup width to improve readability and layout consistency.
- Hid unsupported marketplace links on test networks.
- Improved Chrome MV3 build artifacts with Git-hash filenames and explicit output-path reporting after a successful build.

## v1.8.0

### New Home and Assets Experience

- Redesigned the wallet home screen with a cleaner layout, consolidated wallet actions, asset overviews, and recent transaction history.
- Added a dedicated Assets tab for easier navigation across BRC-20, Runes, Ordinals, Alkanes, and RGB assets.
- Added asset counts, improved token and collection categorization, and remembered the selected asset tab for each account.
- Improved transaction history with token logos, source and recipient addresses, marketplace purchase records, and clearer asset details.

### RGB Upgrades

- Enabled RGB functionality on the Bitcoin Signet network.
- Upgraded RGB invoice and transfer flows with Proxy V1 support, witness and blind invoices, configurable expiration, and improved transfer status tracking.
- Added dedicated RGB asset selection, invoice management, issuance review, and transfer history experiences.
- Added support for donation transfers and BFA burn destinations with proof export.
- Improved pending, locked, and available balance presentation across RGB asset screens.
- Added encrypted RGB backups, guided restore, recovery checkpoints, and safer synchronization across devices.
- Improved handling of rejected, expired, canceled, and interrupted RGB transfers, with clearer status and recovery actions.

### Improvements

- Improved wallet home and asset loading performance while reducing duplicate API requests.
- Improved RGB balance synchronization, invoice polling, fee-pool handling, and transfer reliability.
- Refined RGB token, send, receive, issuance, and transfer detail interfaces.
- Added clearer validation and confirmation prompts throughout RGB operations.
- Improved localization and display handling for long asset names, small amounts, and asset precision.

### Security and Reliability

- Strengthened dApp session isolation, request validation, and transaction approval checks.
- Added stricter validation for RGB amounts, invoices, fees, signing requests, and network-specific operations.
- Improved recovery from temporary API, proxy, indexer, and Babylon RPC failures.

### Availability

- RGB is available on **Bitcoin Testnet4 and Bitcoin Signet**. Bitcoin Mainnet RGB support remains disabled in this release.

## v1.7.22

### Bug Fixes

- Fixed sends being allowed when a custom fee rate was empty.
- Fixed Cosmos approval content display to use the correct payload for `cosmos_signDirect` and `cosmos_signArbitrary` requests.
- Restored the success toast styling with a green background and white text.

## v1.7.21

### New Features

- Added RGB asset support on Bitcoin Testnet4: issue assets, create receive invoices, send and receive transfers, and view balances and transfer history.
- Added RGB UTXO and fee-pool management, including guided funding and withdrawal flows.
- Added RGB payment requests for connected dApps with an explicit approval flow.

### Improvements

- Optimized extension and popup startup performance through on-demand storage loading, parallel background-service initialization, and more efficient locale and phishing-list caching.

### Availability

- RGB is currently available on **Bitcoin Testnet4 only**. Bitcoin Mainnet RGB support is intentionally disabled in this release and will be enabled in a future version.

## v1.7.20

### Improvements

- Refined wallet creation and recovery with clearer steps for selecting a wallet type, entering a recovery phrase, verifying the backup, and choosing an address type.
- Improved recovery-phrase entry with full-phrase paste, per-word editing, clear-all, and visibility controls.
- Recovery phrases, optional BIP39 passphrases, and exported private keys are now masked by default and require an explicit reveal action.
- Reorganized wallet-add options and aligned the private-key wallet creation flow for a more consistent setup experience.
- Moved the extension update prompt to Settings > About and made the update status and Skip action more reliable.

### Bug Fixes

- Fixed invalid Keystone derivation paths and removed unsupported custom derivation-path entry from the Keystone import flow.
- Fixed version-update state handling, including current-version display and skipped-update status.

## v1.7.19

### New Features

- Added local transaction construction for Alkanes transfers.
- New wallet creation now supports 12- and 24-word recovery phrases, with 24 words selected by default.
- Added support for pay-to-anchor recipient addresses.

### Improvements

- Expanded PSBT risk details with clearer asset cards, mixed-asset visibility, incremental lists for large transactions, and improved carousel interaction.
- Improved BRC-20 balance presentation and recipient-address validation.

### Security and Privacy

- Strengthened vault encryption and migrated compatible legacy vaults to a stronger password-based key derivation setting after unlock.
- Reduced the time recovery phrases, passphrases, and imported private keys remain in memory; added safer cleanup when wallets are locked, removed, or reset.
- Hardened phishing-page isolation, embedded content restrictions, and UI message-port validation.
- Removed direct external extension connectivity and the privileged `unisat.io` permission bypass. Provider state now returns accounts only to origins with an approved wallet connection.
- Improved transaction safety checks for inscriptions, Runes, Alkanes, and mixed-asset UTXOs.

### Breaking Changes

- Removed CAT20 and CAT721 protocol support from the extension, including related asset views and send/merge flows.

### Bug Fixes

- Fixed recovery-phrase generation races, empty confirmation slots, duplicate derivation-path errors, and 12-word warning styling.
- Fixed handling of mixed Rune and Alkanes assets during transaction construction.
- Fixed several PSBT risk-detail display and interaction issues.

## v1.7.17

### New Features

- Redesigned the wallet action shortcuts for a cleaner and more consistent home screen experience.
- Redesigned the fee rate selector to improve readability and selection clarity.
- Standardized token balance card layouts across BRC-20, Runes, CAT20, and Alkanes assets.
- Added a shared transfer amount card across BTC, BRC-20, Runes, CAT20, Alkanes, and Babylon send flows.

### Improvements

- Updated asset filter tabs with a pill-style design and more consistent spacing.
- Improved recipient address input layout alignment.
- Added truncation and tooltips for long asset names to prevent layout overflow.
- Kept BRC-20 self-issuance tags aligned beside token names.
- Improved token balance price rendering and asset card spacing.
- Respected the configured wallet API endpoint during wallet initialization and restore flows.
- Removed legacy mobile workspace dependencies and related patches from the extension workspace.

### Bug Fixes

- Added fallback handling for invalid chain types.
- Stabilized account balance refresh behavior.
- Fixed permission service initialization so `autoSync` and `internalRequestOrigin` options are respected.
- Fixed RBF sequence handling when building PSBT inputs.
- Optimized BTC and Runes fee calculation paths, especially for transactions with many inputs.

## v1.7.16

### New Features

- Added readonly wallet support for testing external PSBT/message signing flows. This is an experimental Developer Mode feature and is not recommended for production or high-value transactions.

### Improvements

- Added account capability checks so watch-only and fixed-address wallets hide or block unsupported send, merge, address type, account creation, and private key export actions.

### Bug Fixes

- Fixed repeated render/effect loops in transaction creation screens.

## v1.7.15

### New Features

- Added a disclaimer prompt for selected Discover apps before opening them.

### Improvements

- Improved RBF tooltip wording across supported languages to clarify that replaceability can still depend on network policy.
- Polished send form layouts across BTC, Runes, CAT20, CAT721, Alkanes, and Ordinals flows so labels align consistently and action buttons keep stable sizing.
- Truncated long account names in the account switcher to avoid layout overflow.

### Bug Fixes

- Fixed BRC20 inscribe transfer flow so successful PSBT broadcast continues into the confirmation/result step instead of navigating away early.
- Added a distinct `NO_ACCOUNT` provider error code when the wallet has no account, avoiding incorrect classification as user cancellation.

## v1.7.14

### Improvements

- Updated `unisat.deriveContextHash` derivation semantics to bind output to the connected leaf public key (per-address), and added interface-level support updates for the new behavior.
- Added a persisted global RBF preference across supported send flows, so BTC/BRC20/Runes/Ordinals send paths share one remembered RBF toggle state.

### Bug Fixes

- Fixed notification-service test typing incompatibilities by aligning test fixtures with the current `StoredNotification` contract (including required `linkType`).

## Unreleased

### Breaking Changes (Experimental API)

- **`unisat.deriveContextHash` derivation input changed (spec v1.0 → v2.0).** HD wallets still use the fixed BIP-32 path `m/73681862'` as IKM, while imported wallets still use the raw imported private key. v2.0 now injects the wallet's canonical Bitcoin network and the currently connected compressed public key into HKDF `info`, so switching network or connected account produces a different output. dApps do not need to encode the wallet network or public key in `context`.
- **Outputs change for any prior caller.** Any dApp that persisted v1.0 outputs (e.g. an HTLC pre-image, a Lamport seed) must re-derive against v2.0 — there is no version-discovery mechanism. The API remains marked `@experimental`. See [`../api/derive-context-hash.md`](../api/derive-context-hash.md) for the updated contract.

## v1.7.13

### Improvements

- Reorganized wallet assets navigation by moving Alkanes under the top-level `More` tab, with dedicated `Alkanes` and `Alkanes Collections` entries.
- Unified the "View on UniScan" entry across BRC20, CAT20, and Runes token detail screens with a shared component for consistent UX and easier maintenance.
- Improved `AddressDetailPopover` logic and display consistency by reusing the shared UniScan action component.
- Improved BRC20 request handling for special ticker encoding cases to increase compatibility and stability.
- Unified BRC20 parameter structures across API/background/state layers to reduce cross-layer mismatch risk.

### Bug Fixes

- Fixed inconsistent ticker query behavior in some BRC20 encoding scenarios (including duplicate-encoding edge cases).
- Fixed several consistency issues in BRC20 balance display and related navigation logic.
- Fixed dangerous sighash detection to correctly flag `SIGHASH_NONE` (including `SIGHASH_NONE | ANYONECANPAY`) while not misclassifying `SIGHASH_SINGLE | ANYONECANPAY`.

## v1.7.12

### New Features

- Added new API method: `unisat.deriveContextHash(appName, context)`. See docs: [`../api/derive-context-hash.md`](../api/derive-context-hash.md)
  - `deriveContextHash` derives a deterministic 32-byte value from wallet key material using HKDF-
    SHA-256 with app-level and context-level domain separation.
  - This method requires explicit user approval before returning the derived value.
  - `deriveContextHash` is currently marked as **Experimental**.

### Improvements

- Improved approval UX for concurrent requests: when a new approval request arrives while another
  is still pending, the new request is rejected, and the existing approval window is brought to
  front so users can continue the active confirmation flow.
- Enhanced transaction safety checks by improving dangerous sighash detection, including
  SIGHASH_NONE and SIGHASH_SINGLE | SIGHASH_ANYONECANPAY patterns.

### Bug Fixes

- Fixed repository ignore rule that unintentionally ignored `apps/extension/src/_locales/es/` by
  narrowing `es/` to root-only `/es/`.

## v1.7.11

### New Features

- Added in-app announcement card on the home screen with carousel support and dismiss-all option
- Added notification center: unread badge on settings icon, notification list with timestamps, and mark-all-as-read
- Added Magic Eden Wallet as a supported restore wallet type
- Added USD value display for network fees on the signing page

### Improvements

- Batch signing now requires explicit user confirmation via disclaimer modal before quick multi-sign
- Batch signing is aborted when SIGHASH_NONE is detected or when any PSBT fails to parse
- Wallet restore flow now respects per-wallet configuration for supported word counts (12/24), custom HD path, and passphrase
- Brand names (Ordinals Wallet, Xverse, etc.) are no longer passed through the translation system, eliminating console warnings
- `getAccountDerivationPath` now centrally handles HD path construction for both standard and account-index derivation modes (Magic Eden)

### Bug Fixes

- Fixed occasional toast error during batch PSBT signing
- Fixed account list scroll-to-current triggering "max limitation" warning in rc-virtual-list
- Fixed "Extension context invalidated" error thrown by content script after extension reload
- Fixed `fill-rule`/`fillRule` DOM property warning caused by antd CloseOutlined icon

## v1.7.10

### Bug Fixes

- Resolved issue with incorrect display of BRC-20 program balance.
- Fixed bug in tapLeafHashToSign parameters in unisat.signPsbt.
- Corrected signPsbt auto-finalization default (set to true by default).

## v1.7.9

### Bug Fixes

- Fixed compatibility issue with base64 encoding in `unisat.signPsbt` method
- Fixed issues with `unisat.sendBTC`, `unisat.sendInscription`, and `unisat.sendRunes` methods not functioning properly
- Fixed compatibility issue with legacy addresses

## v1.7.8

### New Features

- Added balance refresh button on the home screen

### Improvements

- Optimized transaction signing interface flow for better user experience
- Improved PSBT signing workflow with clearer steps
- Address display now shows first 8 and last 8 characters for better readability

### Bug Fixes

- Fixed Keystone wallet signing issues in certain scenarios

## 1.7.6

New Features

- Allow setting transaction fee rates lower than 1 sat/vB on the BTC network

Improvements

- Major codebase refactoring for better structure, maintainability, and modularization
- Updated Fractal brand assets, including the new Fractal logo

Bug Fixes

- Minor stability and UI fixes following the refactoring process

## v1.7.5

Changes

- Change PizzaSwap to InSwap

## v1.7.4

New Features

- Added BRC 2.0 wrapped balance display
- Added BRC20 swap balance display

Improvements

- Optimized build configuration to reduce bundle size
- Refactored codebase architecture for better maintainability

## v1.7.3

New Features

- Added support for BRC 2.0

## v1.7.2

New Features

- Enable BRC20 single-step transfer on Fractal network

Bug Fixes

- Updated UniScan explorer URLs for Fractal testnet
- Safety notices now only appear once for first-time users (instead of every new wallet)
- Removed unconfirmed balance settings (feature deprecated and no longer functional)
- Fixed layout issues in Alkanes collection

Improvements

- Redesigned BRC20 token details screen for better UI/UX
- Multi-language support for risk warning pages and transaction signing

Experimental

- Added cold wallet functionality (available in Developer Mode)

## v1.7.1

New Features

- Added support for CAT protocol V2

Bug Fixes

- Fixed TypeScript compilation issues

Improvements

- Disable mnemonic copy to enhance security

## v1.7.0

New Features

- Added support for Alkanes.

## v1.6.3

New Features

- Added sidebar

- Added method: unisat.multiSignMessage([{text:'example',type:'ecdsa'}])

Bug Fixes

- Fixed an issue with parameters when signing P2TR scripts (most for CAT20 txns).
  For script path inputs, the default behavior is to use the original public key for signing. You can explicitly specify whether to use the TweakedSigner by setting the useTweakedSigner option. If not explicitly set, the signer will automatically determine which key to use based on the presence of a tapLeafScript in the input. If the tapLeafScript contains the original public key, the original key will be used for signing; otherwise, the TweakedSigner will be used. In most cases, the signing method can be automatically determined without needing to pass additional parameters.

## v1.6.2

New Features

- Support for multiple languages\n
- Fractal testnet now supports single-step transfer

## v1.6.1

New Features

- Added address book
- Added feedback entrance
- Support Babylon mainnet

Improvements

- Restructure Settings Tab

## v1.6.0

Changes

- Remove atomicals token support.

Bug Fixes

- Fixed Keystone signing bugs.

- Fixed potential vulnerabilities.

Improvements

- Improve wallet loading speed.

## v1.5.9

New Features

- Added UTXO management tool entry on the homepage.

Bug Fixes

- Updated outdated phishing website list.

- Fixed text overflow in purchase popup.

- Fixed amount modification issue when going back in the Transfer page.

- Fixed gas fee selection not applying when sending tBABY.

Improvements

- Optimized performance for the homepage inscription list.

## v1.5.8

New Features

- Added Phishing Website Detection: Implemented a new feature to detect and warn users about potential phishing websites.

Improvements

- Error Page Handling: Improved user experience by displaying an error page instead of a black bar when a page encounters an exception.

- BABY Transfer Interface: Added a gas fee modification option to the BABY transfer interface (previously, gas fees were fixed).

- Window Object Conflict Prevention: Introduced window.unisat_wallet object to prevent conflicts with other existing plugins that might interfere with Unisat.

Bug Fixes

- Fixed a signing issue introduced in version 1.5.7

Other Changes

- Removed the Telegram group contact information from the project.

## v1.5.7

- Fix Keystone Babylon integration

## v1.5.6

- Fix Babylon RPC

## v1.5.5

- Integration of Babylon Bitcoin Staking Phase 2

## v1.5.4

1. Added an Unlock button on the Fractal mainnet to navigate to the UTXO management tool.
2. In advanced settings, added a toggle for Atomicals, allowing users to disable ARC20 and free up the unavailable balance.
3. Adjusted the user interface.

## v1.5.3

- Support CAT721
- Support purchasing FB through AlchemyPay

## v1.5.2

- Added display of USD prices for FB, BRC20, Runes, CAT20 in fractal
- New discovery page
- Fix the issue where signing individually in a batch may result in a 'network not match' error.

## v1.5.1

- During batch signing, for whitelisted websites, one-click signing is allowed.
- Merged keystone's PR, supports USB mode.
- Added the optional parameter useTweakedSigner to the methods signPsbt/signPsbts. This allows for the use of a tweaked signer to sign non-Taproot addresses, which is required for CAT721's lock to mint.
- When switching wallets and switching accounts, it will automatically scroll to the corresponding row and display the scrollbar.

## v1.5.0

- Support CAT20

## v1.4.10

- Add address tips. (It is not recommended to use legacy addresses on Fractal.)

## v1.4.9

- Display short names for bool bridge and simple bridge ticks
- Support for .fb domain on fractal
- Fix the issue where batch signing PSBT can get stuck when there are too many transactions
- Fix fractal browser link.

## v1.4.8

- Allow passing in tapLeafHashToSign when calling signPsbt

## v1.4.7

- Remove the maximum fee rate limit

## v1.4.6

- Enable Fractal Bitcoin Mainnet
- Fix Address QRCode

## v1.4.5

- Add Fractal Bitcoin Testnet
- Add password strength detection.
- Add automatic lock time in Advanced
- Fix `networkChanged` for issue#211
- Add `unisat.disconnect` for issue#204

## v1.4.2

- Support Testnet4
- Support Signet
- Fixed the issue of the app crashing when transferring Runes with multiple UTXOs
- Fixed the issue with the display of the available balance of partially-colored funds during an ARC20 transfer
- Fixed the issue with the incorrect display of HdPath in Keystone
- Audit fix: Removed private methods from the browser plugin object to enhance security
- Audit fix: Methods such as getPublicKey, getNetwork, switchNetwork are now only accessible after authorization for improved security.

## v1.4.1

- Support for setting transfer fees with one decimal place
- Added display of USD prices for BTC、BRC20 and Runes
- Real-time fee displays for various buy BTC options
- Fix unisat.sendRunes
- Fix unisat.multiSginPsbt

## v1.4.0

- Support fractalbitcoin

## v1.3.4

- Compatible with partial token coloring for ARC20

## v1.3.3

- Support keystone

## v1.3.2

- Support cursed inscription
- Optimized the UTXO selection strategy of runes to reduce gas fees
- Add runes logo
- Add AlchemyPay
- Fix Runes details

## v1.3.1

- Fixed the bug of runes constructing a burn transaction
- Fixed the bug of "can not convert 1+21 to bigint" appearing during transfer

## v1.3.0

- Support Runes
- Add a toggle for enabling unconfirmed balances.
- No longer forcing pop-up warnings for transactions with high or low fee rates.
- Reverted the default inscribe outputValue to 546 sats for simplified operations.
- Fix MultiSignPsbt

## v1.2.10

- Support 5-byte BRC20
- Improve the display of BRC20

## v1.2.9

- Added `memos` parameter to `unisat.sendBitcoin` method, for constructing runes transactions (github #164 and #167)
- Fixed a bug in the `unisat.sendInscription` method (github #159)
- Fixed the problem where an order could not succeed when the wallet balance and the payment amount were exactly equal when inscribe a TRANSFER inscription
- Improved balance display, showing both available and unavailable balances
- Improved the asset display during transaction signing, added BRC20 display
- Improved risk warnings during transaction signing, and now requires the input of CONFIRM to proceed when warnings appear.

## v1.2.8

- The unisat.sendBitcoin method has added a memo parameter, increasing OP_RETURN output when sending btc.
- A new unisat.getBitcoinUtxos method has been added, through which the developers can get users UTXO without inscription assets.
- A new unisat.signData method has been added, through which the developers can have users participate in multi-signature.

## v1.2.7

- Allowing decimal inputs when inscribing BRC20 TRANSFER.
- Support more precise inscription outputValue, reduced to 294 for P2WPKH addresses.
- Use deterministic ECDSA signatures in `unisat.signMessage`.

## v1.2.6

- Mixed inscriptions can now be sent without splitting
- Fixed an issue with the address amount input box restrictions:
  - Limited BTC input to a maximum of 8 decimal places.
  - Spaces are now ignored when entering an address.
  - Restricted ARC20 input amount.

## v1.2.5

- Minimum output amount for inscriptions can now be set to 330.
- Added the ability to disable Atomicals (only when there are no Atomicals assets).
- Added the API `isAtomicalsEnabled` to determine if the user has enabled the Atomicals feature.
- Implemented version checking to prompt for upgrades when a new version is available.
- Fixed an issue where transferring inscriptions and ARC20 without available BTC would result in an error.

## v1.2.4

- Fixed an issue where exporting private keys was not possible.

## v1.2.3

- Replaced secp256k1 to maintain the signature logic of v1.1.33.
- Added the `getVersion` method to retrieve the wallet version.

## v1.2.2

- Fixed an issue where the fee rate would decrease during transfers.

## v1.2.1

- Fixed the issue of failed P2TR signature.

## v1.2.0

- Added support for Atomicals.
- Refactored underlying code using @unisat/wallet-sdk.

## v1.1.33

- Fix changing address type of simple keyring

## v1.1.32

- Support .btc as recipient address
- Support recovery from OrdinalsWallet

## v1.1.31

- Support .x as recipient address
- Fix the signature error of P2TR #86
- Restrict the input field's content

## v1.1.30

- Added the parameter "toSignInputs" to the "signPsbt" method

## v1.1.29

- Update app summary
- Change api url

## v1.1.28

- Patch the vulnerability CVE-2022-32969

## v1.1.27

- Fix typo error

## v1.1.26

In this version, we focused on security upgrades and introduced several new features and enhancements. Here are the updates:

1. Manual Wallet Locking

- Users now have the ability to manually lock their wallets for added security.

2. Protection against Phishing Websites

- To protect users from potential phishing attacks, the wallet will now block connections to suspicious websites during wallet access and transaction signing.

3. Blacklist Address Blocking

- Transactions containing addresses on the blacklist will be blocked during the signing process to prevent potential security risks.

4. Risk Warning on Transaction Signing Exceptions

- Users will receive a risk warning if any abnormal behavior is detected while signing transactions. Currently, abnormal behavior is identified by the loss of plaintext.

5. Risk Warning during Batch Transaction Signing

- A risk warning will be displayed when performing batch transaction signing, ensuring users are aware of potential risks.

6. Improved Inscription Splitting

- We have improved the process of inscription spliting, allowing users to choose a minimum amount of satoshis for each split inscription, providing greater flexibility. For individual inscription balances exceeding 10,000 satoshis, users can split the balance for better management.

## v1.1.25

**Major changes**

- Scan more addresses when restoring wallet
- Disable mnemonic translation
- Fix a issue that selecting an account do not take effect
- Fix a issue that fails to sign PSBT with M44_P2TR address

## v1.1.24

**Major changes**

- Support restoring wallet by 24-words
- Support spliting UTXO that contains multiple inscriptions

## v1.1.23

**Major changes**

- Support exporting Hex Private Key
- Add risk warnings when exporting Private Key and Secret Recovery Phrase
- Fix a issue that when exporting a non-active wallet, incorrectly exports the Secret Recovery Phrase of the active wallet
- Fix a display issue of "Failed to fetch."
- Fix a issue that "getBalance " API returns incorrect unconfirmed balance

## v1.1.22

**Major changes**

- Extend the maintenance time of the plugin

## v1.1.21

**Major changes**

- Fix the issue that all wallet's names become wrong after deleting a wallet
- Adjust the process of inscribing a TRANSFER
- Add MV2 in github release

## v1.1.20

**Major changes**

- Support purchasing BTC through MoonPay
- Disable RBF to prevent accidental triggering
- Display the output value of inscription by default
- Display balance details when hovering over the balance
- Use mempool.space to display transaction history
- Add a prompt to wait for BRC20 updates after inscribing a TRANSFER

## v1.1.19

**Minor changes**

- Fix error of brc-20 with special characters

## v1.1.18

**Minor changes**

- Optimize the display of PSBT

## v1.1.17

**Major changes**

- Feature
  - Add API unisat.inscribeTransfer(ticker:string, amount:string)

**Minor changes**

- Add sentry to trace bugs

## v1.1.16

**Major changes**

- Feature
  - Support BIP322
  - Sign multiple PSBT in one time
- Adjust
  - Use mempool.space data as fee options
  - Show 100 inscriptions per page
- Fix
  - Fix display error of pagination
  - Fix a issue that addresses holding too many UTXOs cannot construct transactions
  - Fix a issue that changing wallet/account name sometimes does not take effect
  - Fix a issue that N/A problem occurs because the input amount is not legal

## v1.1.15

**Major changes**

- brc-20 related
  - Add brc-20 transfer and inscribing functions
- Account related
  - Add support for modifying account name
  - Display both BTC balance and inscription count of different address type.
- Domain resolution related
  - Add domain name resolution of .unisat
  - After a domain name is resolved successfully, the corresponding inscription number will be displayed
  - Fixed the problem that the parsing of special symbols failed
- Transaction related
  - Optimize the display of SignPSBT page
  - When the payment fails, a specific error message will be displayed
- Unisat Api related
  - Add getInscriptions method
  - Add sendInscription method
- Others
  - Fixed text issue

## v1.1.14

**Major changes**

- Change logo
- Add activeTab permission

## v1.1.13

**Major changes**

- Fix issue in v1.1.12

## v1.1.12

**Major changes**

- Fix some error of creating transactions

**Minor changes**

- Can choose P2TR address type when restoring from Xverse Wallet
- Hide Inscription Number when unconfirmed
- Remove .btc text

## v1.1.11

**Major changes**

- Remove .btc domain

## v1.1.10

**Major changes**

- Support customization of outputValue

## v1.1.9

**Minor changes**

- Disable in iframes
- Keep unlocked for longer
- Fix duplicate pop-up windows

## v1.1.8

**Major changes**

- Remove the "activeTab" and "notifications" permissions

## v1.1.7

**Major changes**

- Support .sats, .btc as recipient address
- Support customizing network fee rate
- Fix the signature error of P2TR

**Minor changes**

- Support to view the detail of address in signing page

## v1.1.6

**Major changes**

- Support custom hdPath

**Minor changes**

- Unify and extend the abbreviation length of address
- Complete the display of hdPath

## v1.1.5

**Major changes**

- Wallet account structure changes, support multiple HD wallets, each wallet supports multiple accounts
- Support recovery from wallets such as Sparrow, Xverse, etc.
- Support P2SH-P2WPKH address format

**Minor changes**

- The wallet will wait for the website to load and then inject, up to 60s
- Automatically reject approvals when window loses focus

## v1.0.3

**Major changes**

- The displaying layout of NFTs in the extension is updated to match the layout on https://unisat.io/
- The default focus is set into the input field for easier keyboard input as needed

**Minor changes**

- Prevent the inscription script from executing on its own
- Removed temporary data stored in local storage
- Fixed some script errors
