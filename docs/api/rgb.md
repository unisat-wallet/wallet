# Native RGB API (Experimental)

This document covers UniSat's native, wallet-specific RGB API at
`window.unisat.rgb`. It does **not** describe the standard WebRGB v1 provider
at `window.rgb`; see [WebRGB Provider](./webrgb.md) for that interface.

There are no top-level `window.unisat.*Rgb*` methods.

```ts
const rgb = window.unisat.rgb
```

RGB is available only when the currently selected wallet chain supports RGB
and the user has enabled RGB for the selected wallet. The dApp must first
connect with `window.unisat.requestAccounts()`.

If the wallet is locked, an account-bound call opens the normal unlock flow and
continues after a successful unlock. Read methods marked "No" below do not open
a second action-confirmation screen, but connection and unlock prompts may
still be required.

Payment, receive, issuance, and swap operations are bound to the connected
origin. An operation created by one origin cannot be listed, accepted,
rejected, signed, finalized, canceled, or aborted by another origin.

## Conventions

- `assetId` is a canonical RGB contract ID, for example `rgb:...`.
- RGB asset amounts and public request parameters representing satoshi amounts
  are unsigned decimal strings in atomic units. Never use JavaScript `number`
  for an asset amount. Returned UTXO `satoshis` fields and `feeRate` parameters
  are JavaScript numbers.
- Do not copy examples from the WebRGB document without converting the amount
  types. WebRGB v1 uses positive JavaScript safe integers for fungible amounts;
  this native API uses decimal strings.
- An invoice is one-time. A blind invoice reserves an existing RGB funding
  outpoint; a witness invoice requires the sender transaction to create its
  receiver output.
- The wallet owns RGB state, private keys, transition construction,
  consignment transport, ACK handling, and final broadcasting. A dApp must
  not call generic `signPsbt`/`pushPsbt` to complete an RGB operation.

## API overview

| Method                                     | Approval | Purpose                                                                                      |
| ------------------------------------------ | -------: | -------------------------------------------------------------------------------------------- |
| `getAssets`                                |       No | Read local RGB balances.                                                                     |
| `getFundingUtxos` / `getFeeUtxos`          |       No | Read eligible inputs for a maker PSBT template.                                              |
| `getIssueAvailability`                     |       No | Inspect whether a confirmed, unallocated RGB funding UTXO is available.                      |
| `issueNia`                                 |      Yes | Verify a wallet issuance order, pay its service fee if needed, and issue one NIA allocation. |
| `createReceiveInvoice`                     |      Yes | Create and persist a one-time RGB invoice.                                                   |
| `getPendingReceives`                       |       No | List this dApp origin's invoices and pending incoming consignments.                          |
| `acceptReceive` / `rejectReceive`          |      Yes | ACK or reject a validated incoming consignment.                                              |
| `preparePayment`                           |      Yes | Build and lock a normal RGB payment.                                                         |
| `signPayment`                              |      Yes | Sign, deliver the consignment, wait for ACK, then broadcast.                                 |
| `cancelPayment` / `getPaymentStatus`       | Yes / No | Cancel an unacknowledged payment or inspect its status.                                      |
| `prepareSwap`                              |      Yes | Prepare a seller-side RGB-for-BTC atomic swap.                                               |
| `signSellSwapAndPublishConsignment`        |      Yes | Add seller signatures and publish the consignment, without broadcasting.                     |
| `signBuySwapCommit`                        |       No | Pure P2P: bind one buyer PSBT hash using the seller transfer's Proxy sender key.              |
| `confirmSellSwap`                          |       No | Verify the buyer's returned signed PSBT and ACK; the dApp finalizes and broadcasts it.       |
| `syncSellSwapAck`                          |       No | Query and verify the receiver's Proxy ACK without importing or returning the final PSBT.     |
| `applySellSwapAbort` / `applyBuySwapAbort` |      Yes | Apply a mutually signed, terminal swap-abort agreement to local seller/buyer RGB state.      |
| `cancelSwap` / `getOperationStatus`        | Yes / No | Cancel or inspect a swap.                                                                    |
| `signBuySwap` / `acceptBuySwap`            |      Yes | Sign buyer BTC inputs, then ACK a backend-committed swap.                                     |

## Assets

### `getAssets(page?, pageSize?)`

Returns the local wallet's RGB asset balances. `page` defaults to `1` and
`pageSize` to `50`.

