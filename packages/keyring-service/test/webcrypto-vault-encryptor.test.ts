import { describe, expect, it } from 'vitest'

import { WebCryptoVaultEncryptor } from '../src'
import { encryptor as extensionEncryptor } from '../../../apps/extension/src/background/utils/encryptor'

function toBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
}

async function createVaultPayload(iterations: number, includeIterations = true): Promise<string> {
  const password = 'test-password'
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify({ secret: 'value' }))
  )

  return JSON.stringify({
    data: toBase64(new Uint8Array(encrypted)),
    iv: toBase64(iv),
    salt: toBase64(salt),
    ...(includeIterations ? { iterations } : {}),
  })
}

describe('WebCryptoVaultEncryptor iteration floor', () => {
  const encryptor = new WebCryptoVaultEncryptor()

  it('rejects a payload encrypted below the legacy iteration floor', async () => {
    const payload = await createVaultPayload(1)

    await expect(encryptor.decrypt('test-password', payload)).rejects.toThrow('Incorrect password')
  })

  it('accepts the legacy iteration floor when explicitly declared', async () => {
    const payload = await createVaultPayload(encryptor.legacyIterations)

    await expect(encryptor.decrypt('test-password', payload)).resolves.toEqual({ secret: 'value' })
  })

  it('keeps the legacy fallback for payloads without iteration metadata', async () => {
    const payload = await createVaultPayload(encryptor.legacyIterations, false)

    await expect(encryptor.decrypt('test-password', payload)).resolves.toEqual({ secret: 'value' })
  })
})

describe('extension vault encryptor iteration floor', () => {
  it('rejects a payload encrypted below the legacy iteration floor', async () => {
    const payload = await createVaultPayload(1)

    await expect(extensionEncryptor.decrypt('test-password', payload)).rejects.toThrow(
      'Incorrect password'
    )
  })

  it('accepts a payload at the 10,000 iteration legacy floor', async () => {
    const payload = await createVaultPayload(10_000)

    await expect(extensionEncryptor.decrypt('test-password', payload)).resolves.toEqual({
      secret: 'value',
    })
  })
})
