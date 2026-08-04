import { describe, expect, it } from 'vitest'
import {
  DescriptorAddressType,
  deriveAddresses,
  descriptorChecksum,
  hdAccountToDescriptor,
  hdAccountToDescriptorPair,
  normalizeMultipathImport,
  parseDescriptor,
  siblingChangeDescriptor,
  verifyDescriptorChecksum
} from '../src'

/**
 * Official BIP test vectors — abandon…about (master fpr 73c5da0a).
 * These are the Sparrow / Bitcoin Core interop anchors for PR1–PR5.
 */
const FPR = '73c5da0a'
const MNEMONIC_NOTE = 'abandon…about'

// Account-level xpubs from UniSat/hdkey (BIP-32 xpub, not SLIP-132 zpub)
const WPKH_XPUB =
  'xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V'
const TR_XPUB =
  'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ'

describe(`BIP vectors (${MNEMONIC_NOTE})`, () => {
  it('BIP-84 receive 0/1 and change 0', () => {
    const pair = hdAccountToDescriptorPair({
      addressType: DescriptorAddressType.P2WPKH,
      origin: { fingerprint: FPR, path: "m/84'/0'/0'" },
      xpub: WPKH_XPUB
    })
    expect(pair.receive.startsWith(`wpkh([${FPR}/84h/0h/0h]${WPKH_XPUB}/0/*)#`)).toBe(true)
    expect(verifyDescriptorChecksum(pair.receive)).toBe(true)
    expect(verifyDescriptorChecksum(pair.change)).toBe(true)

    const recv = deriveAddresses(pair.receive, { count: 2 })
    expect(recv[0]).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')
    expect(recv[1]).toBe('bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g')
    expect(deriveAddresses(pair.change, { count: 1 })[0]).toBe(
      'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el'
    )
    expect(siblingChangeDescriptor(pair.receive)).toBe(pair.change)
  })

  it('BIP-86 taproot receive 0', () => {
    const receive = hdAccountToDescriptor({
      addressType: DescriptorAddressType.P2TR,
      origin: { fingerprint: FPR, path: "m/86'/0'/0'" },
      xpub: TR_XPUB,
      chain: 0
    })
    expect(parseDescriptor(receive).kind).toBe('tr')
    expect(deriveAddresses(receive, { count: 1 })[0]).toBe(
      'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'
    )
    const change = siblingChangeDescriptor(receive)
    expect(change).toBeTruthy()
    expect(change!.includes('/1/*')).toBe(true)
  })

  it('Sparrow multipath /<0;1>/* expands to BIP-84 receive+change', () => {
    const multiBody = `wpkh([${FPR}/84h/0h/0h]${WPKH_XPUB}/<0;1>/*)`
    const multi = `${multiBody}#${descriptorChecksum(multiBody)}`
    const expanded = normalizeMultipathImport(multi)
    expect(expanded).toBeTruthy()
    const pair = hdAccountToDescriptorPair({
      addressType: DescriptorAddressType.P2WPKH,
      origin: { fingerprint: FPR, path: "m/84'/0'/0'" },
      xpub: WPKH_XPUB
    })
    expect(expanded!.receive).toBe(pair.receive)
    expect(expanded!.change).toBe(pair.change)
    expect(deriveAddresses(expanded!.receive, { count: 1 })[0]).toBe(
      'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
    )
  })

  it('checksum flip fails (polymod)', () => {
    const d = hdAccountToDescriptor({
      addressType: DescriptorAddressType.P2WPKH,
      origin: { fingerprint: FPR, path: '84h/0h/0h' },
      xpub: WPKH_XPUB
    })
    const flipped = d.slice(0, -1) + (d.endsWith('a') ? 'b' : 'a')
    expect(verifyDescriptorChecksum(flipped)).toBe(false)
    expect(() => parseDescriptor(flipped)).toThrow(/checksum|invalid/i)
  })

  it('policy labels are script-type wording', () => {
    const d = hdAccountToDescriptor({
      addressType: DescriptorAddressType.P2WPKH,
      origin: { fingerprint: FPR, path: '84h/0h/0h' },
      xpub: WPKH_XPUB
    })
    const { policy } = parseDescriptor(d)
    expect(policy.label.toLowerCase()).toContain('native segwit')
    expect(policy.label.toLowerCase()).toContain('script')
    expect(policy.isComplex).toBe(false)
  })
})
