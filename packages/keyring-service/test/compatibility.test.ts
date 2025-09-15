import { describe, it, expect, beforeEach } from 'vitest'
import { KeyringService } from '../src/keyring-service'
import { MemoryStorageAdapter } from '../src/adapters/memory'
import { MemStoreState } from '../src/types'

describe('KeyringService Compatibility Tests', () => {
  describe('Memory Storage Adapter', () => {
    let keyringService: KeyringService
    let storageAdapter: MemoryStorageAdapter

    beforeEach(() => {
      storageAdapter = new MemoryStorageAdapter()
      keyringService = new KeyringService({
        storage: storageAdapter,
        logger: console,
      })
    })

    it('should initialize with memory storage', async () => {
      await keyringService.init()
      expect(keyringService.getMemStore().isUnlocked).toBe(false)
    })

    it('should boot and maintain state', async () => {
      await keyringService.init()
      await keyringService.boot('test-password')

      expect(keyringService.isBooted()).toBe(true)
      expect(keyringService.getMemStore().isUnlocked).toBe(true)
    })

    it('should handle lock/unlock cycle', async () => {
      await keyringService.init()
      await keyringService.boot('test-password')

      // Lock
      await keyringService.setLocked()
      expect(keyringService.getMemStore().isUnlocked).toBe(false)

      // Unlock
      await keyringService.submitPassword('test-password')
      expect(keyringService.getMemStore().isUnlocked).toBe(true)
    })

    it('should verify password correctly', async () => {
      await keyringService.init()
      await keyringService.boot('test-password')

      const isValid = await keyringService.verifyPassword('test-password')
      expect(isValid).toBe(true)

      const isInvalid = await keyringService.verifyPassword('wrong-password')
      expect(isInvalid).toBe(false)
    })

    it('should handle pre-mnemonic generation', async () => {
      await keyringService.init()
      await keyringService.boot('test-password')

      const mnemonic = await keyringService.generatePreMnemonic()
      expect(typeof mnemonic).toBe('string')
      expect(mnemonic.split(' ')).toHaveLength(12)

      const storedMnemonic = await keyringService.getPreMnemonic()
      expect(storedMnemonic).toBe(mnemonic)
    })
  })

  describe('ObservableStore Integration', () => {
    let keyringService: KeyringService

    beforeEach(() => {
      const storageAdapter = new MemoryStorageAdapter()
      keyringService = new KeyringService({
        storage: storageAdapter,
        logger: console,
      })
    })

    it('should emit update events', async () => {
      await keyringService.init()

      let updateEmitted = false
      let lastState: MemStoreState | null = null

      keyringService.on('update', state => {
        updateEmitted = true
        lastState = state
      })

      await keyringService.boot('test-password')

      expect(updateEmitted).toBe(true)
      expect(lastState).toBeDefined()
      expect((lastState as any)?.isUnlocked).toBe(true)
    })

    it('should emit lock events', async () => {
      await keyringService.init()
      await keyringService.boot('test-password')

      let lockEmitted = false
      keyringService.on('lock', () => {
        lockEmitted = true
      })

      await keyringService.setLocked()
      expect(lockEmitted).toBe(true)
    })

    it('should emit unlock events', async () => {
      await keyringService.init()
      await keyringService.boot('test-password')
      await keyringService.setLocked()

      let unlockEmitted = false
      keyringService.on('unlock', () => {
        unlockEmitted = true
      })

      await keyringService.submitPassword('test-password')
      expect(unlockEmitted).toBe(true)
    })

    it('should provide memory store state', async () => {
      await keyringService.init()

      const initialState = keyringService.getMemStore()
      expect(initialState.isUnlocked).toBe(false)
      expect(initialState.keyrings).toEqual([])
      expect(initialState.keyringTypes).toEqual([])

      await keyringService.boot('test-password')

      const unlockedState = keyringService.getMemStore()
      expect(unlockedState.isUnlocked).toBe(true)
    })
  })

  describe('unisat-extension Interface Compatibility', () => {
    let keyringService: KeyringService

    beforeEach(() => {
      const storageAdapter = new MemoryStorageAdapter()
      keyringService = new KeyringService({
        storage: storageAdapter,
        logger: console,
      })
    })

    it('should have loadStore method', () => {
      expect(typeof keyringService.loadStore).toBe('function')

      const mockState = { test: 'data' }
      keyringService.loadStore(mockState as any)
      expect(keyringService.store.getState()).toEqual(mockState)
    })

    it('should have arrow function methods like unisat-extension', () => {
      expect(typeof keyringService.boot).toBe('function')
      expect(typeof keyringService.isBooted).toBe('function')
      expect(typeof keyringService.hasVault).toBe('function')
      expect(typeof keyringService.fullUpdate).toBe('function')
      expect(typeof keyringService.setUnlocked).toBe('function')
      expect(typeof keyringService.getKeyringByType).toBe('function')
    })

    it('should have correct memStore structure', async () => {
      await keyringService.init()

      const memStore = keyringService.getMemStore()
      expect(memStore).toHaveProperty('isUnlocked')
      expect(memStore).toHaveProperty('keyringTypes')
      expect(memStore).toHaveProperty('keyrings')
      expect(memStore).toHaveProperty('preMnemonics')
      expect(memStore).toHaveProperty('addressTypes')
      expect(memStore).toHaveProperty('keystone')
    })

    it('should maintain public property visibility', () => {
      expect(keyringService.keyringTypes).toBeDefined()
      expect(keyringService.memStore).toBeDefined()
      expect(keyringService.keyrings).toBeDefined()
      expect(keyringService.addressTypes).toBeDefined()
      expect(keyringService.password).toBeNull()
    })
  })
})
