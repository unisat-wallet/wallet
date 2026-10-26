# WebRGB v1 Provider

This document covers UniSat's WebRGB v1 provider at `window.rgb`. It is a
standards-oriented adapter for common RGB receive, send, and tracking flows.

It is separate from UniSat's native API:

| Provider            | Purpose                                               | Amount representation             |
| ------------------- | ----------------------------------------------------- | --------------------------------- |
| `window.rgb`        | WebRGB v1 interoperability                            | Positive JavaScript safe integers |
| `window.unisat.rgb` | UniSat-specific issuance, payments, and RGB/BTC swaps | Unsigned decimal strings          |

For the native API, see [Native RGB API](./rgb.md). Methods from the two
providers are not interchangeable. In particular, WebRGB does not expose the
native swap workflow or UniSat's order-based NIA issuance workflow.

## Provider discovery

UniSat installs `window.rgb` only when that slot is not already owned by
another wallet. It always participates in multi-wallet discovery:

- pages dispatch `rgb:requestProvider`;
- UniSat dispatches `rgb:announceProvider` with `{ info, provider }`;
- when UniSat installs `window.rgb`, it also dispatches `rgb:ready` with
  `{ version: '1.0.0' }`.

```ts
const announced: Array<{ info: any; provider: any }> = []

window.addEventListener('rgb:announceProvider', event => {
  announced.push((event as CustomEvent).detail)
})
window.dispatchEvent(new Event('rgb:requestProvider'))
```

UniSat announces:

```ts
{
  name: 'UniSat Wallet',
  rdns: 'io.unisat.wallet',
  uuid: '<fresh UUID for this page load>',
}
```

Deduplicate providers by `rdns`, not by `uuid`. The UUID identifies one page
announcement and changes on reload.

## Connect and feature-detect

Call `enable()` before every other WebRGB method:

```ts
const rgb = window.rgb
if (!rgb) throw new Error('No WebRGB provider found')

await rgb.enable()
const info = await rgb.getInfo()
```

`enable()` uses UniSat's normal site-connection approval and is idempotent for
an already connected origin. If the wallet is locked, the request first opens
the wallet unlock flow. A later account-bound call also reopens the unlock flow
when necessary.

`provider.enabled` only means that `enable()` completed in the current page.
Use `getInfo().ready` to decide whether the selected wallet and chain can use
RGB:

```ts
type RgbInfo = {
  ready: boolean
  network: string
  protocol: 'RGB_L1' | null
  methods: string[]
}
```

When RGB is unavailable, UniSat returns `ready: false`, `protocol: null`, and
only advertises `enable` and `getInfo`. Check `methods` before calling an
optional method. If site permission is removed, the next call rejects with
`NOT_ENABLED`; call `enable()` again instead of retrying the failed operation.

## Supported methods

On an RGB-enabled L1 wallet, `getInfo().methods` contains:

| Method              | Action approval | Purpose                                                                     |
| ------------------- | --------------: | --------------------------------------------------------------------------- |
| `enable`            | Connection only | Connect the current origin.                                                 |
| `getInfo`           |              No | Return readiness and capabilities.                                          |
| `getAddress`        |              No | Return the Bitcoin address anchoring RGB state.                             |
| `blindReceive`      |             Yes | Create a one-time blinded receive invoice.                                  |
| `witnessReceive`    |             Yes | Create a receive invoice whose output is created by the sender transaction. |
| `listAssets`        |              No | Return all locally known RGB assets.                                        |
| `getAssetBalance`   |              No | Return one asset balance.                                                   |
| `sendAsset`         |             Yes | Prepare, sign, deliver, ACK, and broadcast an RGB payment.                  |
| `listTransfers`     |              No | Return local send/receive history.                                          |
| `getTransferStatus` |              No | Find one transfer by wallet ID, recipient ID, or txid.                      |
| `decodeRgbInvoice`  |              No | Decode an invoice without moving funds.                                     |
| `on` / `off`        |              No | Subscribe to polled transfer events.                                        |

Read methods do not open an action-confirmation screen, although connection or
wallet unlock may still be required.

The following WebRGB methods are present on the JavaScript object for
compatibility but are not advertised and reject with `METHOD_NOT_SUPPORTED`:

- `issueAsset`
- `burnAsset`
- `getConsignment`
- `signMessage`
- `makeLnInvoice`
- `payLnInvoice`

