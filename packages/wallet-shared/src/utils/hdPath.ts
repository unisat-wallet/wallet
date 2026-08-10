/**
 * Compute the full BIP32 derivation path for a given account index.
 *
 * Standard mode (UniSat / most wallets):
 *   hdPath = "m/84'/0'/0'/0", accountIndex = 2  →  "m/84'/0'/0'/0/2"
 *
 * Account-index mode (MagicEden):
 *   hdPath = "m/84'/0'/0'/0", accountIndex = 2  →  "m/84'/0'/2'/0/0"
 *   The account segment (index 3) is incremented; address index is fixed at 0.
 */
export function getAccountDerivationPath(
  hdPath: string,
  accountIndex: number,
  accountIndexDerivation = false
): string {
  if (accountIndexDerivation) {
    const segments = hdPath.split('/')
    if (segments.length < 4) {
      throw new Error(`Invalid hdPath for account-index derivation: ${hdPath}`)
    }
    segments[3] = `${accountIndex}'`
    return segments.join('/') + '/0'
  }
  return hdPath + '/' + accountIndex
}

/** Returns whether a path points to a BIP44 account-level xpub. */
export function isKeystoneAccountHdPath(hdPath: unknown): hdPath is string {
  if (typeof hdPath !== 'string') {
    return false
  }

  const segments = hdPath.split('/')
  return (
    segments.length === 4 &&
    segments[0] === 'm' &&
    segments.slice(1).every(segment => /^(?:0|[1-9]\d*)'$/.test(segment))
  )
}

/**
 * Returns whether a path points to the BIP44 change branch of an account.
 * Keystone exports xpubs at the account level, so this identifies paths that
 * need a single non-hardened `/1` derivation before deriving an address index.
 */
export function isChangeAddressHdPath(hdPath: unknown): hdPath is string {
  if (typeof hdPath !== 'string') {
    return false
  }

  const segments = hdPath.split('/')
  return (
    segments.length === 5 &&
    isKeystoneAccountHdPath(segments.slice(0, 4).join('/')) &&
    segments[4] === '1'
  )
}
