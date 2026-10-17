import { describe, expect, it, vi } from 'vitest'

import { KeyringService, WebCryptoVaultEncryptor, normalizeMnemonic } from '../src'
import { AddressType } from '@unisat/wallet-types'

const mnemonic =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function createService() {
  const storage = {
    get: vi.fn().mockResolvedValue({ booted: '', vault: null, boostValue: 'true' }),
    set: vi.fn().mockResolvedValue(undefined),
  }
  const service = new KeyringService()

  return {
    service,
    init: async () => {
      await service.init({
        storage: storage as any,
        encryptor: new WebCryptoVaultEncryptor(),
        logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
        t: (key: string) => key,
      })
      await service.boot('test-password')
    },
  }
}

describe('mnemonic recovery input', () => {
  it('persists the canonical BIP-39 phrase without retaining it on the unlocked keyring', async () => {
    const { service, init } = createService()
    await init()

    const keyring = await service.createKeyringWithMnemonics(
      `  ${mnemonic.replace('abandon abandon', 'abandon\nabandon')}  `,
      "m/84'/0'/0'/0",
      'test passphrase',
      AddressType.P2WPKH,
      1
    )

    expect(normalizeMnemonic(`\t${mnemonic}\n`)).toBe(mnemonic)
    const serialized = (await keyring.serialize()) as { mnemonic: string; passphrase: string }
    expect(serialized.mnemonic).toBe('')
    expect(serialized.passphrase).toBe('')
    await service.addNewAccount(keyring)

    expect(await service.getKeyringRecoveryData(0)).toEqual({
      mnemonic,
      hdPath: "m/84'/0'/0'/0",
      passphrase: 'test passphrase',
    })

    await service.setLocked()
    await service.submitPassword('test-password')

    const unlockedKeyring = service.keyrings[0] as typeof keyring
    expect((await unlockedKeyring.serialize()).mnemonic).toBe('')
    await service.changePassword('test-password', 'new-test-password')

    expect(await service.getKeyringRecoveryData(0)).toMatchObject({
      mnemonic,
      passphrase: 'test passphrase',
    })

    await service.setLocked()
    await service.submitPassword('new-test-password')
    expect(await service.getKeyringRecoveryData(0)).toMatchObject({ mnemonic })
  })

  it('rejects malformed derivation paths before creating a persistent keyring', async () => {
    const { service, init } = createService()
    await init()

    await expect(
      service.createKeyringWithMnemonics(mnemonic, 'm/84/not-a-number', '', AddressType.P2WPKH, 1)
    ).rejects.toThrow('invalid_derivation_path')
    expect(service.keyrings).toHaveLength(0)
  })

  it('creates a keyring from the encrypted pre-mnemonic without returning it to the caller', async () => {
    const { service, init } = createService()
    await init()

    const generatedMnemonic = await service.generatePreMnemonic()
    const keyring = await service.createKeyringWithPreMnemonic(
      "m/84'/0'/0'/0",
      '',
      AddressType.P2WPKH,
      1
    )

    expect((await keyring.getAccounts()).length).toBe(1)
    expect(await service.getPreMnemonics()).toBe(generatedMnemonic)
  })

  it('rejects unsafe account counts before deriving accounts', async () => {
    const { service, init } = createService()
    await init()

    await expect(
      service.createKeyringWithMnemonics(mnemonic, "m/84'/0'/0'/0", '', AddressType.P2WPKH, 101)
    ).rejects.toThrow('keyring_error_account_count')
    expect(service.keyrings).toHaveLength(0)
  })
})
