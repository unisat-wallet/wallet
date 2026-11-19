import { describe, expect, it, vi } from 'vitest'

import { bitcoin } from '@unisat/wallet-bitcoin'
import { KeyringService } from '../src/keyring-service'

const password = 'correct horse battery staple'
const boostValue = 'secure_existing_boost_value'
const legacyBooted = JSON.stringify({
  data: 'legacy-ciphertext',
  iv: 'legacy-iv',
  salt: 'legacy-salt',
})
const legacyVault = JSON.stringify({
  data: 'legacy-vault-ciphertext',
  iv: 'legacy-vault-iv',
  salt: 'legacy-vault-salt',
})
const emptyKeyringVault = [{ type: 'Empty', data: null, addressType: 0 }]

describe('KeyringService PSBT signing guards', () => {
  it('rejects an out-of-range SIGHASH_SINGLE before calling the keyring signer', () => {
    const service = new KeyringService()
    const signTransaction = vi.fn()
    const psbt = {
      txOutputs: [{}],
      data: {
        inputs: [{}, { sighashType: bitcoin.Transaction.SIGHASH_SINGLE }],
      },
    } as any

    expect(() =>
      service.signTransaction({ signTransaction } as any, psbt, [
        { index: 1, publicKey: '', sighashTypes: [bitcoin.Transaction.SIGHASH_SINGLE] },
      ])
    ).toThrow('SIGHASH_SINGLE input has no corresponding output')
    expect(signTransaction).not.toHaveBeenCalled()
  })

  it('allows in-range SIGHASH_SINGLE | ANYONECANPAY', () => {
    const service = new KeyringService()
    const signTransaction = vi.fn().mockReturnValue('signed')
    const sighashType =
      bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY
    const psbt = {
      txOutputs: [{}],
      data: { inputs: [{ sighashType }] },
    } as any
    const inputs = [{ index: 0, publicKey: '', sighashTypes: [sighashType] }]

    expect(service.signTransaction({ signTransaction } as any, psbt, inputs)).toBe('signed')
    expect(signTransaction).toHaveBeenCalledWith(psbt, inputs)
  })
})

