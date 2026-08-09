import { describe, expect, it } from 'vitest'
import {
  DescriptorAddressType,
  deriveAddresses,
  hdAccountToDescriptor,
  hdAccountToDescriptorPair,
  parseDescriptor
} from '../src'

// BIP-39 abandon…about — BIP84/86 account-level vectors
const FPR = '73c5da0a'
const WPKH_XPUB =
  'xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V'
const TR_XPUB =
  'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ'
const WPKH_ADDR0 = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
const TR_ADDR0 = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'

describe('hdAccountToDescriptor + deriveAddresses', () => {
  it('round-trips UniSat Native SegWit (BIP84)', () => {
    const desc = hdAccountToDescriptor({
      addressType: DescriptorAddressType.P2WPKH,
      origin: { fingerprint: FPR, path: "m/84'/0'/0'" },
      xpub: WPKH_XPUB,
      chain: 0
    })
    expect(desc.startsWith(`wpkh([${FPR}/84h/0h/0h]${WPKH_XPUB}/0/*)#`)).toBe(true)
    const parsed = parseDescriptor(desc)
    expect(parsed.kind).toBe('wpkh')
    expect(deriveAddresses(desc, { count: 1 })[0]).toBe(WPKH_ADDR0)
  })

  it('round-trips UniSat Taproot (BIP86)', () => {
    const desc = hdAccountToDescriptor({
      addressType: DescriptorAddressType.P2TR,
      origin: { fingerprint: FPR, path: '86h/0h/0h' },
      xpub: TR_XPUB
    })
    expect(parseDescriptor(desc).kind).toBe('tr')
    expect(deriveAddresses(desc, { count: 1 })[0]).toBe(TR_ADDR0)
  })

  it('builds receive/change pair', () => {
    const pair = hdAccountToDescriptorPair({
      addressType: DescriptorAddressType.P2WPKH,
      origin: { fingerprint: FPR, path: '84h/0h/0h' },
      xpub: WPKH_XPUB
    })
    expect(pair.receive.includes('/0/*')).toBe(true)
    expect(pair.change.includes('/1/*')).toBe(true)
    expect(deriveAddresses(pair.receive)[0]).toBe(WPKH_ADDR0)
  })

  it('derives a range of addresses', () => {
    const desc = hdAccountToDescriptor({
      addressType: DescriptorAddressType.P2WPKH,
      origin: { fingerprint: FPR, path: '84h/0h/0h' },
      xpub: WPKH_XPUB
    })
    const addrs = deriveAddresses(desc, { start: 0, count: 3 })
    expect(addrs).toHaveLength(3)
    expect(addrs[0]).toBe(WPKH_ADDR0)
    expect(new Set(addrs).size).toBe(3)
  })

  it('rejects private xprv material', async () => {
    const { extractSinglesigKey } = await import('../src')
    expect(() =>
      extractSinglesigKey(
        'wpkh(xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi/0/*)'
      )
    ).toThrow(/Private|xprv/i)
  })

  it('rejects raw multipath in extract; normalize expands Sparrow /<0;1>/*', async () => {
    const { descriptorChecksum, extractSinglesigKey, normalizeMultipathImport } = await import(
      '../src'
    )
    expect(() => extractSinglesigKey(`wpkh(${WPKH_XPUB}/<0;1>/*)`)).toThrow(/Multipath|normalize/i)
    expect(() => extractSinglesigKey(`wpkh(${WPKH_XPUB}/0h/*)`)).toThrow(/Hardened/i)

    const multiBody = `wpkh([${FPR}/84h/0h/0h]${WPKH_XPUB}/<0;1>/*)`
    const multi = `${multiBody}#${descriptorChecksum(multiBody)}`
    const expanded = normalizeMultipathImport(multi)
    expect(expanded).toBeTruthy()
    expect(expanded!.receive.includes('/0/*')).toBe(true)
    expect(expanded!.change.includes('/1/*')).toBe(true)
    expect(deriveAddresses(expanded!.receive, { count: 1 })[0]).toBe(WPKH_ADDR0)
    expect(normalizeMultipathImport(expanded!.receive)).toBeNull()
  })

  it('rejects exotic multipath and out-of-range derive indices', async () => {
    const { descriptorChecksum, normalizeMultipathImport } = await import('../src')
    const badBody = `wpkh([${FPR}/84h/0h/0h]${WPKH_XPUB}/<1;0>/*)`
    const bad = `${badBody}#${descriptorChecksum(badBody)}`
    expect(() => normalizeMultipathImport(bad)).toThrow(/multipath|Sparrow/i)

    const desc = hdAccountToDescriptor({
      addressType: DescriptorAddressType.P2WPKH,
      origin: { fingerprint: FPR, path: '84h/0h/0h' },
      xpub: WPKH_XPUB
    })
    expect(() => deriveAddresses(desc, { start: -1, count: 1 })).toThrow(/start/i)
    expect(() => deriveAddresses(desc, { start: 0x7fffffff, count: 2 })).toThrow(/index|start\+count/i)
    expect(() => deriveAddresses(desc, { network: 'testnet', count: 1 })).toThrow(/network|xpub|tpub/i)
  })

  it('rejects fixed-path descriptors without /* (no silent wrong gap)', async () => {
    const { descriptorChecksum } = await import('../src')
    const body = `wpkh(${WPKH_XPUB}/0/0)`
    const fixed = `${body}#${descriptorChecksum(body)}`
    expect(() => deriveAddresses(fixed, { count: 2 })).toThrow(/Ranged|\/\*/i)
  })

  it('rejects origin-path /* phishing (wildcard only after xpub)', async () => {
    const { descriptorChecksum, extractSinglesigKey } = await import('../src')
    // Crafted: /* sits inside origin; key expr is fixed /0/0 — must not derive a fake gap
    const body = `wpkh([${FPR}/84h/*/0h]${WPKH_XPUB}/0/0)`
    const crafted = `${body}#${descriptorChecksum(body)}`
    expect(() => deriveAddresses(crafted, { count: 2 })).toThrow()
    expect(() => extractSinglesigKey(body)).toThrow()
  })

  it('rejects non-standard chain wildcards like /2/*', async () => {
    const { extractSinglesigKey } = await import('../src')
    expect(() => extractSinglesigKey(`wpkh(${WPKH_XPUB}/2/*)`)).toThrow(/\/\*|0\/\*|1\/\*/i)
  })

  it('rejects SLIP-132 with a clear error', async () => {
    const { extractSinglesigKey } = await import('../src')
    expect(() =>
      extractSinglesigKey(
        'wpkh(zpub6rFR7y4Q2PFmgxNfZRFeATDvyUyQpcnEd3fxeiwq884RgE8zxX5NwGLhD8y4K6zqH4xK5vQxJzqH4xK5vQxJzqH4xK5vQxJzqH4xK5vQxJ/0/*)'
      )
    ).toThrow(/SLIP-132|zpub/i)
  })

  it('builds chain-level descriptor (OW short path)', () => {
    const desc = hdAccountToDescriptor({
      addressType: DescriptorAddressType.P2TR,
      origin: { fingerprint: FPR, path: "m/86'/0'/0'" },
      xpub: TR_XPUB,
      xpubLevel: 'chain'
    })
    expect(desc.includes(`${TR_XPUB}/*)#`)).toBe(true)
    expect(desc.includes('/0/*')).toBe(false)
  })

  it('builds sibling change descriptor from receive', async () => {
    const { siblingChangeDescriptor } = await import('../src')
    const receive = hdAccountToDescriptor({
      addressType: DescriptorAddressType.P2WPKH,
      origin: { fingerprint: FPR, path: '84h/0h/0h' },
      xpub: WPKH_XPUB,
      chain: 0
    })
    const change = siblingChangeDescriptor(receive)
    expect(change).toBeTruthy()
    expect(change!.includes('/1/*')).toBe(true)
    expect(parseDescriptor(change!).kind).toBe('wpkh')
  })
})
