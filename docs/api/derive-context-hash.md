# Derive Context Hash

### deriveContextHash

```
unisat.deriveContextHash(appName, context)
```

Derive a deterministic 32-byte value from the wallet's key material, an application name, and an arbitrary context string. The derivation uses HKDF-SHA-256 (RFC 5869).

**Requires user approval** — the wallet will show a confirmation dialog displaying the application name, context string, and requesting origin before deriving the value.

**Supported keyring types**: HD wallets (mnemonic), HD wallets (xpriv), and imported private keys.

**Parameters**

- `appName` - `string`: Application identifier (1–64 bytes, lowercase letters, digits, and hyphens only: `[a-z0-9\-]`). Provides mandatory app-level domain separation. Examples: `"babylon-vault"`, `"ordinals-market"`.
- `context` - `string`: Hex-encoded byte string (even-length, lowercase, no `0x` prefix, max 2048 hex characters / 1024 bytes). Application-specific data that determines the output within the app's namespace. Must not be empty.

**Returns**

- `Promise` - `string`: Hex-encoded 32-byte derived value (64 lowercase hex characters).

**Derivation Scheme**

```
ikm    = BIP-32 private key at m/73681862' (32 bytes)
salt   = "derive-context-hash"
info   = SHA-256(UTF8(appName)) || decode_hex(context)
output = HKDF-SHA-256(ikm, salt, info, 32)
```

Where `ikm` is:
- For mnemonic/xpriv wallets: the 32-byte private key scalar at BIP-32 path `m/73681862'` (hardened), derived from the wallet's HD root.
- For imported key wallets: the raw 32-byte private key directly (no BIP-32 derivation, since imported keys lack a BIP-32 hierarchy).

The `info` field is constructed by concatenating SHA-256(UTF8(appName)) (32 bytes, fixed-length) with the raw context bytes decoded from hex. Hashing appName ensures a fixed 32-byte prefix, eliminating length-confusion collisions.

---

**Example**

```javascript
try {
  const appName = "babylon-vault";
  const context = "a1b2c3d4e5f6..."; // hex-encoded context
  const hash = await window.unisat.deriveContextHash(appName, context);
  console.log(hash);
  // => "3b0e2d90a01122eed8a520648073892f6b2d8f4419216023d63cdbd49500fca3"
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
