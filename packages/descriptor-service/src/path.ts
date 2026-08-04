/** Normalize BIP-32 path to descriptor form: `86h/0h/0h` (no leading m/). */
export function toDescriptorPath(path: string): string {
  let p = path.trim()
  if (p.startsWith('m/')) p = p.slice(2)
  else if (p.startsWith('m')) p = p.slice(1).replace(/^\//, '')
  return p.replace(/'/g, 'h')
}

/** Convert descriptor path `86h/0h/0h` to bip32 `m/86'/0'/0'`. */
export function toBip32Path(path: string): string {
  const body = toDescriptorPath(path).replace(/h/g, "'")
  return body.startsWith('m/') ? body : `m/${body}`
}

export function normalizeFingerprint(fingerprint: string): string {
  const hex = fingerprint.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{8}$/.test(hex)) {
    throw new Error(`Invalid master fingerprint: ${fingerprint}`)
  }
  return hex
}
