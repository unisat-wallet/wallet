# @unisat/descriptor-service

BIP-380 singlesig output descriptors for UniSat Wallet.

## v1

- BIP-380 checksum (BigInt polymod) + parse / script-type policy label
- `hdAccountToDescriptor` / `hdAccountToDescriptorPair` for `P2WPKH` / `P2TR` / `P2SH_P2WPKH` / `P2PKH`
- `deriveAddresses` for ranged singlesig `wpkh` / `tr` / `sh(wpkh)` / `pkh`
- `normalizeMultipathImport` for Sparrow-style `/<0;1>/*` → receive `/0/*` + change `/1/*`
- Rejects private `xprv`, SLIP-132, hardened-after-xpub, and non-Sparrow multipath

Multisig / Miniscript script trees are out of scope for v1.