```ts
const assets = await rgb.getAssets(1, 50)
// { total, list: [{ assetId, ticker, name, precision, balance, settled?, spendable? }] }
```

Balances are local wallet state. A dApp should use `precision` only for display
and always pass transfer amounts as atomic-unit strings.

### `getFundingUtxos(assetId)` and `getFeeUtxos()`

These methods expose the minimum unlocked input information needed to build a
seller-side swap template. RGB funding UTXOs are confirmed; fee-pool
availability follows the wallet's Bitcoin UTXO source. They are candidate
queries, not a reservation: `prepareSwap` independently rechecks ownership,
confirmation and lock state before it writes the commitment.

```ts
const { utxos: rgbInputs } = await rgb.getFundingUtxos('rgb:...')
const { utxos: feeInputs } = await rgb.getFeeUtxos()

// RGB carrier UTXO
// { txid, vout, satoshis, scriptPubKey, allocations: [{ assetId, amount }] }
// RGB fee-pool UTXO
// { txid, vout, satoshis, scriptPubKey }
```

`getFundingUtxos` excludes unconfirmed, locked and mixed-asset carriers;
`getFeeUtxos` excludes locked fee-pool UTXOs and known inscription/atomical
outputs. Neither method returns private keys, derivation data, RGB transition
history, blind seals, or allocation operation IDs.

When a returned fee-pool outpoint is included in a seller swap template, the
wallet recognizes it as wallet-owned and includes it in the signing request.
The dApp must still account for its sats correctly in the user payout/change
outputs; querying an outpoint never reserves it.

## Issue an NIA asset

Native issuance is intentionally separate from WebRGB's `issueAsset` shape.
It requires a wallet issuance order created by the UniSat issuance service;
the wallet does not trust ticker, supply, fee, address, network, or payment
state supplied by the page.

### `getIssueAvailability()`

Returns the wallet's current allocation availability after synchronizing RGB
state.

```ts
const availability = await rgb.getIssueAvailability()
// {
//   available: boolean,
//   availableAllocationCount: number,
//   freeAllocationCount: number,
//   colorableUtxoCount: number,
//   pendingConfirmation: boolean,
//   pendingAllocationCount: number,
// }
```

`available: false` with `pendingConfirmation: true` means a funding output is
known but is not yet available for issuance. This query does not reserve an
output.

### `issueNia(params)`

```ts
const result = await rgb.issueNia({
  orderId: '202610-RGB20-ABC12345',
  ticker: 'TOK',
  name: 'Token',
  precision: 2,
  amount: '100000',
  // paymentTxid: '<64 hex chars>', // only when resuming an existing payment
})
```

Before showing approval, the wallet fetches `orderId` from the configured
wallet API and requires its network, current Bitcoin address, ticker, name,
precision, amount, fee address, fee amount, and status to match. A page cannot
provide its own fee transaction or override the service fee.

If the order is still unpaid, the approval includes the wallet-built Bitcoin
funding transaction and service-fee payment. If the payment already exists,
`paymentTxid` can resume the verified order without paying again.

Successful issuance returns only public identifiers and state flags; private
contract and Genesis bytes are not exposed to the page:

```ts
// {
//   status: 'issued',
//   paymentTxid,
//   assetId,
//   pendingConfirmation: boolean,
//   syncPending: boolean,
// }
```

A recoverable asynchronous result can instead be:

```ts
// { status: 'payment_pending', paymentTxid, error }
// { status: 'issuance_pending', paymentTxid, error }
```

Persist `orderId` and `paymentTxid` and retry the same verified order. Do not
create a replacement order merely because indexing or payment verification is
temporarily pending.

## Receive RGB

### `createReceiveInvoice(params)`

Creates durable receiver state before exposing the invoice to a sender.

```ts
const receive = await rgb.createReceiveInvoice({
  assetId: 'rgb:...', // omit only for an any-asset invoice
  amount: '1000', // omit only for an any-amount invoice
  durationSeconds: 900,
  minConfirmations: 3,
  recipientType: 'blind', // 'blind' (default) | 'witness'
  proxyId: 'signet-v04', // optional trusted profile ID
})

// {
//   invoice, recipientId, assetId?, amount?, expirationTimestamp?,
//   minConfirmations?, createdAt?, witnessScriptPubKey?, canCancel?,
//   kind: 'ReceiveBlind' | 'ReceiveWitness',
//   status: 'WaitingConfirmations' | 'WaitingCounterparty',
// }
```

