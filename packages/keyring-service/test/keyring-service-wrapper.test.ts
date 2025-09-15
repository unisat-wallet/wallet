import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from 'vitest'
import {
  KeyringServiceWrapper,
  createKeyringService,
  ExtensionKeyringItem,
} from './keyring-service-wrapper'
import { KeyringType } from '../src/types'
import { AddressType } from '@unisat/wallet-types'
import { eccManager } from '@unisat/wallet-bitcoin'

describe('KeyringServiceWrapper', () => {
  let keyringService: KeyringServiceWrapper

  beforeEach(async () => {
    // Mock console to reduce test output noise
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Create a new instance for each test
    keyringService = createKeyringService(false) // Use memory storage
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('should create a new instance successfully', () => {
      expect(keyringService).toBeDefined()
      expect(keyringService).toBeInstanceOf(KeyringServiceWrapper)
    })

    it('should initialize successfully', async () => {
      await expect(keyringService.init()).resolves.not.toThrow()

      expect(console.log).toHaveBeenCalledWith('[KeyringService] Starting initialization...')
      expect(console.log).toHaveBeenCalledWith('[KeyringService] Calling parent init...')
      expect(console.log).toHaveBeenCalledWith('[KeyringService] Initialization complete')
    })

    it('should handle multiple init calls gracefully', async () => {
      await keyringService.init()
      await keyringService.init() // Second call should not cause issues

      const accounts = await keyringService.getAccounts()
      expect(accounts).toEqual([])
    })

    it('should report correct storage type', async () => {
      await keyringService.init()
      const storageType = await keyringService.getStorageType()
      expect(storageType).toBe('MemoryStorageAdapter')
    })
  })

  describe('basic wallet lifecycle', () => {
    beforeEach(async () => {
      await keyringService.init()
    })

    it('should handle wallet boot process', async () => {
      const password = 'test-password-123'

      // Initially not booted
      expect(await keyringService.isBooted()).toBe(false)
      expect(await keyringService.hasVault()).toBe(false)

      // Boot the wallet
      await keyringService.bootWallet(password)

      // Should now be booted and unlocked
      expect(await keyringService.isBooted()).toBe(true)
      expect(await keyringService.isWalletUnlocked()).toBe(true)
    })

    it('should handle password verification', async () => {
      const password = 'test-password-123'

      // Boot wallet first
      await keyringService.bootWallet(password)

      // Correct password should verify
      await expect(keyringService.verifyPassword(password)).resolves.not.toThrow()

      // Wrong password should fail
      await expect(keyringService.verifyPassword('wrong-password')).rejects.toThrow()
    })

    it('should handle lock/unlock cycle', async () => {
      const password = 'test-password-123'

      await keyringService.bootWallet(password)
      expect(await keyringService.isWalletUnlocked()).toBe(true)

      // Lock wallet
      await keyringService.setLocked()
      expect(await keyringService.isWalletUnlocked()).toBe(false)

      // Unlock wallet
      await keyringService.submitPassword(password)
      expect(await keyringService.isWalletUnlocked()).toBe(true)
    })

    it('should handle password change', async () => {
      const oldPassword = 'old-password-123'
      const newPassword = 'new-password-456'

      await keyringService.bootWallet(oldPassword)

      // Change password
      await keyringService.changePassword(oldPassword, newPassword)

      // Old password should no longer work
      await keyringService.setLocked()
      await expect(keyringService.submitPassword(oldPassword)).rejects.toThrow()

      // New password should work
      await expect(keyringService.submitPassword(newPassword)).resolves.not.toThrow()
    })
  })

  describe('mnemonic management', () => {
    beforeEach(async () => {
      await keyringService.init()
      await keyringService.bootWallet('test-password-123')
    })

    it('should generate valid mnemonic', () => {
      const mnemonic = keyringService.generateMnemonic()

      expect(mnemonic).toBeDefined()
      expect(typeof mnemonic).toBe('string')
      expect(mnemonic.split(' ')).toHaveLength(12) // 128-bit entropy = 12 words
    })

    it('should handle pre-mnemonic storage and retrieval', async () => {
      // Generate and store pre-mnemonic
      const mnemonic = await keyringService.generatePreMnemonic()

      expect(mnemonic).toBeDefined()
      expect(typeof mnemonic).toBe('string')

      // Retrieve stored pre-mnemonic
      const retrievedMnemonic = await keyringService.getPreMnemonics()
      expect(retrievedMnemonic).toBe(mnemonic)

      // Clear pre-mnemonic
      keyringService.removePreMnemonics()
      const clearedMnemonic = await keyringService.getPreMnemonics()
      expect(clearedMnemonic).toBe('')
    })

    it('should require unlock for mnemonic operations', async () => {
      await keyringService.setLocked()

      await expect(keyringService.generatePreMnemonic()).rejects.toThrow(
        'Wallet must be unlocked first'
      )
      await expect(keyringService.getPreMnemonics()).rejects.toThrow(
        'Wallet must be unlocked first'
      )
    })
  })

  describe('keyring management', () => {
    beforeEach(async () => {
      await keyringService.init()
      await keyringService.bootWallet('test-password-123')
    })

    it('should initially have no keyrings', async () => {
      expect(await keyringService.hasAnyKeyrings()).toBe(false)
      expect(await keyringService.getKeyringCount()).toBe(0)

      const accounts = await keyringService.getAccounts()
      expect(accounts).toEqual([])
    })

    it('should handle empty keyring operations gracefully', async () => {
      // Operations on empty state should not throw
      const accounts = await keyringService.getAccounts()
      expect(accounts).toEqual([])

      const allKeyrings = await keyringService.getAllKeyrings()
      expect(allKeyrings).toEqual([])

      // These should throw as no keyrings exist
      await expect(keyringService.getKeyringForAccount('non-existent-address')).rejects.toThrow(
        'No keyring found for the requested account'
      )
    })

    it('should handle keyring creation errors gracefully', async () => {
      // These operations require actual keyring SDK integration
      await expect(keyringService.importPrivateKey('test-key', AddressType.P2WPKH)).rejects.toThrow(
        'Private key import requires keyring SDK integration'
      )

      await expect(
        (keyringService as any).createKeyringWithMnemonic(
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
          "m/44'/0'/0'",
          '',
          AddressType.P2WPKH,
          1
        )
      ).rejects.toThrow('Mnemonic keyring creation requires keyring SDK integration')
    })
  })

  describe('memory store state', () => {
    beforeEach(async () => {
      await keyringService.init()
    })

    it('should provide correct initial memory store state', () => {
      const memStore = keyringService.getMemStore()

      expect(memStore).toBeDefined()
      expect(memStore.isUnlocked).toBe(false)
      expect(memStore.keyringTypes).toEqual([])
      expect(memStore.keyrings).toEqual([])
      expect(memStore.preMnemonics).toBe('')
    })

    it('should update memory store state after boot', async () => {
      await keyringService.bootWallet('test-password')

      const memStore = keyringService.getMemStore()
      expect(memStore.isUnlocked).toBe(true)
    })

    it('should update memory store state after lock', async () => {
      await keyringService.bootWallet('test-password')
      await keyringService.setLocked()

      const memStore = keyringService.getMemStore()
      expect(memStore.isUnlocked).toBe(false)
    })
  })

  describe('extension compatibility', () => {
    it('should create extension-compatible instance', () => {
      const extensionService = createKeyringService(true)

      expect(extensionService).toBeDefined()
      expect(extensionService).toBeInstanceOf(KeyringServiceWrapper)
    })

    it('should report correct storage type for extension', async () => {
      const extensionService = createKeyringService(true)
      await extensionService.init()

      const storageType = await extensionService.getStorageType()
      expect(storageType).toBe('ExtensionPersistStoreAdapter')
    })

    it('should have compatible interface types', () => {
      const extensionItem: ExtensionKeyringItem = {
        type: KeyringType.HdKeyring,
        accounts: [
          {
            pubkey: 'bc1qtest123',
            brandName: 'HD Key Tree',
          },
        ],
        addressType: AddressType.P2WPKH,
        index: 0,
      }

      expect(extensionItem).toBeDefined()
      expect(typeof extensionItem.type).toBe('string')
      expect(Array.isArray(extensionItem.accounts)).toBe(true)
      expect(typeof extensionItem.addressType).toBe('string')
      expect(typeof extensionItem.index).toBe('number')
    })
  })

  describe('utility methods', () => {
    beforeEach(async () => {
      await keyringService.init()
      await keyringService.bootWallet('test-password')
    })

    it('should clear all data', async () => {
      // Generate some pre-mnemonic data
      await keyringService.generatePreMnemonic()

      // Clear all data
      await keyringService.clearAllData()

      // Should be locked and cleaned
      expect(await keyringService.isWalletUnlocked()).toBe(false)

      // Memory state should be reset
      const memStore = keyringService.getMemStore()
      expect(memStore.isUnlocked).toBe(false)
      expect(memStore.preMnemonics).toBe('')
    })

    it('should handle concurrent operations safely', async () => {
      // Test multiple simultaneous operations
      const promises = [
        keyringService.generateMnemonic(),
        keyringService.getMemStore(),
        keyringService.isBooted(),
        keyringService.hasVault(),
      ]

      await expect(Promise.all(promises)).resolves.toBeDefined()
    })
  })

  describe('error handling', () => {
    beforeEach(async () => {
      await keyringService.init()
    })

    it('should handle operations on locked wallet', async () => {
      // Operations requiring unlock should fail when locked
      await expect(keyringService.generatePreMnemonic()).rejects.toThrow(
        'Wallet must be unlocked first'
      )
    })

    it('should handle invalid password operations', async () => {
      await keyringService.bootWallet('test-password')

      // Wrong password should fail
      await expect(keyringService.verifyPassword('wrong-password')).rejects.toThrow()

      await keyringService.setLocked()

      await expect(keyringService.submitPassword('wrong-password')).rejects.toThrow()
    })

    it('should handle concurrent unlock attempts', async () => {
      await keyringService.bootWallet('test-password')
      await keyringService.setLocked()

      // Start first unlock attempt
      const firstUnlock = keyringService.submitPassword('test-password')

      // Immediately start second unlock attempt (should fail due to concurrency)
      let secondUnlockError: Error | null = null
      try {
        await keyringService.submitPassword('test-password')
      } catch (error) {
        secondUnlockError = error as Error
      }

      // First should succeed
      await expect(firstUnlock).resolves.not.toThrow()

      // Second should have failed with concurrent error
      expect(secondUnlockError).toBeDefined()
      expect(secondUnlockError?.message).toBe('Unlock already in progress')
    })
  })
})
