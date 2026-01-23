import { beforeEach, describe, expect, it } from 'vitest'
import { ReadonlyKeyring } from '../src/keyrings/readonly-keyring'
import { KeyringType } from '../src/types'

const testPubkeys = [
  '02b57a152325231723ee9faabba930108b19c11a391751572f380d71b447317ae7',
  '03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd',
  '025a651666675f65664364566f6f776572666c6f776572666c6f776572666c6f77',
]

describe('ReadonlyKeyring', () => {
  let keyring: ReadonlyKeyring

  beforeEach(() => {
    keyring = new ReadonlyKeyring([])
  })

  describe('Keyring.type', function () {
    it('is a class property that returns the type string.', function () {
      const { type } = ReadonlyKeyring
      expect(type).eq(KeyringType.ReadonlyKeyring)
    })

    it('instance has correct type property', function () {
      expect(keyring.type).eq(KeyringType.ReadonlyKeyring)
    })
  })

  describe('#constructor', function () {
    it('creates with empty pubkeys array', function () {
      const emptyKeyring = new ReadonlyKeyring([])
      expect(emptyKeyring.pubkeys).eql([])
    })

    it('creates with pubkeys', function () {
      const newKeyring = new ReadonlyKeyring(testPubkeys)
      expect(newKeyring.pubkeys).eql(testPubkeys)
    })
  })

  describe('#serialize', function () {
    it('serializes empty pubkeys', async function () {
      const output = await keyring.serialize()
      expect(output).eq('')
    })

    it('serializes pubkeys as comma-separated string', async function () {
      const newKeyring = new ReadonlyKeyring(testPubkeys)
      const output = await newKeyring.serialize()
      expect(output).eq(testPubkeys.join(','))
    })
  })

  describe('#deserialize', function () {
    it('deserializes empty string', async function () {
      await keyring.deserialize('')
      // empty string split by comma results in [''], which is the actual behavior
      expect(keyring.pubkeys).eql([''])
    })

    it('deserializes comma-separated pubkeys', async function () {
      const serialized = testPubkeys.join(',')
      await keyring.deserialize(serialized)
      expect(keyring.pubkeys).eql(testPubkeys)
    })

    it('serializes what it deserializes', async function () {
      const newKeyring = new ReadonlyKeyring(testPubkeys)
      const serialized = await newKeyring.serialize()

      const anotherKeyring = new ReadonlyKeyring([])
      await anotherKeyring.deserialize(serialized)
      expect(anotherKeyring.pubkeys).eql(testPubkeys)
    })
  })

  describe('#getAccounts', function () {
    it('returns empty array for empty keyring', async function () {
      const accounts = await keyring.getAccounts()
      expect(accounts).eql([])
    })

    it('returns all pubkeys', async function () {
      const newKeyring = new ReadonlyKeyring(testPubkeys)
      const accounts = await newKeyring.getAccounts()
      expect(accounts).eql(testPubkeys)
    })
  })

  describe('#addAccounts', function () {
    it('throws Method not implemented error', async function () {
      await expect(keyring.addAccounts(1)).rejects.toThrow('Method not implemented.')
    })
  })

  describe('#signTransaction', function () {
    it('throws Method not implemented error', async function () {
      await expect(async () => {
        await keyring.signTransaction({}, [])
      }).rejects.toThrow('Method not implemented.')
    })
  })

  describe('#signMessage', function () {
    it('throws Method not implemented error', async function () {
      await expect(async () => {
        await keyring.signMessage(testPubkeys[0], 'test message')
      }).rejects.toThrow('Method not implemented.')
    })
  })

  describe('#verifyMessage', function () {
    it('throws Method not implemented error', async function () {
      await expect(async () => {
        await keyring.verifyMessage(testPubkeys[0], 'test message', 'signature')
      }).rejects.toThrow('Method not implemented.')
    })
  })

  describe('#exportAccount', function () {
    it('throws Method not implemented error', async function () {
      await expect(async () => {
        await keyring.exportAccount(testPubkeys[0])
      }).rejects.toThrow('Method not implemented.')
    })
  })

  describe('#removeAccount', function () {
    it('throws Method not implemented error', function () {
      expect(() => keyring.removeAccount(testPubkeys[0])).throw('Method not implemented.')
    })
  })
})
