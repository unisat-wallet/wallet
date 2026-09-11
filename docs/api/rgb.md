# RGB API (Experimental)

The RGB provider is available only under `window.unisat.rgb`. There are no
top-level `window.unisat.*Rgb*` methods.

```ts
const rgb = window.unisat.rgb
```

RGB is available only when the currently selected wallet chain has RGB enabled.
The dApp must first connect with `window.unisat.requestAccounts()`. Payment
and swap operations are bound to the connected origin; an operation created by
one origin cannot be queried, signed, finalized, or cancelled by another
origin. Receive invoices are currently wallet-wide pending state, so a dApp
must only accept/reject the recipient ID it created or was explicitly given.

## Conventions

- `assetId` is a canonical RGB contract ID, for example `rgb:...`.
- RGB values and satoshi values are unsigned decimal strings in atomic units.
  Never use JavaScript `number` for an asset amount.
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
| `createReceiveInvoice` | Yes | Create and persist a one-time RGB invoice. |
| `getPendingReceives` | No | List local invoices and pending incoming consignments. |
| `acceptReceive` / `rejectReceive` | Yes | ACK or reject a validated incoming consignment. |
| `preparePayment` | Yes | Build and lock a normal RGB payment. |
| `signPayment` | Yes | Sign, deliver the consignment, wait for ACK, then broadcast. |
| `cancelPayment` / `getPaymentStatus` | Yes / No | Cancel an unacknowledged payment or inspect its status. |
| `prepareSwap` | Yes | Prepare a seller-side RGB-for-BTC atomic swap. |
| `finalizeSwap` | Yes | Add user signatures and complete the swap delivery flow. |
| `cancelSwap` / `getOperationStatus` | Yes / No | Cancel or inspect a swap. |
| `completeBuySwap` | Yes | Complete a buyer-side BTC-for-RGB atomic swap. |

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
// { transferId, status: 'waiting_ack' | 'rejected' | 'canceled' |
//                       'broadcast_failed', txid? }
```

The wallet signs its own inputs, publishes the consignment, waits for a valid
receiver ACK, and broadcasts the exact signed transaction itself. `waiting_ack`
is an expected asynchronous state, not an error.

### `getPaymentStatus(transferId)` and `cancelPayment(transferId)`

```ts
const status = await rgb.getPaymentStatus(transferId)
await rgb.cancelPayment(transferId)
```

Status includes `transferId`, `assetId`, `amount`, optional `txid`, and one of
`prepared`, `waiting_ack`, `broadcasting`, `broadcasted`,
`broadcast_failed`, `canceled`, `rejected`, or `unknown`. Cancellation is only
possible before a valid ACK or broadcast.

## RGB/BTC atomic swap: buy RGB with BTC

The buyer first creates an RGB invoice with `createReceiveInvoice`. The maker
must create and sign the swap transaction, publish its consignment to that
invoice, and wait for the wallet to show the invoice as `PendingAccept`.
`completeBuySwap` then signs the buyer's BTC inputs and sends the ACK.

This supports both recipient forms:

- `blind`: the invoice's pre-reserved concealed seal is used; no receiver RGB
  output is added to the transaction;
- `witness`: the maker transaction must include the invoice's RGB receiver
  output.

### `completeBuySwap(params)`

```ts
const { list } = await rgb.getPendingReceives()
const receive = list.find(item => item.status === 'PendingAccept')

const result = await rgb.completeBuySwap({
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
fully signed PSBT. The dApp must immediately pass that exact PSBT to the maker
for broadcast. The wallet subsequently observes and settles the received RGB
transfer through its normal receive sync.

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

### `finalizeSwap(transferId, makerSignedPsbt)`

```ts
const result = await rgb.finalizeSwap(prepared.transferId, makerSignedPsbt)
// { transferId, status: 'waiting_ack' | 'broadcasted' |
//                       'broadcast_failed', txid? }
```

The maker must sign only maker-controlled inputs before calling this method.
The wallet rejects any change to the prepared unsigned transaction, requests
the user signature for wallet-owned RGB inputs, publishes the consignment, and
broadcasts only after a valid ACK. The dApp must not broadcast the PSBT.

### `getOperationStatus(transferId)` and `cancelSwap(transferId)`

```ts
const status = await rgb.getOperationStatus(transferId)
await rgb.cancelSwap(transferId)
```

These have the same ownership and cancellation rules as normal payments.

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
