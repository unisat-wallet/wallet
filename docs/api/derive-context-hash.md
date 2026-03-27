# Derive Context Hash

### deriveContextHash

```
unisat.deriveContextHash(context)
```

Derive a deterministic 32-byte value from the wallet's key material and an arbitrary context string. The derivation uses HKDF-SHA-256 (RFC 5869), a formally proven key derivation function.

**Requires user approval** — the wallet will show a confirmation dialog displaying the context string before deriving the value.

**Supported keyring types**: HD wallets (mnemonic), HD wallets (xpriv), and imported private keys.

**Parameters**

- `context` - `string`: A hex-encoded context string (even-length, e.g. `"deadbeef0123"`). The context acts as a domain separator — different contexts produce different, independent outputs.

**Returns**

- `Promise` - `string`: Hex-encoded 32-byte derived value (64 hex characters).

**Derivation Scheme**

```
HKDF-SHA-256(ikm=keyMaterial, salt="derive-context-hash", info=context, length=32)
```

Where `keyMaterial` is:
- The 64-byte BIP-39 seed (for mnemonic-based wallets), or
- The 32-byte private key (for imported key or xpriv wallets).

---

**Example**

```javascript
try {
  // Context is a hex-encoded string (e.g., vault_id + public_key)
  const context = "a1b2c3d4e5f6...";
  const hash = await window.unisat.deriveContextHash(context);
  console.log(hash);
  // => "fb9046c540159d2a3f2ff36c79da7079b9f65b9e231dcc47eaf780e57122359b"
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
- All intermediate key material is zeroed after use within the wallet.
- Used by TLS 1.3, Signal Protocol, and Ethereum EIP-2333 for similar key derivation purposes.

**Use Cases**

- **HTLC preimages**: Derive a deterministic secret `s` for atomic swap flows. Commit `SHA256(s)` on-chain, reveal `s` later.
- **Deterministic key generation**: Use the output as seed material for application-specific cryptographic schemes (e.g., Lamport signatures).
