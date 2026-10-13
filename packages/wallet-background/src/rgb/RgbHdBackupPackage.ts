const MAGIC = 'unisat-rgb-hd-backup'
const VERSION = 1
const MAX_PACKAGE_BYTES = 256_000_000

type RgbHdBackupContents = {
  magic: typeof MAGIC
  formatVersion: typeof VERSION
  createdAt: number
  network: string
  accounts: Array<{ index: number; payload: string }>
}

type RgbHdBackupPackage = RgbHdBackupContents & { authentication: string }

function contents(backup: RgbHdBackupContents): RgbHdBackupContents {
  return {
    magic: MAGIC,
    formatVersion: VERSION,
    createdAt: backup.createdAt,
    network: backup.network,
    accounts: backup.accounts,
  }
}

function validate(backup: Partial<RgbHdBackupPackage>): backup is RgbHdBackupPackage {
  return (
    backup.magic === MAGIC &&
    backup.formatVersion === VERSION &&
    Number.isSafeInteger(backup.createdAt) &&
    (backup.createdAt ?? -1) >= 0 &&
    typeof backup.network === 'string' &&
    !!backup.network &&
    Array.isArray(backup.accounts) &&
    backup.accounts.length > 0 &&
    backup.accounts.length <= 1000 &&
    backup.accounts.every(
      item =>
        item &&
        Number.isSafeInteger(item.index) &&
        item.index >= 0 &&
        typeof item.payload === 'string' &&
        item.payload.length > 0
    ) &&
    new Set(backup.accounts.map(item => item.index)).size === backup.accounts.length &&
    typeof backup.authentication === 'string' &&
    /^[0-9a-f]{64}$/.test(backup.authentication)
  )
}

async function authenticationKey(keyHex: string) {
  const bytes = Uint8Array.from(Buffer.from(keyHex, 'hex'))
  if (bytes.length !== 32) throw new Error('RGB HD backup key is invalid')
  return globalThis.crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export function isRgbHdBackupPackage(payload: string): boolean {
  if (typeof payload !== 'string' || payload.length > MAX_PACKAGE_BYTES) {
    throw new Error('RGB backup package is invalid')
  }
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    throw new Error('RGB backup package is invalid')
  }
  if (!value || typeof value !== 'object') throw new Error('RGB backup package is invalid')
  return (value as Partial<RgbHdBackupPackage>).magic === MAGIC
}

export async function createRgbHdBackupPackage(
  network: string,
  accounts: RgbHdBackupContents['accounts'],
  keyHex: string,
  createdAt = Date.now()
): Promise<string> {
  const manifest = contents({ magic: MAGIC, formatVersion: VERSION, createdAt, network, accounts })
  const placeholder: RgbHdBackupPackage = { ...manifest, authentication: '0'.repeat(64) }
  if (!validate(placeholder)) throw new Error('RGB HD backup accounts are invalid')
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    await authenticationKey(keyHex),
    new TextEncoder().encode(JSON.stringify(manifest))
  )
  const payload = JSON.stringify({
    ...manifest,
    authentication: Buffer.from(signature).toString('hex'),
  })
  if (payload.length > MAX_PACKAGE_BYTES) throw new Error('RGB HD backup is too large')
  return payload
}

export async function readRgbHdBackupPackage(
  payload: string,
  keyHex: string
): Promise<RgbHdBackupContents> {
  if (!isRgbHdBackupPackage(payload)) throw new Error('This is a single-account RGB backup')
  const backup = JSON.parse(payload) as Partial<RgbHdBackupPackage>
  if (!validate(backup)) throw new Error('RGB HD backup package is invalid')
  const valid = await globalThis.crypto.subtle.verify(
    'HMAC',
    await authenticationKey(keyHex),
    Buffer.from(backup.authentication, 'hex'),
    new TextEncoder().encode(JSON.stringify(contents(backup)))
  )
  if (!valid) throw new Error('RGB HD backup does not belong to this HD wallet or was changed')
  return contents(backup)
}
