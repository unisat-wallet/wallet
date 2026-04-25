import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import contactBookService, {
  ContactBookService,
  ExtensionContactBookItem,
  UIContactBookItem,
} from './contact-book-wrapper'
import { ContactBookService as CoreContactBookService } from '../src/contact-book'
import { ChainType } from '@unisat/wallet-types'

describe('ContactBookService (Extension-style wrapper)', () => {
  let contactBook: ContactBookService

  beforeEach(() => {
    // Mock console to reduce test output noise
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Create a new instance for each test (not singleton)
    contactBook = new ContactBookService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('should create a new instance successfully', () => {
      expect(contactBook).toBeDefined()
      expect(contactBook).toBeInstanceOf(ContactBookService)
      expect(contactBook).toBeInstanceOf(CoreContactBookService)
    })

    it('should initialize successfully', async () => {
      await expect(contactBook.init()).resolves.toBeUndefined()
    })

    it('should handle multiple init calls gracefully', async () => {
      await contactBook.init()
      await contactBook.init() // Second call should not cause issues

      expect(contactBook.listContacts()).toEqual([])
    })
  })

  describe('basic contact management', () => {
    beforeEach(async () => {
      await contactBook.init()
    })

    it('should add a contact successfully', async () => {
      const testContact: ExtensionContactBookItem = {
        name: 'Test Contact',
        address: 'bc1qtest123456789abcdef',
        chain: ChainType.BITCOIN_MAINNET,
        isContact: true,
        isAlias: false,
      }

      await contactBook.addContact(testContact)

      const contact = contactBook.getContactByAddress(testContact.address)
      expect(contact).toBeDefined()
      expect(contact?.name).toBe('Test Contact')
      expect(contact?.chain).toBe(ChainType.BITCOIN_MAINNET)
      expect(contact?.isContact).toBe(true)
    })

    it('should update contact', async () => {
      const testContact: ExtensionContactBookItem = {
        name: 'Original Name',
        address: 'bc1qupdate123456789abcdef',
        chain: ChainType.BITCOIN_MAINNET,
        isContact: true,
        isAlias: false,
      }

      await contactBook.addContact(testContact)

      const updatedContact = { ...testContact, name: 'Updated Name' }
      await contactBook.updateContact(updatedContact)

      const contact = contactBook.getContactByAddress(testContact.address)
      expect(contact?.name).toBe('Updated Name')
    })

    it('should remove contact', async () => {
      const testContact: ExtensionContactBookItem = {
        name: 'To Remove',
        address: 'bc1qremove123456789abcdef',
        chain: ChainType.BITCOIN_MAINNET,
        isContact: true,
        isAlias: false,
      }

      await contactBook.addContact(testContact)
      expect(contactBook.listContacts()).toHaveLength(1)

      await contactBook.removeContact(testContact.address, testContact.chain)
      expect(contactBook.listContacts()).toHaveLength(0)
    })

    it('should get contacts by address and chain', async () => {
      const testContact: ExtensionContactBookItem = {
        name: 'Address Test',
        address: 'bc1qaddress123456789abcdef',
        chain: ChainType.BITCOIN_MAINNET,
        isContact: true,
        isAlias: false,
      }

      await contactBook.addContact(testContact)

      const contact = contactBook.getContactByAddressAndChain(
        testContact.address,
        testContact.chain
      )
      expect(contact).toBeDefined()
      expect(contact?.name).toBe('Address Test')
    })

    it('should get contacts by map', () => {
      const contactsMap = contactBook.getContactsByMap()
      expect(contactsMap).toBeDefined()
      expect(typeof contactsMap).toBe('object')
    })

    it('should list contacts', async () => {
      const testContacts: ExtensionContactBookItem[] = [
        {
          name: 'Contact 1',
          address: 'bc1qcontact1123456789abcdef',
          chain: ChainType.BITCOIN_MAINNET,
          isContact: true,
          isAlias: false,
          sortIndex: 1,
        },
        {
          name: 'Contact 2',
          address: 'bc1qcontact2123456789abcdef',
          chain: ChainType.BITCOIN_MAINNET,
          isContact: true,
          isAlias: false,
          sortIndex: 2,
        },
      ]

      for (const contact of testContacts) {
        await contactBook.addContact(contact)
      }

      const contacts = contactBook.listContacts()
      expect(contacts).toHaveLength(2)

      // Should be sorted by sortIndex
      expect(contacts[0]?.name).toBe('Contact 1')
      expect(contacts[1]?.name).toBe('Contact 2')
    })
  })

  describe('alias management', () => {
    beforeEach(async () => {
      await contactBook.init()
    })

    it('should add and manage aliases', async () => {
      const aliasData = {
        address: 'bc1qalias123456789abcdef',
        name: 'Test Alias',
        chain: ChainType.BITCOIN_MAINNET,
      }

      await contactBook.addAlias(aliasData)

      const aliases = contactBook.listAlias()
      expect(aliases).toHaveLength(1)

      const alias = aliases[0]
      expect(alias?.name).toBe('Test Alias')
      expect(alias?.isAlias).toBe(true)
    })

    it('should update aliases', async () => {
      const aliasData = {
        address: 'bc1qupdate_alias123456789abcdef',
        name: 'Original Alias',
        chain: ChainType.BITCOIN_MAINNET,
      }

      await contactBook.addAlias(aliasData)

      await contactBook.updateAlias({
        ...aliasData,
        name: 'Updated Alias',
      })

      const aliases = contactBook.listAlias()
      const alias = aliases.find(a => a?.address === aliasData.address)
      expect(alias?.name).toBe('Updated Alias')
    })

    it('should remove aliases', async () => {
      const aliasData = {
        address: 'bc1qremove_alias123456789abcdef',
        name: 'To Remove Alias',
        chain: ChainType.BITCOIN_MAINNET,
      }

      await contactBook.addAlias(aliasData)
      expect(contactBook.listAlias()).toHaveLength(1)

      await contactBook.removeAlias(aliasData.address, aliasData.chain)
      expect(contactBook.listAlias()).toHaveLength(0)
    })
  })

  describe('multi-chain support', () => {
    beforeEach(async () => {
      await contactBook.init()
    })

    it('should handle different chain types', async () => {
      const chains = [
        ChainType.BITCOIN_MAINNET,
        ChainType.BITCOIN_TESTNET,
        ChainType.BITCOIN_SIGNET,
        ChainType.FRACTAL_BITCOIN_MAINNET,
        ChainType.FRACTAL_BITCOIN_TESTNET,
      ]

      for (let i = 0; i < chains.length; i++) {
        await contactBook.addContact({
          name: `Contact ${i}`,
          address: `bc1qchain${i}123456789abcdef`,
          chain: chains[i],
          isContact: true,
          isAlias: false,
        })
      }

      const contacts = contactBook.listContacts()
      expect(contacts).toHaveLength(chains.length)

      const uniqueChains = new Set(contacts.map(c => c.chain))
      expect(uniqueChains.size).toBe(chains.length)
    })

    it('should distinguish same address on different chains', async () => {
      const sameAddress = 'bc1qsame123456789abcdef'

      await contactBook.addContact({
        name: 'Mainnet Contact',
        address: sameAddress,
        chain: ChainType.BITCOIN_MAINNET,
        isContact: true,
        isAlias: false,
      })

      await contactBook.addContact({
        name: 'Testnet Contact',
        address: sameAddress,
        chain: ChainType.BITCOIN_TESTNET,
        isContact: true,
        isAlias: false,
      })

      const contacts = contactBook.listContacts()
      expect(contacts).toHaveLength(2)

      const mainnetContact = contactBook.getContactByAddressAndChain(
        sameAddress,
        ChainType.BITCOIN_MAINNET
      )
      const testnetContact = contactBook.getContactByAddressAndChain(
        sameAddress,
        ChainType.BITCOIN_TESTNET
      )

      expect(mainnetContact?.name).toBe('Mainnet Contact')
      expect(testnetContact?.name).toBe('Testnet Contact')
    })
  })

  describe('data persistence and sync', () => {
    beforeEach(async () => {
      await contactBook.init()
    })

    it('should save contacts order', async () => {
      const testContacts: ExtensionContactBookItem[] = [
        {
          name: 'Contact A',
          address: 'bc1qcontacta123456789abcdef',
          chain: ChainType.BITCOIN_MAINNET,
          isContact: true,
          isAlias: false,
          sortIndex: 1,
        },
        {
          name: 'Contact B',
          address: 'bc1qcontactb123456789abcdef',
          chain: ChainType.BITCOIN_MAINNET,
          isContact: true,
          isAlias: false,
          sortIndex: 2,
        },
      ]

      for (const contact of testContacts) {
        await contactBook.addContact(contact)
      }

      const contacts = contactBook.listContacts()
      // Reverse the order
      const reversedOrder = [...contacts].reverse()

      await contactBook.saveContactsOrder(reversedOrder)
      const newOrder = contactBook.listContacts()

      // Should now be in reversed order
      expect(newOrder[0]?.name).toBe('Contact B')
      expect(newOrder[1]?.name).toBe('Contact A')
    })

    it('should clear all data', async () => {
      await contactBook.addContact({
        name: 'To Clear',
        address: 'bc1qclear123456789abcdef',
        chain: ChainType.BITCOIN_MAINNET,
        isContact: true,
        isAlias: false,
      })

      expect(contactBook.listContacts()).toHaveLength(1)

      await contactBook.clear()

      expect(contactBook.listContacts()).toHaveLength(0)
    })

    it('should get raw store data', async () => {
      await contactBook.addContact({
        name: 'Raw Store Test',
        address: 'bc1qraw123456789abcdef',
        chain: ChainType.BITCOIN_MAINNET,
        isContact: true,
        isAlias: false,
      })

      const rawStore = contactBook.getRawStore()
      expect(rawStore).toBeDefined()
      expect(typeof rawStore).toBe('object')

      const keys = Object.keys(rawStore)
      expect(keys).toHaveLength(1)
      expect(keys[0]).toContain('bc1qraw123456789abcdef_BITCOIN_MAINNET')
    })
  })

  describe('extension compatibility', () => {
    it('should use the singleton instance', () => {
      expect(contactBookService).toBeDefined()
      expect(contactBookService).toBeInstanceOf(ContactBookService)
    })

    it('should have compatible interface types', () => {
      const extensionItem: ExtensionContactBookItem = {
        name: 'Test',
        address: 'bc1qtest123',
        chain: ChainType.BITCOIN_MAINNET,
        isAlias: false,
        isContact: true,
        sortIndex: 1,
      }

      expect(extensionItem).toBeDefined()
      expect(typeof extensionItem.name).toBe('string')
      expect(typeof extensionItem.address).toBe('string')
      expect(typeof extensionItem.chain).toBe('string')
      expect(typeof extensionItem.isAlias).toBe('boolean')
      expect(typeof extensionItem.isContact).toBe('boolean')
    })

    it('should have UI compatible interface', () => {
      const uiItem: UIContactBookItem = {
        name: 'UI Test',
        address: 'bc1quitest123',
      }

      expect(uiItem).toBeDefined()
      expect(typeof uiItem.name).toBe('string')
      expect(typeof uiItem.address).toBe('string')
    })
  })

  describe('edge cases and error handling', () => {
    beforeEach(async () => {
      await contactBook.init()
    })

    it('should handle empty state correctly', () => {
      expect(contactBook.listContacts()).toEqual([])
      expect(contactBook.listAlias()).toEqual([])
      expect(contactBook.getContactsByMap()).toEqual({})
    })

    it('should handle operations on non-existent contacts', async () => {
      const nonExistentContact = contactBook.getContactByAddress('bc1qnonexistent')
      expect(nonExistentContact).toBeUndefined()

      const nonExistentByChain = contactBook.getContactByAddressAndChain(
        'bc1qnonexistent',
        ChainType.BITCOIN_MAINNET
      )
      expect(nonExistentByChain).toBeUndefined()

      // These should not throw
      await expect(
        contactBook.removeContact('bc1qnonexistent', ChainType.BITCOIN_MAINNET)
      ).resolves.not.toThrow()
      await expect(
        contactBook.removeAlias('bc1qnonexistent', ChainType.BITCOIN_MAINNET)
      ).resolves.not.toThrow()
    })
  })
})
