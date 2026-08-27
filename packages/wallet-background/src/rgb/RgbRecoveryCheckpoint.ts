const RECOVERY_ENVELOPE_VERSION = 1
/** Leaves room for AES-GCM, base64 and the 48 MB encrypted upload ceiling. */
export const RGB_RECOVERY_MAX_PLAINTEXT_BYTES = 32_000_000

type RecoveryEnvelope = {
  version: number
  iv: string
  ciphertext: string
}

function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(value: string) {
  return Uint8Array.from(Buffer.from(value, 'base64'))
}

async function recoveryKey(keyHex: string) {
  const bytes = Uint8Array.from(Buffer.from(keyHex, 'hex'))
  if (bytes.length !== 32) throw new Error('RGB recovery key is invalid')
  return globalThis.crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** Encrypt local RGB recovery state with a deterministic wallet-derived key. */
export async function encryptRgbRecoveryCheckpoint(state: unknown, keyHex: string) {
  const iv = new Uint8Array(12)
  globalThis.crypto.getRandomValues(iv)
  const serialized = JSON.stringify(state)
  const plaintext = new TextEncoder().encode(serialized)
  if (plaintext.byteLength > RGB_RECOVERY_MAX_PLAINTEXT_BYTES) {
    throw new Error('RGB recovery state is too large to back up safely')
  }
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await recoveryKey(keyHex),
    plaintext
  )
  const envelope: RecoveryEnvelope = {
    version: RECOVERY_ENVELOPE_VERSION,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
  return JSON.stringify(envelope)
}

/** Reject malformed or unauthenticated recovery ciphertext before restoring it locally. */
export async function decryptRgbRecoveryCheckpoint(payload: string, keyHex: string): Promise<unknown> {
  const envelope = JSON.parse(payload) as RecoveryEnvelope
  if (
    envelope?.version !== RECOVERY_ENVELOPE_VERSION ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    throw new Error('RGB recovery checkpoint is invalid')
  }
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
    await recoveryKey(keyHex),
    base64ToBytes(envelope.ciphertext)
  )
  return JSON.parse(new TextDecoder().decode(plaintext))
}
