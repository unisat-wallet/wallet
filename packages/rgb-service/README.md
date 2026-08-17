# RGB Service

`@unisat/rgb-service` is the local RGB wallet orchestration boundary. It does
not depend on `rgb-sdk`, does not persist a mnemonic or xpub, and does not ask a
backend to build a PSBT.

The host supplies five adapters:

- `RgbStateSource`: address-scoped colored UTXO snapshots and post-broadcast indexing.
- `RgbProtocolEncoder`: local invoice, transition, commitment, PSBT and consignment logic.
- `RgbStorage`: encrypted extension or platform storage for local state and UTXO locks.
- `RgbTransport`: consignment delivery only.
- `BitcoinBroadcaster`: raw transaction broadcast only.

The intended flow is:

```text
sync colored UTXOs -> prepare local RGB PSBT -> HD keyring signs
-> publish consignment -> recipient validates and ACKs -> broadcast raw transaction
-> sync txid/outpoints
```

## RGB proxy transport

The extension uses the RGB HTTP JSON-RPC proxy protocol for consignment
transport. Configure public endpoints with `rgbProxyEndpoints` in the current
chain entry of `@unisat/wallet-shared` so they are embedded in locally created
blind invoices. `rpcs://` is sent over HTTPS; `rpc://` is supported only for
local development.
After signing, the wallet posts the consignment, waits for `ack.get` to return
`true`, and only then broadcasts the Bitcoin transaction. The signed transfer
remains in encrypted local storage while the acknowledgement is pending and is
retried by the next RGB sync.

`protocol/nia.ts` implements the NIA fungible Transition, OpCommitment and
OpId layers. `protocol/nia-genesis.ts` implements the no-media NIA Genesis
used by the issue flow, including its contract ID. Both are checked against
deterministic `rgb-lib` vectors. A fallback that creates an ordinary BTC
transaction is unsafe and must not be added.

Before encoding, the service produces a local fungible transition plan. It
conserves the requested allocation and records every other allocation on an
input UTXO that needs a preservation transition. This prevents an encoder from
silently losing co-located RGB assets.

`protocol/strict.ts` implements the strict-encoding primitive writer. In
particular, confined collection lengths use a fixed little-endian width selected
from their declared maximum bound.

`protocol/anchor.ts` applies the RGB OpretFirst placement rule before a
commitment is written. `protocol/mpc.ts` produces the LNPBP-4 MPC commitment
that is embedded in that output. `protocol/fascia.ts` serializes the OpretFirst
Fascia once the local PSBT builder has produced the witness transaction.
`protocol/psbt-commit.ts` writes the MPC, OPRET and RGB proprietary records
and updates the unsigned transaction before signing.

`protocol/psbt.ts` encodes the BIP174 proprietary key/value records used by
the RGB reference implementation for OPRET hosts, OPRET commitments and RGB
transitions. It accepts strict-serialized transition bytes from the caller;
schema-specific transition serialization remains a separate step.

## Enablement requirement

The address-scoped UTXO snapshot supplies only the parent operation pointer
needed to consume an allocation. It is not enough to create a standards-valid
recipient consignment: that requires the asset Genesis and every parent
transfer/bundle on the allocation's validation path. Those opaque RGB payloads
may be fetched from a transport or restored from encrypted local storage, but
they must never be reconstructed by a backend wallet service.

Until that local history source and the strict Consignment encoder are wired,
the background safety gate must remain enabled. The local modules can build
and verify the committed PSBT, but they must not publish or broadcast it as an
RGB transfer.
