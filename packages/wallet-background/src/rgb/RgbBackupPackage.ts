const RGB_BACKUP_MAGIC = 'unisat-rgb-backup'
const RGB_BACKUP_VERSION = 1
const RGB_BACKUP_MAX_PLAINTEXT_BYTES = 32_000_000
const RGB_BACKUP_MAX_PACKAGE_BYTES = 48_000_000

type BackupEnvelope = {
  magic: typeof RGB_BACKUP_MAGIC
  formatVersion: typeof RGB_BACKUP_VERSION
  encryption: { algorithm: 'AES-256-GCM'; purpose: 'rgb-export-v1' }
  iv: string
  ciphertext: string
}

export type RgbBackupContents = {
  formatVersion: 1
  createdAt: number
  state: unknown
}

function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(value: string) {
  return Uint8Array.from(Buffer.from(value, 'base64'))
}

async function backupKey(keyHex: string) {
  const bytes = Uint8Array.from(Buffer.from(keyHex, 'hex'))
  if (bytes.length !== 32) throw new Error('RGB backup key is invalid')
  return globalThis.crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** Create an offline, seed-bound encrypted RGB recovery package. */
export async function createRgbBackupPackage(state: unknown, keyHex: string, createdAt = Date.now()) {
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ formatVersion: RGB_BACKUP_VERSION, createdAt, state } satisfies RgbBackupContents)
  )
  if (plaintext.byteLength > RGB_BACKUP_MAX_PLAINTEXT_BYTES) {
    throw new Error('RGB backup state is too large to export safely')
  }
  const iv = new Uint8Array(12)
  globalThis.crypto.getRandomValues(iv)
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await backupKey(keyHex),
    plaintext
  )
  const envelope: BackupEnvelope = {
    magic: RGB_BACKUP_MAGIC,
    formatVersion: RGB_BACKUP_VERSION,
    encryption: { algorithm: 'AES-256-GCM', purpose: 'rgb-export-v1' },
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
  return JSON.stringify(envelope)
}

/** Authenticate and decrypt an offline RGB recovery package. */
export async function readRgbBackupPackage(payload: string, keyHex: string): Promise<RgbBackupContents> {
  if (typeof payload !== 'string' || payload.length > RGB_BACKUP_MAX_PACKAGE_BYTES) {
    throw new Error('RGB backup package is invalid')
  }
  let envelope: BackupEnvelope
  try {
    envelope = JSON.parse(payload) as BackupEnvelope
  } catch {
    throw new Error('RGB backup package is invalid')
  }
  if (
    envelope?.magic !== RGB_BACKUP_MAGIC ||
    envelope.formatVersion !== RGB_BACKUP_VERSION ||
    envelope.encryption?.algorithm !== 'AES-256-GCM' ||
    envelope.encryption?.purpose !== 'rgb-export-v1' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    throw new Error('RGB backup package is invalid')
  }
  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
      await backupKey(keyHex),
      base64ToBytes(envelope.ciphertext)
    )
    const contents = JSON.parse(new TextDecoder().decode(plaintext)) as RgbBackupContents
    if (
      contents?.formatVersion !== RGB_BACKUP_VERSION ||
      !Number.isSafeInteger(contents.createdAt) ||
      contents.createdAt < 0 ||
      !contents.state
    ) {
      throw new Error('RGB backup package is invalid')
    }
    return contents
  } catch (error) {
    if (error instanceof Error && error.message === 'RGB backup package is invalid') throw error
    throw new Error('RGB backup package cannot be decrypted by this wallet')
  }
}
