import { describe, expect, it } from 'vitest'
import { hdAccountToDescriptor, parseDescriptor, verifyDescriptorChecksum } from '../src'
import { DescriptorAddressType } from '../src/types'

const WPKH_XPUB =
  'xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V'

describe('hdAccountToDescriptor origin handling', () => {
  it('includes origin when fingerprint is real', () => {
    const d = hdAccountToDescriptor({
      addressType: DescriptorAddressType.P2WPKH,
      origin: { fingerprint: '73c5da0a', path: "m/84'/0'/0'" },
      xpub: WPKH_XPUB,
      chain: 0
    })
    expect(d.startsWith('wpkh([73c5da0a/84h/0h/0h]')).toBe(true)
    expect(verifyDescriptorChecksum(d)).toBe(true)
  })

  it('omits origin when fingerprint is missing (never invents 00000000)', () => {
    const d = hdAccountToDescriptor({
      addressType: DescriptorAddressType.P2WPKH,
      xpub: WPKH_XPUB,
      xpubLevel: 'chain'
    })
    expect(d.includes('[')).toBe(false)
    expect(d.includes('00000000')).toBe(false)
    expect(d.startsWith('wpkh(')).toBe(true)
    expect(verifyDescriptorChecksum(d)).toBe(true)
    expect(parseDescriptor(d).policy.kind).toBe('wpkh')
  })

  it('omits origin when fingerprint is all zeros', () => {
    const d = hdAccountToDescriptor({
      addressType: DescriptorAddressType.P2WPKH,
      origin: { fingerprint: '00000000', path: "m/84'/0'/0'/0" },
      xpub: WPKH_XPUB,
      xpubLevel: 'chain'
    })
    expect(d.includes('00000000')).toBe(false)
    expect(d.includes('[')).toBe(false)
  })
})
