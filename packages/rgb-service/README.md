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

## BFA local codec

`protocol/local-bfa-encoder.ts` builds the BFA transfer PSBT, Transition,
Opret commitment and signed v1 WitnessBundle in the extension. The existing
blind and witness invoice encoders also run in the extension and are independent
of the asset schema. `protocol/bfa-consignment.ts` wraps the new bundle with
the validated BFA Genesis and ancestor bundles in the v1 transfer format.

The send codec requires `ValidatedBfaTransferHistory`: a BFA Genesis, exact
ancestor v1 WitnessBundles and proved `OS_ASSET` allocations. The local
`validateBfaTransferConsignment` implementation checks the supported v1
mint/transfer profile, operation IDs, Bitcoin witness commitments and parent
seals, and finalized EVM `FundsIn` events. It requires a Bitcoin confirmation
resolver and an EVM JSON-RPC transport. The wallet background selects the RPC
from `rgbEvmRpcUrls` in `wallet-shared/src/constants/common.ts` by the chain ID
committed in Genesis. The T0 map is intentionally empty until a bridge RPC is
configured. Unsupported contract features fail closed. The wallet routes BFA
send and receive through this validator and local encoder; received and sent
histories are merged into the encrypted local checkpoint. If Bitcoin or EVM
chain data is temporarily unavailable, a BFA receive remains pending instead
of being rejected.

The BFA burn path consumes validated asset allocations and commits a `TS_BURN`
transition to a locally signed Bitcoin transaction. It has no invoice,
recipient, proxy post, or acknowledgement. The signed transfer consignment is
retained in the encrypted wallet state and exported inside an `utexo-burn`
JSON artifact. Broadcast failures require an
explicit retry; ordinary synchronization never rebroadcasts a burn. Burning
does not submit a redemption request to an EVM bridge.

The current BFA schema defines Burn as a terminal transition without output
assignments, so it cannot carry RGB change. When the requested amount is not
already represented by an exact set of spendable allocations, the wallet
first prepares an ordinary wallet-owned Transfer that creates the exact burn
allocation plus change. After that transaction is signed and broadcast, the
wallet prepares the terminal Burn against its mempool output. This may require
two confirmations in the signer and pays Bitcoin fees for two transactions;
the internal split never uses Proxy or sends an ACK.

Assets using the 1.8.2 BFA schema retain that schema's change-capable Burn
rules and the 1.8.2 consignment container, including its empty terminals map.
The wallet selects these rules automatically from the immutable SchemaId in
Genesis; users cannot apply legacy rules to a current-schema asset or vice versa.

Both schema generations construct the V1 destination record and commit its
EIP-712-style hash as `burnReason`. The record contains `version`,
`destinationChainId`, `dstEid`, and chain-native `recipient` bytes. The
exported JSON bundles the base64 `RGB\0TFR` consignment and the gateway's
`BfaBurnDestination` fields, including a `0x`-prefixed hex `recipient`. The
destination record belongs in the `burnDestination` field of `/unlock/verify`
and `/unlock` requests. The wallet retains the record in its encrypted state
and verifies its hash on export. The destination cannot be changed after
signing. A V1 hash alone is insufficient to redeem a burn.

The staging gateway OpenAPI documents `burnDestination` for both
`/unlock/verify` and `/unlock`. The older public integration guide still shows
only the legacy request body. Before using a V1 burn with real funds, confirm
that the chosen route and token are enabled in the target deployment. This
wallet does not submit the unlock request.

## Enablement requirement

The address-scoped UTXO snapshot supplies only the parent operation pointer
needed to consume an allocation. It is not enough to create a standards-valid
recipient consignment: that requires the asset Genesis and every parent
transfer/bundle on the allocation's validation path. Those opaque RGB payloads
may be fetched from a transport or restored from encrypted local storage, but
they must never be reconstructed by a backend wallet service.

The BFA path requires complete validated ancestry before a send. It does not
attempt to reconstruct missing transitions from an address-scoped balance.

## Synthetic round-trip stress test

An RGB transfer embeds its ancestor witness bundles in the next Consignment.
Consequently, repeatedly moving one asset A -> B -> A makes the newest
Consignment grow approximately linearly with the transfer count, while the
total encoding and validation work across the run is approximately quadratic.

Run the local history stress test without a proxy, broadcaster, real key, or
testnet fee:

```sh
RGB_STRESS_ROUNDS=100 pnpm --filter @unisat/rgb-service test:roundtrip-stress
RGB_STRESS_ROUNDS=1000 RGB_STRESS_LOG_EVERY=100 pnpm --filter @unisat/rgb-service test:roundtrip-stress
```

The test uses blind invoices pointed at alternating, synthetic Taproot funding
UTXOs. It validates the complete Consignment history each round and prints JSON
metrics for Consignment bytes, history bundle count, per-step latency, and
total serialized bytes. It is a local protocol/load test only: it does not
test two real keyrings, proxy ACKs, Bitcoin confirmation, or backend indexing.

## Validation attestations

A wallet API may run the same v1 validator and sign a short-lived attestation
bound to the exact payload hash, network, Genesis and bundle DAG. The wallet
accepts it only from a release-pinned Ed25519 key, reparses the payload with
its private blind seals, and checks every attested bundle identity and edge.
Invalid, expired and dynamic-reject-list attestations fall back to complete
local validation; blind-seal ownership and invoice matching never move to the
server.

Legacy NIA v0 transfers are accepted through a constrained compatibility
boundary: the service parses and converts them to the canonical v1 envelope,
then uses the same v1 validator and allocation matching path as a native v1
transfer. Accepted history is stored as v1 while the original v0 payload is
retained only as recovery compatibility data. The legacy parser is not an
independent acceptance authority.