For a `witness` invoice, the returned receive metadata also includes
`witnessScriptPubKey`. A P2P swap dApp must place a dust-safe output paying
that exact script in its unsigned Bitcoin template before the seller calls
`prepareSwap`.

Use `blind` unless the sender explicitly requires a revealed/witness
beneficiary. A blind invoice needs an available RGB funding UTXO first. A
witness invoice does not reserve an existing UTXO; its recipient output is
created by the sender transaction.

`durationSeconds` must be a positive integer. When omitted, the wallet creates
an invoice with a 24-hour expiry. `minConfirmations`, when supplied to this
native API, must be a positive integer; settlement waits for that many Bitcoin
confirmations. WebRGB applies a separate minimum floor of three confirmations.

`proxyId` selects one of the trusted Proxy profiles configured by the wallet.
It is an identifier, not a URL: a dApp cannot provide an arbitrary endpoint or
override the profile's name and version metadata. Omit it to use the wallet's
configured default. The wallet resolves and pins the effective profile before
showing approval; the approval's Invoice Details show its name, ID, protocol
version, server version, and endpoint.

Proxy profiles and the effective `defaultProxyId` are advertised by the
WebRGB provider's [`getInfo()`](./webrgb.md#getinfo). A dApp that offers a
selector should pass back only an advertised profile's `id`:

```ts
await window.rgb.enable()
const { proxyProfiles, defaultProxyId } = await window.rgb.getInfo()

const selectedProxyId = proxyProfiles?.find(profile => profile.id === defaultProxyId)?.id
const receive = await window.unisat.rgb.createReceiveInvoice({
  recipientType: 'blind',
  proxyId: selectedProxyId,
})
```

The `protocolVersion` and `serverVersion` fields describe different layers.
For example, Proxy protocol `1.0` may be served by server implementation
`0.3.0` or `0.4.0`; do not infer one from the other.

### `getPendingReceives()`

```ts
const { list } = await rgb.getPendingReceives()
```

Each item includes its invoice, recipient ID, optional asset/amount and a
status. Relevant statuses are `WaitingConfirmations`, `WaitingCounterparty`,
`PendingAccept`, `WaitingSenderBroadcast` (a compatibility name meaning the
released transaction is awaiting broadcast), and
`WaitingSenderConfirmation`, and `ValidationFailed`. `canCancel` reports
whether the local invoice can still be canceled safely.

### `acceptReceive(recipientId)` and `rejectReceive(recipientId)`

```ts
await rgb.acceptReceive(recipientId)
// or
await rgb.rejectReceive(recipientId)
```

Only call `acceptReceive` after the wallet reports `PendingAccept`. Acceptance
sends the receiver ACK after local consignment validation. For Proxy v1, once
all operations have ACKed, the proxy releases the same signed transaction to
both sides. The receiver persists and normally broadcasts it immediately; the
sender may submit the identical transaction as an idempotent liveness fallback.
Legacy transfers keep their original sender-broadcast flow.

## Normal RGB payment

Normal payment is currently a two-step API so the wallet can persist the
locked allocation before the signing approval opens.

### `preparePayment(params)`

```ts
const prepared = await rgb.preparePayment({
  invoice: receiverInvoice,
  assetId: 'rgb:...',
  amount: '1000', // a positive integer string or safe JavaScript integer
  feeRate: 5,
})

// { id, psbt, toSignInputs, lockedOutpoints, ... }
```

The wallet validates the invoice, selects confirmed spendable RGB allocations,
constructs and commits the transition, then durably locks the selected inputs.
Keep `prepared.id` as the payment `transferId`.

If an invoice advertises a third-party RGB proxy endpoint, its direct-access
consent is included in the same payment approval. The dApp must not contact the
endpoint itself or manufacture an approval result. Depending on wallet policy,
transport may use a trusted endpoint directly or the wallet API relay; the
payment remains bound to the exact prepared invoice and origin.

### `signPayment(transferId)`

```ts
const result = await rgb.signPayment(prepared.id)
// While delivery is incomplete:
// { transferId, status: 'waiting_ack' | 'rejected' | 'canceled' |
//                       'broadcast_failed', txid?, error? }
// When ACK and broadcast complete in this request:
// { txid, rawTx, consignments, fundingUpdate? }
```