describe('KeyringService booted KDF migration', () => {
  it('rejects a literal true verifier instead of accepting it as the password', async () => {
    const service = new KeyringService()
    await service.init({
      storage: {
        get: vi.fn().mockResolvedValue({
          booted: 'attacker-controlled-verifier',
          vault: null,
          boostValue,
        }),
        set: vi.fn(),
      } as any,
      encryptor: {
        decrypt: vi.fn().mockResolvedValue('true'),
        encrypt: vi.fn(),
      },
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })

    await expect(service.verifyPassword('attacker-password')).resolves.toBe(false)
    await expect(service.submitPassword('attacker-password')).rejects.toThrow('password_error')
  })

  it('migrates a legacy true verifier only during a successful full unlock', async () => {
    const legacyTrueBooted = 'legacy-true-verifier'
    const currentVault = JSON.stringify({
      data: 'current-vault-ciphertext',
      iv: 'current-vault-iv',
      salt: 'current-vault-salt',
      iterations: 600000,
    })
    const encryptor = {
      decrypt: vi.fn(async (_password: string, encrypted: string) => {
        if (encrypted === legacyTrueBooted) return 'true'
        if (encrypted === currentVault) return emptyKeyringVault
        if (encrypted.startsWith('current-verifier:')) {
          return encrypted.slice('current-verifier:'.length)
        }
        throw new Error('Incorrect password')
      }),
      encrypt: vi.fn(async (_password: string, value: any) => `current-verifier:${value}`),
    }
    const service = new KeyringService()
    await service.init({
      storage: {
        get: vi.fn().mockResolvedValue({
          booted: legacyTrueBooted,
          vault: currentVault,
          boostValue: 'true',
        }),
        set: vi.fn(),
      } as any,
      encryptor,
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })

    await expect(service.verifyPassword(password)).resolves.toBe(false)
    await service.submitPassword(password)

    const migratedBoostValue = service.store.getState().boostValue
    expect(migratedBoostValue).toMatch(/^secure_/)
    expect(service.store.getState().booted).toBe(`current-verifier:${migratedBoostValue}`)
    await expect(service.verifyPassword(password)).resolves.toBe(true)
    expect(encryptor.decrypt).toHaveBeenCalledWith(password, currentVault)
  })

  it('does not migrate a legacy true verifier when the vault password is invalid', async () => {
    const legacyTrueBooted = 'legacy-true-verifier'
    const vault = 'wallet-vault'
    const encryptor = {
      decrypt: vi.fn(async (_password: string, encrypted: string) => {
        if (encrypted === legacyTrueBooted) return 'true'
        throw new Error('Incorrect password')
      }),
      encrypt: vi.fn(),
    }
    const service = new KeyringService()
    await service.init({
      storage: {
        get: vi.fn().mockResolvedValue({ booted: legacyTrueBooted, vault, boostValue: 'true' }),
        set: vi.fn(),
      } as any,
      encryptor,
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })

    await expect(service.submitPassword('attacker-password')).rejects.toThrow('Incorrect password')
    expect(service.store.getState()).toMatchObject({
      booted: legacyTrueBooted,
      boostValue: 'true',
    })
    expect(service.password).toBeNull()
    expect(encryptor.encrypt).not.toHaveBeenCalled()
  })

  it('persists feature state encrypted and clears its decrypted cache when locked', async () => {
    const values = new Map<string, any>()
    const storage = {
      get: vi.fn(async (key: string) => values.get(key)),
      set: vi.fn(async (key: string, value: any) => void values.set(key, value)),
    }
    const encryptor = {
      encrypt: vi.fn(
        async (valuePassword: string, value: any) =>
          `cipher:${valuePassword}:${btoa(JSON.stringify(value))}`
      ),
      decrypt: vi.fn(async (valuePassword: string, encrypted: string) => {
        const prefix = `cipher:${valuePassword}:`
        if (!encrypted.startsWith(prefix)) throw new Error('Incorrect password')
        return JSON.parse(atob(encrypted.slice(prefix.length)))
      }),
    }
    const service = new KeyringService()
    await service.init({
      storage: storage as any,
      encryptor,
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })
    ;(service as any).password = password

    await service.setEncryptedStorageItem('rgb-service-v1', 'wallet-state', {
      blind: 'secret-value',
    })

    const stored = values.get('encryptedFeatureStorage:rgb-service-v1')
    expect(stored).not.toContain('secret-value')
    expect(await service.getEncryptedStorageItem('rgb-service-v1', 'wallet-state')).toEqual({
      blind: 'secret-value',
    })

    const reopenedService = new KeyringService()
    await reopenedService.init({
      storage: storage as any,
      encryptor,
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })
    ;(reopenedService as any).password = password
    expect(await reopenedService.getEncryptedStorageItem('rgb-service-v1', 'wallet-state')).toEqual({
      blind: 'secret-value',
    })

    await service.setLocked()
    await expect(service.getEncryptedStorageItem('rgb-service-v1', 'wallet-state')).rejects.toThrow(
      'you_need_to_unlock_wallet_first'
    )
  })

  it('serializes concurrent encrypted storage updates in the same namespace', async () => {
    const values = new Map<string, any>()
    const storage = {
      get: vi.fn(async (key: string) => values.get(key)),
      set: vi.fn(async (key: string, value: any) => void values.set(key, value)),
    }
    const encryptor = {
      encrypt: vi.fn(
        async (valuePassword: string, value: any) =>
          `cipher:${valuePassword}:${btoa(JSON.stringify(value))}`
      ),
      decrypt: vi.fn(async (valuePassword: string, encrypted: string) => {
        const prefix = `cipher:${valuePassword}:`
        if (!encrypted.startsWith(prefix)) throw new Error('Incorrect password')
        return JSON.parse(atob(encrypted.slice(prefix.length)))
      }),
    }
    const service = new KeyringService()
    await service.init({
      storage: storage as any,
      encryptor,
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })
    ;(service as any).password = password

    await Promise.all([
      service.setEncryptedStorageItem('rgb-service-v1', 'wallet-a', { pending: 'send' }),
      service.setEncryptedStorageItem('rgb-service-v1', 'wallet-b', { pending: 'receive' }),
    ])

    expect(await service.getEncryptedStorageItem('rgb-service-v1', 'wallet-a')).toEqual({
      pending: 'send',
    })
    expect(await service.getEncryptedStorageItem('rgb-service-v1', 'wallet-b')).toEqual({
      pending: 'receive',
    })
  })

  it('retains every namespace when different encrypted stores are registered concurrently', async () => {
    const values = new Map<string, any>()
    const storage = {
      get: vi.fn(async (key: string) => values.get(key)),
      set: vi.fn(async (key: string, value: any) => void values.set(key, value)),
    }
    const encryptor = {
      encrypt: vi.fn(async (_password: string, value: any) => JSON.stringify(value)),
      decrypt: vi.fn(async (_password: string, value: string) => JSON.parse(value)),
    }
    const service = new KeyringService()
    await service.init({
      storage: storage as any,
      encryptor,
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })
    ;(service as any).password = password

    await Promise.all([
      service.setEncryptedStorageItem('rgb-service-v1', 'wallet-state', { pending: true }),
      service.setEncryptedStorageItem('rgb-meta-v1', 'rgb-device-id:v1', 'device_abcdefghijklmnop'),
    ])

    expect(values.get('encryptedStorageRegistry')).toHaveLength(2)
    expect(values.get('encryptedStorageRegistry')).toEqual(
      expect.arrayContaining(['rgb-service-v1', 'rgb-meta-v1'])
    )
  })

  it('re-encrypts persisted feature state when the wallet password changes', async () => {
    const oldPassword = 'old password'
    const newPassword = 'new password'
    const encode = (valuePassword: string, value: any) =>
      JSON.stringify({ password: valuePassword, data: btoa(JSON.stringify(value)) })
    const decode = (valuePassword: string, encrypted: string) => {
      const payload = JSON.parse(encrypted)
      if (payload.password !== valuePassword) throw new Error('Incorrect password')
      return JSON.parse(atob(payload.data))
    }
    const values = new Map<string, any>([
      [
        'keyringState',
        {
          booted: encode(oldPassword, boostValue),
          vault: encode(oldPassword, emptyKeyringVault),
          boostValue,
        },
      ],
      ['encryptedStorageRegistry', ['rgb-service-v1']],
      [
        'encryptedFeatureStorage:rgb-service-v1',
        encode(oldPassword, { 'wallet-state': { blind: 'secret-value' } }),
      ],
    ])
    const storage = {
      get: vi.fn(async (key: string) => values.get(key)),
      set: vi.fn(async (key: string, value: any) => void values.set(key, value)),
    }
    const service = new KeyringService()
    await service.init({
      storage: storage as any,
      encryptor: {
        encrypt: vi.fn(async (valuePassword, value) => encode(valuePassword, value)),
        decrypt: vi.fn(async (valuePassword, value) => decode(valuePassword, value)),
      },
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })

    await service.changePassword(oldPassword, newPassword)

    const stored = values.get('encryptedFeatureStorage:rgb-service-v1')
    expect(() => decode(oldPassword, stored)).toThrow('Incorrect password')
    expect(decode(newPassword, stored)).toEqual({ 'wallet-state': { blind: 'secret-value' } })
  })

  it('clears keyring secrets before locking', async () => {
    const service = new KeyringService()
    const clearSensitiveData = vi.fn()
    await service.init({
      storage: { get: vi.fn(), set: vi.fn() } as any,
      encryptor: { decrypt: vi.fn(), encrypt: vi.fn() },
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })
    service.keyrings = [{ clearSensitiveData } as any]

    await service.setLocked()

    expect(clearSensitiveData).toHaveBeenCalledTimes(1)
    expect(service.keyrings).toEqual([])
  })

  it('does not let a pending unlock override a lock request', async () => {
    let releaseVaultDecrypt!: () => void
    const vaultDecryptStarted = new Promise<void>(resolve => {
      releaseVaultDecrypt = resolve
    })
    let signalVaultDecrypt!: () => void
    const vaultDecryptSignal = new Promise<void>(resolve => {
      signalVaultDecrypt = resolve
    })
    const booted = `cipher:${password}:${btoa(JSON.stringify(boostValue))}`
    const vault = `cipher:${password}:${btoa(JSON.stringify(emptyKeyringVault))}`
    const service = new KeyringService()
    await service.init({
      storage: {
        get: vi.fn(async () => ({ booted, vault, boostValue })),
        set: vi.fn(),
      } as any,
      encryptor: {
        encrypt: vi.fn(),
        decrypt: vi.fn(async (_password: string, encrypted: string) => {
          if (encrypted === vault) {
            signalVaultDecrypt()
            await vaultDecryptStarted
            return emptyKeyringVault
          }
          return boostValue
        }),
      },
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })

    const unlocking = service.submitPassword(password)
    await vaultDecryptSignal
    const locking = service.setLocked()
    releaseVaultDecrypt()
    await Promise.all([unlocking, locking])

    expect(service.getMemStore().isUnlocked).toBe(false)
    expect(service.password).toBeNull()
    expect(service.keyrings).toEqual([])
  })

  it('keeps the old verifier and vault if preparing the new vault fails', async () => {
    const oldPassword = 'old password'
    const newPassword = 'new password'
    const encode = (valuePassword: string, value: any) =>
      JSON.stringify({ password: valuePassword, data: btoa(JSON.stringify(value)) })
    const decode = (valuePassword: string, encrypted: string) => {
      const payload = JSON.parse(encrypted)
      if (payload.password !== valuePassword) throw new Error('Incorrect password')
      return JSON.parse(atob(payload.data))
    }
    const oldBooted = encode(oldPassword, boostValue)
    const oldVault = encode(oldPassword, emptyKeyringVault)
    const service = new KeyringService()
    await service.init({
      storage: {
        get: vi.fn(async () => ({ booted: oldBooted, vault: oldVault, boostValue })),
        set: vi.fn(),
      } as any,
      encryptor: {
        decrypt: vi.fn(async (valuePassword, encrypted) => decode(valuePassword, encrypted)),
        encrypt: vi.fn(async (valuePassword, value) => {
          if (valuePassword === newPassword && Array.isArray(value)) {
            throw new Error('vault encryption interrupted')
          }
          return encode(valuePassword, value)
        }),
      },
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })

    await expect(service.changePassword(oldPassword, newPassword)).rejects.toThrow(
      'change_password_failed'
    )

    expect(service.store.getState()).toMatchObject({ booted: oldBooted, vault: oldVault })
    expect(await service.verifyPassword(oldPassword)).toBe(true)
    expect(await service.verifyPassword(newPassword)).toBe(false)
  })

  it('refuses to overwrite an existing vault with an empty keyring set', async () => {
    const vault = 'existing-vault'
    const service = new KeyringService()
    await service.init({
      storage: {
        get: vi.fn(async () => ({ booted: 'booted', vault, boostValue })),
        set: vi.fn(),
      } as any,
      encryptor: { decrypt: vi.fn(), encrypt: vi.fn() },
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })
    service.password = password
    service.keyrings = []

    await expect(service.persistAllKeyrings()).rejects.toThrow(
      'Cannot persist an empty keyring vault'
    )
    expect(service.store.getState().vault).toBe(vault)
  })

  it('waits for keyring restoration before persisting the vault', async () => {
    const encode = (value: any) => JSON.stringify(value)
    const vault = encode(emptyKeyringVault)
    let releaseRestore!: () => void
    const restoreGate = new Promise<void>(resolve => {
      releaseRestore = resolve
    })
    let signalRestore!: () => void
    const restoreStarted = new Promise<void>(resolve => {
      signalRestore = resolve
    })
    const encrypt = vi.fn(async (_password: string, value: any) => encode(value))
    const service = new KeyringService()
    await service.init({
      storage: {
        get: vi.fn(async () => ({ booted: 'booted', vault, boostValue })),
        set: vi.fn(),
      } as any,
      encryptor: {
        decrypt: vi.fn(async (_password: string, encrypted: string) => JSON.parse(encrypted)),
        encrypt,
      },
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })
    service.password = password
    const previousKeyring = {
      type: 'Empty',
      serialize: vi.fn(async () => ({})),
      clearSensitiveData: vi.fn(),
    } as any
    service.keyrings = [previousKeyring]
    service.addressTypes = [0]
    const restoreKeyring = (service as any)._restoreKeyring.bind(service)
    vi.spyOn(service as any, '_restoreKeyring').mockImplementation(async (serialized: any) => {
      signalRestore()
      await restoreGate
      return restoreKeyring(serialized)
    })

    const unlocking = service.unlockKeyrings(password)
    await restoreStarted
    const persisting = service.persistAllKeyrings()

    expect(service.keyrings).toEqual([previousKeyring])
    expect(encrypt).not.toHaveBeenCalled()

    releaseRestore()
    await Promise.all([unlocking, persisting])

    expect(encrypt).toHaveBeenCalledWith(
      password,
      expect.arrayContaining([expect.objectContaining({ type: 'Empty' })])
    )
    expect(encrypt).not.toHaveBeenCalledWith(password, [])
  })

  it('re-encrypts a legacy booted payload after validating the password', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({ booted: legacyBooted, vault: null, boostValue }),
      set: vi.fn().mockResolvedValue(undefined),
    }
    const encryptor = {
      decrypt: vi.fn().mockResolvedValue(boostValue),
      encrypt: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({
            data: 'current-ciphertext',
            iv: 'current-iv',
            salt: 'current-salt',
            iterations: 600000,
          })
        ),
    }
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() }
    const service = new KeyringService()

    await service.init({ storage: storage as any, encryptor, logger, t: (key: string) => key })
    await service.submitPassword(password)

    expect(encryptor.decrypt).toHaveBeenCalledWith(password, legacyBooted)
    expect(encryptor.encrypt).toHaveBeenCalledWith(password, boostValue)
    expect(JSON.parse(service.store.getState().booted)).toMatchObject({ iterations: 600000 })
  })

  it('does not rewrite a booted payload that already declares its KDF iterations', async () => {
    const currentBooted = JSON.stringify({
      data: 'current-ciphertext',
      iv: 'current-iv',
      salt: 'current-salt',
      iterations: 600000,
    })
    const storage = {
      get: vi.fn().mockResolvedValue({ booted: currentBooted, vault: null, boostValue }),
      set: vi.fn().mockResolvedValue(undefined),
    }
    const encryptor = {
      decrypt: vi.fn().mockResolvedValue(boostValue),
      encrypt: vi.fn(),
    }
    const service = new KeyringService()

    await service.init({
      storage: storage as any,
      encryptor,
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })
    await service.submitPassword(password)

    expect(encryptor.encrypt).not.toHaveBeenCalled()
  })

  it('does not rewrite a legacy payload when password validation fails', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({ booted: legacyBooted, vault: null, boostValue }),
      set: vi.fn().mockResolvedValue(undefined),
    }
    const encryptor = {
      decrypt: vi.fn().mockRejectedValue(new Error('Incorrect password')),
      encrypt: vi.fn(),
    }
    const service = new KeyringService()

    await service.init({
      storage: storage as any,
      encryptor,
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })

    await expect(service.submitPassword(password)).rejects.toThrow('password_error')
    expect(encryptor.encrypt).not.toHaveBeenCalled()
    expect(service.store.getState().booted).toBe(legacyBooted)
  })

  it('re-encrypts a legacy vault after successfully unlocking it', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({ booted: legacyBooted, vault: legacyVault, boostValue }),
      set: vi.fn().mockResolvedValue(undefined),
    }
    const encryptor = {
      decrypt: vi.fn().mockResolvedValueOnce(boostValue).mockResolvedValueOnce(emptyKeyringVault),
      encrypt: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            data: 'current-booted',
            iv: 'current-iv',
            salt: 'current-salt',
            iterations: 600000,
          })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            data: 'current-vault',
            iv: 'current-iv',
            salt: 'current-salt',
            iterations: 600000,
          })
        ),
    }
    const service = new KeyringService()

    await service.init({
      storage: storage as any,
      encryptor,
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      t: (key: string) => key,
    })
    await service.submitPassword(password)

    expect(encryptor.decrypt).toHaveBeenCalledWith(password, legacyVault)
    expect(encryptor.encrypt).toHaveBeenLastCalledWith(password, [
      { ...emptyKeyringVault[0], data: {} },
    ])
    expect(JSON.parse(service.store.getState().vault!)).toMatchObject({ iterations: 600000 })
  })
})
