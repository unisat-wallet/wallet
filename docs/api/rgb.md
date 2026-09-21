# RGB API (Experimental)

The RGB provider is available only under `window.unisat.rgb`. There are no
top-level `window.unisat.*Rgb*` methods.

```ts
const rgb = window.unisat.rgb
```

RGB is available only when the currently selected wallet chain has RGB enabled.
The dApp must first connect with `window.unisat.requestAccounts()`. Payment
and swap operations are bound to the connected origin; an operation created by
one origin cannot normally be queried, signed, or finalized by another origin.
The explicitly approved swap-recovery methods described below are exceptions.
Receive invoices are currently wallet-wide pending state, so a dApp must only
accept/reject the recipient ID it created or was explicitly given.

## Conventions

- `assetId` is a canonical RGB contract ID, for example `rgb:...`.
- RGB asset amounts and public request parameters representing satoshi amounts
  are unsigned decimal strings in atomic units. Never use JavaScript `number`
  for an asset amount. Returned UTXO `satoshis` fields and `feeRate` parameters
  are JavaScript numbers.
- An invoice is one-time. A blind invoice reserves an existing RGB funding
  outpoint; a witness invoice requires the sender transaction to create its
  receiver output.
- The wallet owns RGB state, private keys, transition construction,
  consignment transport, ACK handling, and final broadcasting. A dApp must
  not call generic `signPsbt`/`pushPsbt` to complete an RGB operation.

## API overview

| Method | Approval | Purpose |
|---|---:|---|
| `getAssets` | No | Read local RGB balances. |
| `getFundingUtxos` / `getFeeUtxos` | No | Read eligible inputs for a maker PSBT template. |
| `createReceiveInvoice` | Yes | Create and persist a one-time RGB invoice. |
| `getPendingReceives` | No | List local invoices and pending incoming consignments. |
| `acceptReceive` / `rejectReceive` | Yes | ACK or reject a validated incoming consignment. |
| `preparePayment` | Yes | Build and lock a normal RGB payment. |
| `signPayment` | Yes | Sign, deliver the consignment, wait for ACK, then broadcast. |
| `cancelPayment` / `getPaymentStatus` | Yes / No | Cancel an unacknowledged payment or inspect its status. |
| `prepareSwap` | Yes | Prepare a seller-side RGB-for-BTC atomic swap. |
| `signSellSwapAndPublishConsignment` | Yes | Add seller signatures and publish the consignment, without broadcasting. |
| `confirmSellSwap` | No | Verify the buyer's returned signed PSBT and ACK; the dApp finalizes and broadcasts it. |
| `applySellSwapAbort` / `applyBuySwapAbort` | Yes | Apply a mutually signed, terminal swap-abort agreement to local seller/buyer RGB state. |
| `getSellSwapAbortOrigin` | No | Inspect the seller operation's original dApp origin before recovery. |
| `cancelSwap` / `getOperationStatus` | Yes / No | Cancel or inspect a swap. |
| `signBuySwapAndAcceptConsignment` | Yes | Sign buyer BTC inputs and accept the RGB consignment. |

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

## Receive RGB

### `createReceiveInvoice(params)`

Creates durable receiver state before exposing the invoice to a sender.

```ts
const receive = await rgb.createReceiveInvoice({
  assetId: 'rgb:...',        // omit only for an any-asset invoice
  amount: '1000',            // omit only for an any-amount invoice
  durationSeconds: 900,
  recipientType: 'blind',    // 'blind' (default) | 'witness'
})

// {
//   invoice, recipientId, assetId?, amount?, expirationTimestamp?, createdAt?,
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

### `getPendingReceives()`

```ts
const { list } = await rgb.getPendingReceives()
```

Each item includes its invoice, recipient ID, optional asset/amount and a
status. Relevant statuses are `WaitingConfirmations`, `WaitingCounterparty`,
`PendingAccept`, `WaitingSenderBroadcast`, and
`WaitingSenderConfirmation`.

### `acceptReceive(recipientId)` and `rejectReceive(recipientId)`

```ts
await rgb.acceptReceive(recipientId)
// or
await rgb.rejectReceive(recipientId)
```

Only call `acceptReceive` after the wallet reports `PendingAccept`. Acceptance
sends the receiver ACK after local consignment validation; the sender is then
responsible for broadcasting its transaction. A receiver never broadcasts the
sender transaction.

## Normal RGB payment

Normal payment is currently a two-step API so the wallet can persist the
locked allocation before the signing approval opens.

### `preparePayment(params)`

```ts
const prepared = await rgb.preparePayment({
  invoice: receiverInvoice,
  assetId: 'rgb:...',
  amount: '1000', // optional only when the invoice fixes the amount
  feeRate: 5,
})

// { id, psbt, toSignInputs, lockedOutpoints, ... }
```

The wallet validates the invoice, selects confirmed spendable RGB allocations,
constructs and commits the transition, then durably locks the selected inputs.
Keep `prepared.id` as the payment `transferId`.

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

## RGB/BTC atomic swap: buy RGB with BTC

The buyer first creates an RGB invoice with `createReceiveInvoice`. The maker
must create and sign the swap transaction, publish its consignment to that
invoice, and wait for the wallet to show the invoice as `PendingAccept`.
`signBuySwapAndAcceptConsignment` then signs the buyer's BTC inputs and sends the ACK.

This supports both recipient forms:

- `blind`: the invoice's pre-reserved concealed seal is used; no receiver RGB
  output is added to the transaction;
- `witness`: the maker transaction must include the invoice's RGB receiver
  output.

### `signBuySwapAndAcceptConsignment(params)`

```ts
const { list } = await rgb.getPendingReceives()
const receive = list.find(item => item.status === 'PendingAccept')