The wallet signs its own inputs, publishes the consignment, waits for a valid
receiver ACK, and broadcasts the exact signed transaction itself. `waiting_ack`
is an expected asynchronous state, not an error.

### `getPaymentStatus(transferId)` and `cancelPayment(transferId)`

```ts
const status = await rgb.getPaymentStatus(transferId)
await rgb.cancelPayment(transferId)
```

Payment status includes `transferId`, optional `assetId`, `amount`, and `txid`,
and one of `prepared`, `waiting_ack`, `broadcasting`, `broadcasted`,
`broadcast_failed`, `canceled`, `rejected`, or `unknown`. Swap operations may
additionally report `awaiting_buyer_signature` or `ready_for_dapp_finalize`.
Cancellation is only possible before a valid ACK or broadcast.
An unsuccessful cancellation includes a machine-readable `reason`, such as
`transfer_not_found`, `already_broadcast`, or
`acknowledged_requires_agreement`. A payment amount supplied as a JavaScript
number is normalized to its decimal string before approval; fractions, unsafe
integers, and non-positive values are rejected.

## RGB/BTC atomic swaps

Choose exactly one integration model for each application. The two models have
different key ownership and call ordering; do not combine their completion
methods.

### Version requirements

| Method | Minimum wallet version |
| --- | --- |
| `prepareSwap` | v1.8.0 |
| `signSellSwapAndPublishConsignment` | v1.8.0 |
| `confirmSellSwap` | v1.8.0 |
| `cancelSwap` / `getOperationStatus` | v1.8.0 |
| `createReceiveInvoice({ purpose: "buy_swap" })` | v1.8.3 |
| `signBuySwap` / `acceptBuySwap` | v1.8.3 |
| `syncSellSwapAck` | **v1.8.4** |
| `signBuySwapCommit` | **v1.8.4** |

The RGB-seller flow in each integration model requires **v1.8.4 or later**.
The backend-coordinated BTC-to-RGB buyer flow remains available in v1.8.3.
Applications should also feature-detect the model-specific method instead of
relying only on a version string:

```ts
if (typeof window.unisat?.rgb?.syncSellSwapAck !== 'function') {
  throw new Error('Backend-coordinated RGB swaps require UniSat Wallet v1.8.4+')
}

if (typeof window.unisat?.rgb?.signBuySwapCommit !== 'function') {
  throw new Error('Pure P2P RGB swaps require UniSat Wallet v1.8.4+')
}
```

- [Backend-coordinated mode](./rgb-swap-backend.md): the application backend is
  the RGB counterparty, retains the final transaction and broadcasts it. Use
  `syncSellSwapAck` for an RGB seller.
- [Pure P2P mode](./rgb-swap-p2p.md): both users sign with their own UniSat
  wallets and the trading page combines the two partial PSBTs. Use
  `signBuySwapCommit` followed by `confirmSellSwap`.

Both modes use `purpose: "buy_swap"` for the buyer invoice, origin-bind every
operation, persist restart-safe state, and disable unilateral cancellation after
a positive ACK. The dedicated documents define the only supported call order,
commitment format and recovery procedure for each mode.

## Receiver and ACK requirements

An app receiving RGB must operate an RGB receiver service that retains the
invoice's receive state, verifies the consignment against the invoice and
chain anchor, and sends the ACK only after successful validation. Storing an
invoice string alone is not sufficient. No dApp callback can mark a wallet
operation as delivered, broadcast, or settled.

## Error handling

Treat provider errors as terminal for the current request unless the error
states that an operation is awaiting ACK or has a recoverable broadcast
failure. Persist `transferId` immediately after preparation and poll the
corresponding status method after a page reload. Do not retry a preparation
request blindly: it may already have locked local RGB allocations.

Native provider errors use numeric JSON-RPC/EIP-1193-style codes. Important
stable codes include:

|     Code | Meaning                                     |
| -------: | ------------------------------------------- |
|   `4001` | User rejected or canceled an approval.      |
|   `4100` | The origin is not connected or authorized.  |
| `-32602` | Invalid parameters.                         |
| `-32020` | RGB is not enabled for the selected wallet. |
| `-32021` | The requested RGB asset is not known.       |

Use `error.code` for control flow and `error.message` for display. Provider
errors intentionally do not expose background stack traces or an
`originalError` object. These numeric codes are not the same as WebRGB's
string error codes.
