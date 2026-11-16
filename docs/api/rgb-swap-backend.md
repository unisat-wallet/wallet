# RGB Swap: Backend-Coordinated Mode

Use this mode only when the application backend is the RGB counterparty and
retains the final Bitcoin transaction. Do not combine this flow with the pure
P2P flow in [`rgb-swap-p2p.md`](./rgb-swap-p2p.md).

## Wallet version

The RGB-to-BTC seller flow requires **UniSat Wallet v1.8.4 or later** because
`syncSellSwapAck` was introduced in v1.8.4. The shared seller APIs
`prepareSwap` and `signSellSwapAndPublishConsignment` are available from
v1.8.0. The backend-controlled BTC-to-RGB buyer flow uses the split buyer APIs
available from v1.8.3 and does not require `syncSellSwapAck`.

Feature-detect the required method before starting a swap:

```ts
if (typeof window.unisat?.rgb?.syncSellSwapAck !== 'function') {
  throw new Error('Backend-coordinated RGB swaps require UniSat Wallet v1.8.4+')
}
```

## Sell RGB for BTC

In this direction the UniSat user is the RGB seller. The backend controls the
receive invoice, validates the consignment, posts the Proxy ACK, and broadcasts
the final transaction.

```text
prepareSwap
  -> signSellSwapAndPublishConsignment
  -> backend completes and durably stores the final transaction
  -> backend validates the consignment and posts ACK
  -> syncSellSwapAck until receiver_acked
  -> backend broadcasts
  -> getOperationStatus until broadcasted
```

```ts
// v1.8.0+
const prepared = await unisat.rgb.prepareSwap({
  invoice: backendReceiveInvoice,
  assetId,
  amount,
  btcReceiveAmount,
  feeRate,
  psbt: unsignedSwapPsbt,
})

// v1.8.0+
const published = await unisat.rgb.signSellSwapAndPublishConsignment(
  prepared.transferId,
  prepared.coloredPsbt,
)

// v1.8.4+
const ack = await unisat.rgb.syncSellSwapAck(published.transferId)
// waiting_ack | receiver_acked | rejected | expired
```

`syncSellSwapAck` accepts only the wallet-local `transferId`. The wallet queries
the Proxy and verifies the receiver signature, recipient, consignment hash and
local transaction anchor. It never imports, returns or broadcasts the final
transaction.

The backend must not post ACK until the exact final transaction has been
validated and durably stored. It must not broadcast until the wallet reports
`receiver_acked`.

## Buy RGB with BTC

In this direction the backend is the RGB sender. It owns the Proxy sender key,
creates the transaction and retains the final transaction.

```text
createReceiveInvoice({ purpose: 'buy_swap' })
  -> backend publishes consignment
  -> getPendingReceives reports PendingAccept
  -> signBuySwap
  -> backend validates buyer signatures and completes the transaction
  -> backend signs rgb-buy-swap/commit/v1 with its Proxy sender key
  -> acceptBuySwap
  -> backend observes ACK and broadcasts
```

```ts
// v1.8.3+
const receive = await unisat.rgb.createReceiveInvoice({
  assetId,
  amount,
  purpose: 'buy_swap',
})

// v1.8.3+
const signed = await unisat.rgb.signBuySwap({
  recipientId: receive.recipientId,
  assetId,
  amount,
  maxBtcSpend,
  swapPsbt,
})

const message =
  `rgb-buy-swap/commit/v1:${proxyTransferId}:${signed.txid}:` +
  sha256BinaryPsbt(signed.buyerSignedPsbt)
const backendCommit = signProxyV1Message(proxySenderPrivateKey, message)

// v1.8.3+
await unisat.rgb.acceptBuySwap({
  recipientId: receive.recipientId,
  backendCommit,
})
```

The PSBT supplied to `signBuySwap` must not contain maker signatures. The
wallet signs only its own BTC inputs and never ACKs until the commitment from
the exact Proxy sender key verifies.

## Cancellation and recovery

- Before a positive ACK, use `cancelSwap` or reject the pending receive.
- After a positive ACK, unilateral cancellation is disabled.
- If the final transaction is permanently unbroadcastable, the application
  must obtain the bilateral abort agreement before requesting
  `applySellSwapAbort` and `applyBuySwapAbort`.