const result = await rgb.signBuySwapAndAcceptConsignment({
  recipientId: receive.recipientId,
  assetId: 'rgb:...',
  amount: '1000',
  maxBtcSpend: '251000', // all BTC leaving current account, including fee/carrier sats
  makerSignedPsbt,
})

// { recipientId, status: 'accepted', signedPsbt }
```

Before approval, the wallet verifies that the receipt's validated asset,
amount, and transaction ID match the supplied PSBT. It requires all
maker-controlled inputs to be signed, identifies only current-account BTC
inputs for user signing, requires `SIGHASH_ALL`, disables RBF/locktime, and
rejects a net current-account spend above `maxBtcSpend`.

On approval the wallet signs its inputs, sends the RGB ACK, and returns the
signed PSBT. Finalization and broadcast are intentionally delegated to the
dApp; it must preserve the exact unsigned transaction and use the returned
PSBT when constructing the final transaction. The wallet subsequently observes
and settles the received RGB transfer through its normal receive sync.

Do not call this method before the invoice is `PendingAccept`: a PSBT alone
cannot prove the RGB amount being received.

## RGB/BTC atomic swap: sell RGB for BTC

This initial seller-side atomic-swap API supports one NIA RGB asset sold for
BTC.

### `prepareSwap(params)`

The maker/dApp creates an **unsigned** Bitcoin PSBT template and a one-time RGB
invoice for itself. The wallet locks the seller's RGB allocations, verifies the
template, colors it, and returns the colored PSBT for maker signing.

```ts
const prepared = await rgb.prepareSwap({
  invoice: makerOneTimeRgbInvoice,
  assetId: 'rgb:...',
  amount: '1000',
  btcReceiveAmount: '250000', // minimum sats to current wallet BTC address
  feeRate: 5,
  psbt: makerUnsignedPsbt,    // hex or base64
})

// { transferId, coloredPsbt, status: 'waiting_counterparty_signature' }
```

The wallet enforces all of the following:

- every selected RGB input is present and its PSBT prevout matches local state;
- `vout 0` is the sole empty `OP_RETURN` host before coloring;
- locktime is zero, input sequences are final, and RBF is disabled;
- the template has no signatures and uses `SIGHASH_ALL` (Taproot default is
  accepted);
- `btcReceiveAmount` or more pays the current wallet Bitcoin address;
- witness recipients have a matching dust-safe output; blind recipients do
  not create an output;
- partial RGB change returns to the wallet RGB funding script.

### `signSellSwapAndPublishConsignment(transferId, makerSignedPsbt)`

This is the seller's first completion phase. It signs the seller-controlled
inputs, publishes the RGB consignment, and returns the seller-signed PSBT to
relay to the buyer. It never broadcasts at this point.

```ts
const published = await rgb.signSellSwapAndPublishConsignment(prepared.transferId, prepared.coloredPsbt)
// { transferId, txid, status: 'awaiting_buyer_signature', makerSignedPsbt }
```

Once the buyer calls `signBuySwapAndAcceptConsignment`, relay its returned `signedPsbt` back to
the seller and call `confirmSellSwap`. The wallet rechecks the committed unsigned
transaction and verifies the buyer ACK. It does not finalize the PSBT; the
dApp finalizes it and broadcasts the resulting transaction.

```ts
const confirmed = await rgb.confirmSellSwap(prepared.transferId, buyerResult.signedPsbt)
// { transferId, txid, signedPsbt, status: 'ready_for_dapp_finalize' }
const finalPsbt = finalizeAllInputsInDapp(confirmed.signedPsbt)
await window.unisat.pushPsbt(finalPsbt)
```

### `getOperationStatus(transferId)` and `cancelSwap(transferId)`

```ts
const status = await rgb.getOperationStatus(transferId)
await rgb.cancelSwap(transferId)
```

These have the same ownership and cancellation rules as normal payments.

### Mutually agreed terminal swap abort

`cancelSwap` is only for a swap that has not received a buyer ACK. If the
buyer has signed and accepted the RGB consignment but the transaction is known
to be terminally unbroadcastable, the market must first collect a BIP-322
abort agreement from both participants. Only after that agreement is visible
to both wallets may each participant apply its local recovery:

```ts
// seller: releases only this locally locked, ACKed external-broadcast swap
await rgb.applySellSwapAbort(transferId)

// buyer: records the accepted receipt as canceled history; it is never settled
await rgb.applyBuySwapAbort(recipientId)
```

Before the seller action, `getSellSwapAbortOrigin(transferId)` returns the
original dApp origin and whether it matches the current site. A mutually
agreed abort is deliberately allowed from a different site after user
approval. A pre-ACK `cancelSwap` is also allowed after cancellation approval;
ordinary RGB payment operations remain origin-bound.

These methods are intentionally local and idempotent. The dApp must not call
either one before the market has verified both agreement signatures. A seller
abort releases only a transfer that has not been broadcast; a buyer abort
keeps a canceled receipt history entry so the same consignment is not later
credited after a restart.

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
