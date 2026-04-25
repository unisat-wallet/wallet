import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContactBookService } from '../src/contact-book'
import type { ContactBookItem, Logger } from '../src/types'
import { ChainType } from '@unisat/wallet-types'

class MockStorageAdapter {
  private storage: Record<string, any> = {}

  async get(key: string): Promise<any> {
    return this.storage[key]
  }

  async set(key: string, value: any): Promise<void> {
    this.storage[key] = value
  }

  async remove(key: string): Promise<void> {
    delete this.storage[key]
  }

  async clear(): Promise<void> {
    this.storage = {}
  }

  getStorage() {
    return { ...this.storage }
  }
}

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

describe('ContactBookService', () => {
  let contactBook: ContactBookService
  let mockStorage: MockStorageAdapter

  beforeEach(async () => {
    vi.clearAllMocks()
    mockStorage = new MockStorageAdapter()
    contactBook = new ContactBookService()
    await contactBook.init({
      storage: mockStorage as any,
      storageKey: 'testContactBook',
      logger: mockLogger,
      autoSync: true,
    })
  })

  it('initializes with empty contacts when no storage data', () => {
    expect(contactBook.listContacts()).toEqual([])
  })

  it('throws when methods are called before init', () => {
    const uninitialized = new ContactBookService()
    expect(() => uninitialized.listContacts()).toThrow('ContactBook not initialized. Call init() first.')
  })

  it('loads existing storage and rebuilds from mixed keys', async () => {
    await mockStorage.set('testContactBook', {
      legacykey: {
        name: 'legacy',
        address: 'bc1qlegacy',
        chain: ChainType.BITCOIN_MAINNET,
        isContact: true,
        isAlias: false,
      },
      bc1qmodern_BITCOIN_TESTNET: {
        name: 'modern',
        address: 'bc1qmodern',
        chain: ChainType.BITCOIN_TESTNET,
        isContact: true,
        isAlias: false,
      },
    })

    const service = new ContactBookService()
    await service.init({ storage: mockStorage as any, storageKey: 'testContactBook' })

    const contacts = service.listContacts()
    expect(contacts).toHaveLength(2)
    expect(contacts.map(v => v.name)).toEqual(expect.arrayContaining(['legacy', 'modern']))
  })

  it('add/update/get/remove contact works', async () => {
    const contact: ContactBookItem = {
      name: 'alpha',
      address: 'bc1qalpha',
      chain: ChainType.BITCOIN_MAINNET,
      isContact: true,
      isAlias: false,
    }

    await contactBook.addContact(contact)
    expect(contactBook.getContactByAddress(contact.address)?.name).toBe('alpha')

    await contactBook.updateContact({ ...contact, name: 'alpha-updated' })
    expect(contactBook.getContactByAddressAndChain(contact.address, contact.chain)?.name).toBe('alpha-updated')

    await contactBook.removeContact(contact.address, contact.chain)
    expect(contactBook.getContactByAddress(contact.address)).toBeUndefined()
  })

  it('alias lifecycle works and respects contact/alias dual flags', async () => {
    const address = 'bc1qalias'
    const chain = ChainType.BITCOIN_MAINNET

    await contactBook.addAlias({ address, chain, name: 'alias-name' })
    expect(contactBook.listAlias()).toHaveLength(1)

    await contactBook.addContact({
      address,
      chain,
      name: 'contact-name',
      isContact: true,
      isAlias: true,
    })

    await contactBook.removeAlias(address, chain)
    const item = contactBook.getContactByAddressAndChain(address, chain)
    expect(item?.isContact).toBe(true)
    expect(item?.isAlias).toBe(false)
  })

  it('saveContactsOrder updates sortIndex ordering', async () => {
    const c1: ContactBookItem = {
      name: 'one',
      address: 'bc1q1',
      chain: ChainType.BITCOIN_MAINNET,
      isContact: true,
      isAlias: false,
      sortIndex: 1,
    }
    const c2: ContactBookItem = {
      name: 'two',
      address: 'bc1q2',
      chain: ChainType.BITCOIN_MAINNET,
      isContact: true,
      isAlias: false,
      sortIndex: 2,
    }

    await contactBook.addContact(c1)
    await contactBook.addContact(c2)

    const ordered = contactBook.listContacts()
    await contactBook.saveContactsOrder([ordered[1]!, ordered[0]!])

    const after = contactBook.listContacts()
    expect(after[0]?.name).toBe('two')
    expect(after[0]?.sortIndex).toBe(0)
  })

  it('getContactsByMap returns composite-key map', async () => {
    await contactBook.addContact({
      name: 'map',
      address: 'bc1qmap',
      chain: ChainType.BITCOIN_MAINNET,
      isContact: true,
      isAlias: false,
    })

    const map = contactBook.getContactsByMap()
    expect(map['bc1qmap_BITCOIN_MAINNET']?.name).toBe('map')
  })

  it('autoSync=false skips writes until manual sync()', async () => {
    const service = new ContactBookService()
    await service.init({
      storage: mockStorage as any,
      storageKey: 'manualSync',
      autoSync: false,
    })

    await service.addContact({
      name: 'manual',
      address: 'bc1qmanual',
      chain: ChainType.BITCOIN_MAINNET,
      isContact: true,
      isAlias: false,
    })

    expect(mockStorage.getStorage()).not.toHaveProperty('manualSync')

    await service.sync()
    expect(mockStorage.getStorage()).toHaveProperty('manualSync')
  })

  it('supports same address on different chains', async () => {
    const address = 'bc1qsame'

    await contactBook.addContact({
      name: 'mainnet',
      address,
      chain: ChainType.BITCOIN_MAINNET,
      isContact: true,
      isAlias: false,
    })
    await contactBook.addContact({
      name: 'testnet',
      address,
      chain: ChainType.BITCOIN_TESTNET,
      isContact: true,
      isAlias: false,
    })

    expect(contactBook.listContacts()).toHaveLength(2)
    expect(contactBook.getContactByAddressAndChain(address, ChainType.BITCOIN_MAINNET)?.name).toBe('mainnet')
    expect(contactBook.getContactByAddressAndChain(address, ChainType.BITCOIN_TESTNET)?.name).toBe('testnet')
  })

  it('clear() and getRawStore() work', async () => {
    await contactBook.addContact({
      name: 'raw',
      address: 'bc1qraw',
      chain: ChainType.BITCOIN_MAINNET,
      isContact: true,
      isAlias: false,
    })

    const raw = contactBook.getRawStore()
    expect(raw).toHaveProperty('bc1qraw_BITCOIN_MAINNET')

    await contactBook.clear()
    expect(contactBook.listContacts()).toEqual([])
  })

  it('propagates storage errors from init and sync paths', async () => {
    const errorStorage = new MockStorageAdapter()
    vi.spyOn(errorStorage, 'get').mockRejectedValueOnce(new Error('Storage error'))

    const service = new ContactBookService()
    await expect(service.init({ storage: errorStorage as any })).rejects.toThrow('Storage error')

    vi.spyOn(mockStorage, 'set').mockRejectedValueOnce(new Error('Sync error'))
    await expect(
      contactBook.addContact({
        name: 'sync',
        address: 'bc1qsync',
        chain: ChainType.BITCOIN_MAINNET,
        isContact: true,
        isAlias: false,
      })
    ).rejects.toThrow('Sync error')
  })
})
