# RGB Swap: Pure P2P Mode

Use this mode when both users sign with their own UniSat wallets and the
application backend never holds wallet keys or assets. Do not use
`syncSellSwapAck`; that method belongs to the backend-coordinated mode in
[`rgb-swap-backend.md`](./rgb-swap-backend.md).

## Required order

```text
Buyer: createReceiveInvoice({ purpose: 'buy_swap' })
  -> Seller: prepareSwap
  -> Seller: signSellSwapAndPublishConsignment
  -> Buyer: signBuySwap using the unsigned colored transaction
  -> Seller: signBuySwapCommit
  -> Buyer: acceptBuySwap
  -> Trading page combines the seller and buyer partial PSBTs
  -> Seller: confirmSellSwap with the fully signed PSBT
  -> Trading page finalizes and broadcasts
```

`signBuySwapCommit` must run before `acceptBuySwap` and before
`confirmSellSwap`. Calling it after `confirmSellSwap` would create a circular
dependency because seller confirmation verifies the buyer ACK.

## Seller preparation and publication

```ts
const buyerInvoice = await buyer.rgb.createReceiveInvoice({
  assetId,
  amount,
  purpose: 'buy_swap',
})

const prepared = await seller.rgb.prepareSwap({
  invoice: buyerInvoice.invoice,
  assetId,
  amount,
  btcReceiveAmount,
  feeRate,
  psbt: unsignedSwapPsbt,
})

const sellerPartial = await seller.rgb.signSellSwapAndPublishConsignment(
  prepared.transferId,
  prepared.coloredPsbt,
)
```

The seller wallet creates a unique Proxy sender key for this transfer. The key
is encrypted in wallet state and is never returned to the page.

## Buyer signing

After the buyer invoice becomes `PendingAccept`, the buyer signs the same
unsigned transaction without seller signatures:

```ts
const buyerPartial = await buyer.rgb.signBuySwap({
  recipientId: buyerInvoice.recipientId,
  assetId,
  amount,
  maxBtcSpend,
  swapPsbt: prepared.coloredPsbt,
})
```

Compute SHA-256 over the binary PSBT decoded from
`buyerPartial.buyerSignedPsbt`, not over the UTF-8 hex characters.

## Seller commitment

```ts
const buyerSignedPsbtHash = sha256BinaryPsbt(
  buyerPartial.buyerSignedPsbt,
)

const authorization = await seller.rgb.signBuySwapCommit(
  prepared.transferId,
  buyerPartial.txid,
  buyerSignedPsbtHash,
)

// {
//   transferId,
//   proxyTransferId,
//   txid,
//   buyerSignedPsbtHash,
//   commitment
// }
```

The seller wallet:

- requires the Consignment to have been published;
- checks that `txid` is the locally committed swap transaction;
- derives `proxyTransferId` from the saved invoice and sender key;
- signs only
  `rgb-buy-swap/commit/v1:<proxyTransferId>:<txid>:<buyerSignedPsbtHash>`;
- permanently binds the first buyer PSBT hash for that transfer;
- returns the same result for an identical retry and rejects a different hash.

The seller's Bitcoin keys are not used. The signature uses only this transfer's
ephemeral Proxy sender key.

## Buyer ACK, final combination and broadcast

```ts
await buyer.rgb.acceptBuySwap({
  recipientId: buyerInvoice.recipientId,
  backendCommit: authorization.commitment,
})

const fullySignedPsbt = combinePartialPsbts(
  sellerPartial.makerSignedPsbt,
  buyerPartial.buyerSignedPsbt,
)

const ready = await seller.rgb.confirmSellSwap(
  prepared.transferId,
  fullySignedPsbt,
)
// ready.status === 'ready_for_dapp_finalize'

// The trading page finalizes and broadcasts ready.signedPsbt.
```

`backendCommit` is retained as the existing parameter name for compatibility;
in pure P2P mode its value is the seller-wallet commitment above.

## Cancellation and recovery

- Before ACK, the seller may use `cancelSwap` and the buyer may reject.
- After ACK, unilateral cancellation is disabled.
- If the combined transaction is permanently unbroadcastable, obtain the
  bilateral abort agreement before calling `applySellSwapAbort` and
  `applyBuySwapAbort`.

