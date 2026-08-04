import { describe, expect, it } from 'vitest'
import { HdKeyring } from '../src/keyrings/hd-keyring'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('HdKeyring.getAccountXpubMaterial', () => {
  it('returns BIP84 account-level xpub + fingerprint', () => {
    const keyring = new HdKeyring({
      mnemonic: MNEMONIC,
      hdPath: "m/84'/0'/0'/0",
      activeIndexes: [0]
    })
    const material = keyring.getAccountXpubMaterial()
    expect(material.fingerprint).toBe('73c5da0a')
    expect(material.accountPath).toBe("m/84'/0'/0'")
    expect(material.xpubLevel).toBe('account')
    expect(material.xpub).toBe(
      'xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V'
    )
  })

  it('returns BIP86 account-level xpub', () => {
    const keyring = new HdKeyring({
      mnemonic: MNEMONIC,
      hdPath: "m/86'/0'/0'/0",
      activeIndexes: [0]
    })
    const material = keyring.getAccountXpubMaterial()
    expect(material.fingerprint).toBe('73c5da0a')
    expect(material.accountPath).toBe("m/86'/0'/0'")
    expect(material.xpubLevel).toBe('account')
    expect(material.xpub).toBe(
      'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ'
    )
  })

  it('uses chain-level xpub for short OW-style path without change segment', () => {
    const keyring = new HdKeyring({
      mnemonic: MNEMONIC,
      hdPath: "m/86'/0'/0'",
      activeIndexes: [0]
    })
    const material = keyring.getAccountXpubMaterial()
    expect(material.xpubLevel).toBe('chain')
    expect(material.accountPath).toBe("m/86'/0'/0'")
    expect(material.fingerprint).toBe('73c5da0a')
  })

  it('refuses multi-account short-path ranged export', () => {
    const keyring = new HdKeyring({
      mnemonic: MNEMONIC,
      hdPath: "m/86'/0'/0'",
      activeIndexes: [0],
      accountIndexDerivation: true
    })
    expect(() => keyring.getAccountXpubMaterial(0)).toThrow(/multi-account short-path/i)
  })

  it('omits fingerprint for xpriv-only roots (never invent wrong origin)', () => {
    const fromMnemonic = new HdKeyring({
      mnemonic: MNEMONIC,
      hdPath: "m/84'/0'/0'/0",
      activeIndexes: [0]
    })
    // Account-level xpriv would be wrong as "master"; use the account node xpriv
    // via serialize is hard — instead build from known account xpriv of abandon seed.
    // Root master xpriv: fingerprint would still be of that node if not mnemonic-rooted.
    const master = fromMnemonic as any
    const xpriv = master.hdWallet.privateExtendedKey as string
    const xprivOnly = new HdKeyring({
      xpriv,
      hdPath: "m/84'/0'/0'/0",
      activeIndexes: [0]
    })
    const material = xprivOnly.getAccountXpubMaterial()
    expect(material.fingerprint).toBeUndefined()
    expect(material.xpub).toBeTruthy()
  })
})