UniSat currently reports `RGB_L1`, not `RGB_LN`. Native
`window.unisat.rgb.issueNia()` support does not make WebRGB `issueAsset`
available because the native flow requires a verified order ID and service-fee
payment that WebRGB's arguments cannot represent.

## Amount rules

WebRGB fungible amounts are JavaScript `number` values and must be safe
integers:

```ts
Number.isSafeInteger(amount) && amount > 0
```

They are atomic/base units; apply the asset's `precision` only for display.
UniSat rejects values above `Number.MAX_SAFE_INTEGER` rather than rounding
them. This differs from the native API, which accepts decimal strings and can
represent the full protocol range.

`feeRate`, `durationSeconds`, and `minConfirmations` are also numeric. Do not
pass decimal strings to WebRGB methods unless a future advertised capability
explicitly allows them.

## Wallet information

### `getInfo()`

Returns the readiness object described above and refreshes the capability list
for the current wallet context.

### `getAddress()`

```ts
const { address } = await rgb.getAddress()
```

The address is the wallet's Bitcoin RGB funding address. It is not an RGB
invoice and must not be passed to `sendAsset` as a recipient ID.

## Receive

### `blindReceive(args?)` and `witnessReceive(args?)`

```ts
const receive = await rgb.blindReceive({
  assetId: 'rgb:...', // omit for any asset
  amount: 1000, // omit for any amount
  durationSeconds: 900,
  minConfirmations: 3,
})

// {
//   invoice,
//   recipientId,
//   expirationTimestamp,
//   minConfirmations,
// }
```

Rules:

- `assetId`, when supplied, must identify an asset already known to the wallet;
  otherwise the call rejects with `ASSET_NOT_FOUND`.
- `amount` must be a positive safe integer and requires `assetId`.
- Omitting both creates an any-asset, any-amount invoice.
- `durationSeconds` must be a positive integer. The wallet's default is 24
  hours when it is omitted.
- `minConfirmations` must be a nonnegative integer. UniSat raises it to a
  minimum of three and returns the effective value.

Use `blindReceive` when an available RGB funding UTXO can be reserved. Use
`witnessReceive` when the sender transaction should create the receiver output.
Both calls persist receiver state before returning the invoice and open the
wallet's receive approval screen.

## Assets

### `listAssets()`

Returns a plain array, loading up to 50 items per internal page:

```ts
const assets = await rgb.listAssets()
// [{ assetId, id, asset_id, ticker, name, precision, balance, ... }]
```

`assetId`, `id`, and `asset_id` refer to the same contract. Additional fields
are wallet metadata and may evolve; use the named identifiers and `precision`
rather than depending on the raw object shape.

### `getAssetBalance(assetId)`

```ts
const result = await rgb.getAssetBalance('rgb:...')
// { assetId, balance: 1000, raw: { ... } }
```

`balance` is a safe integer in atomic units. A balance outside the WebRGB
number range is rejected instead of being returned lossily. `raw` is the
wallet's underlying asset record and is not a portable WebRGB contract.

## Invoice decoding

### `decodeRgbInvoice(invoice)`

Both forms are accepted:

```ts
await rgb.decodeRgbInvoice(invoice)
await rgb.decodeRgbInvoice({ invoice })
```

The result is:

```ts
{
  assetId?: string
  amount: number | null
  recipientId: string
  expirationTimestamp?: number
  network?: string
  transportEndpoints: string[]
}
```

`amount: null` means an any-amount invoice, including an invoice encoding a
fungible assignment of zero. Decoding is local and read-only; it does not
reserve assets, contact a proxy, or show an approval.

## Send

### `sendAsset(args)`

The invoice form is preferred:

```ts
const result = await rgb.sendAsset({
  invoice,
  // Required when the invoice does not fix these values:
  amount: 1000,
  assetId: 'rgb:...',
  feeRate: 5,
})
```

The explicit recipient form is also supported:

```ts
const result = await rgb.sendAsset({
  assetId: 'rgb:...',
  amount: 1000,
  recipientId: 'bc:utxob:...',
  feeRate: 5,
  // transportEndpoints: ['rpcs://proxy.example'],
})
```

For the invoice form:

- an any-amount invoice requires `amount`;
- an any-asset invoice requires `assetId`, unless the wallet holds exactly one
  asset and UniSat can select it unambiguously;
