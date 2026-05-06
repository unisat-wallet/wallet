# Derive Context Hash

> [!WARNING]
> **Experimental API**: `deriveContextHash` is experimental and may change in future versions.
> Use feature detection and provide a fallback path in production integrations.

### deriveContextHash

```
unisat.deriveContextHash(appName, context)
```

Derive a deterministic 32-byte value from the connected account's key material, an application name, and an arbitrary context string. The derivation uses HKDF-SHA-256 (RFC 5869).

**Requires user approval** — the wallet will show a confirmation dialog displaying the application name, context string, and requesting origin before deriving the value.

**Supported keyring types**: HD wallets (mnemonic), HD wallets (xpriv), and imported private keys.

**Parameters**

- `appName` - `string`: Application identifier (1–64 bytes, lowercase letters, digits, and hyphens only: `[a-z0-9\-]`). Provides mandatory app-level domain separation. Examples: `"babylon-vault"`, `"ordinals-market"`.
- `context` - `string`: Hex-encoded byte string (even-length, lowercase, no `0x` prefix, max 2048 hex characters / 1024 bytes). Application-specific data that determines the output within the app's namespace. Must not be empty.

**Returns**

- `Promise` - `string`: Hex-encoded 32-byte derived value (64 lowercase hex characters).

**Derivation Scheme**

```
ikm    = the connected account's 32-byte private key
salt   = "derive-context-hash"
info   = SHA-256(UTF8(appName)) || decode_hex(context)
output = HKDF-SHA-256(ikm, salt, info, 32)
```

Where `ikm` is the connected account's private key:
- For mnemonic wallets: the BIP-32 private key at the **account-level node** `m/purpose'/coin_type'/account'` (3-deep, hardened) — e.g. `m/44'/0'/0'` for default BIP-44 account 0; `m/86'/0'/0'` for Taproot account 0. All receive addresses under the same account share the same IKM.
- For imported xpriv wallets: the imported xpriv's own private key (the imported xpriv represents the user's account identity).
- For imported raw private key wallets: the raw 32-byte private key.

The `info` field is constructed by concatenating SHA-256(UTF8(appName)) (32 bytes, fixed-length) with the raw context bytes decoded from hex. Hashing appName ensures a fixed 32-byte prefix, eliminating length-confusion collisions.

**Output semantics — per-account-xpub**

Output is bound to the connected account's xpub. Within one wallet:
- Different receive addresses under the same account → **same** output.
- Different account index, address type (BIP-44 vs BIP-86, etc.), or imported xpriv → **different** output.
- BIP-39 passphrase change → different seed → different output.

dApps that need per-address (rather than per-account) differentiation should encode the address into `context` themselves.

---

**Example**

```javascript
try {
  const appName = "babylon-vault";
  const context = "a1b2c3d4e5f6..."; // hex-encoded context
  const hash = await window.unisat.deriveContextHash(appName, context);
  console.log(hash);
  // 64 lowercase hex chars (depends on the connected account's key material)
} catch (e) {
  console.log(e);
}
```

---

**Security**

- HKDF is a formally proven extract-then-expand KDF (Krawczyk, Crypto 2010; RFC 5869).
- The Extract step ensures even structured inputs (e.g., secp256k1 keys) produce a uniformly random pseudorandom key.
- The Expand step is a PRF — revealing many outputs for different contexts does not leak the seed or private key.
- The fixed salt `"derive-context-hash"` provides domain separation from BIP-32 and other HMAC uses.
- SHA-256(appName) prefix in the info field provides mandatory app-level domain separation.
- All intermediate key material is zeroed after use within the wallet.

**Use Cases**

- **HTLC preimages**: Derive a deterministic secret `s` for atomic swap flows. Commit `SHA256(s)` on-chain, reveal `s` later.
- **Deterministic key generation**: Use the output as seed material for application-specific cryptographic schemes (e.g., Lamport signatures).