- supplied values must match values fixed by the invoice.

For the explicit form, UniSat builds and validates an invoice using the
supplied recipient and either the supplied proxy endpoints or the current
chain defaults.

The call uses the native two-stage payment flow internally, so the user sees
the normal payment review followed by signing approval. Consent for any
untrusted direct RGB proxy endpoint is merged into the payment review. If the
user rejects signing, UniSat releases the unsigned prepared reservation. A
counterparty rejection or transport failure is not treated as user rejection;
track that transfer instead of blindly creating another one.

The result includes normalized tracking fields:

```ts
{
  transferId: string | number
  txid?: string
  assetId: string
  amount: number
  recipientId?: string
  status: 'WaitingCounterparty' | 'WaitingConfirmations' | 'Settled' | 'Failed'
  // plus wallet-specific result fields
}
```

Persist `transferId`. A send can return before settlement when it is waiting
for the receiver ACK or Bitcoin confirmations.

## Transfers

### `listTransfers(assetId?)`

```ts
const all = await rgb.listTransfers()
const oneAsset = await rgb.listTransfers('rgb:...')
```

Returns a plain array. Transfer amounts are converted to safe integers; an
unsafe persisted value rejects rather than being rounded. UniSat normalizes
wallet states as follows:

| Wallet state                                         | WebRGB state           |
| ---------------------------------------------------- | ---------------------- |
| `settled`, `confirmed`                               | `Settled`              |
| `failed`, `rejected`, `canceled`, `broadcast_failed` | `Failed`               |
| `confirming`, `broadcasted`, `waiting_receive`       | `WaitingConfirmations` |
| Other pending states                                 | `WaitingCounterparty`  |

### `getTransferStatus(transferId, assetId?)`

```ts
const status = await rgb.getTransferStatus(transferId, assetId)
```

The identifier is matched against the wallet transfer ID, recipient ID, txid,
or record ID. An unknown identifier resolves rather than rejects:

```ts
{ found: false, status: null, transfer: null }
```

## Events

```ts
const listener = transfer => console.log(transfer)

rgb.on('transferReceived', listener)
rgb.on('transferSettled', listener)

rgb.off('transferReceived', listener)
rgb.off('transferSettled', listener)
```

Supported events are:

| Event              | Fires when                                                       |
| ------------------ | ---------------------------------------------------------------- |
| `transferReceived` | A new incoming transfer appears after the subscription baseline. |
| `transferSettled`  | A known transfer changes to `Settled`.                           |

UniSat polls every 15 seconds only while at least one listener is registered.
The first poll establishes a baseline and does not replay historical receives.
Events are convenience notifications; persist transfer IDs and use
`getTransferStatus` for authoritative recovery after reload.

## Errors

Every WebRGB rejection is an `Error` with a string `code`:

| Code                   | Meaning                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `USER_REJECTED`        | The user rejected connection or an action approval.                              |
| `NOT_ENABLED`          | `enable()` has not completed, site permission was removed, or RGB is disabled.   |
| `METHOD_NOT_SUPPORTED` | The method is not in `getInfo().methods`.                                        |
| `INVALID_PARAMS`       | An argument is missing, malformed, mismatched, or outside the safe-number range. |
| `ASSET_NOT_FOUND`      | The wallet does not know the requested asset.                                    |
| `INTERNAL_ERROR`       | Any other wallet, transport, or protocol failure.                                |

```ts
try {
  await rgb.sendAsset({ invoice, amount: 1000 })
} catch (error) {
  switch ((error as { code?: string }).code) {
    case 'USER_REJECTED':
      break
    case 'NOT_ENABLED':
      await rgb.enable()
      break
    default:
      console.error((error as Error).message)
  }
}
```

Do not depend on `instanceof`, a stack trace, `data.originalError`, or native
numeric wallet codes. The provider maps errors crossing the extension boundary
to this WebRGB code set and exposes only the safe message needed by the page.

## Upstream specification

UniSat follows the draft [WebRGB v1 specification](https://github.com/UTEXO-Protocol/webrgb/blob/dev/SPEC.md)
and its [type declarations](https://github.com/UTEXO-Protocol/webrgb/blob/dev/index.d.ts),
subject to the capability list returned by `getInfo()`. When a method is not
advertised, the runtime capability list takes precedence over the broader
upstream interface.
