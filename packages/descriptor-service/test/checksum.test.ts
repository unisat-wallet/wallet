import { describe, expect, it } from 'vitest'
import {
  descriptorChecksum,
  parseDescriptor,
  verifyDescriptorChecksum
} from '../src'

describe('BIP-380 checksum', () => {
  it('matches BIP vector raw(deadbeef)#89f8spxm', () => {
    expect(descriptorChecksum('raw(deadbeef)')).toBe('89f8spxm')
    expect(verifyDescriptorChecksum('raw(deadbeef)#89f8spxm')).toBe(true)
  })

  it('accepts checksummed wpkh with origin + wildcard', () => {
    const body =
      "wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)"
    const raw = `${body}#${descriptorChecksum(body)}`
    expect(raw.endsWith('#h36s06su')).toBe(true)
    const parsed = parseDescriptor(raw)
    expect(parsed.kind).toBe('wpkh')
    expect(parsed.policy.isComplex).toBe(false)
  })

  it('rejects missing checksum', () => {
    expect(() => parseDescriptor('wpkh(xpub...)')).toThrow(/checksum/i)
  })

  it('rejects bad checksum', () => {
    expect(() => parseDescriptor('raw(deadbeef)#qqqqqqqq')).toThrow(/invalid/i)
  })

  it('labels tr() singlesig', () => {
    const body =
      'tr([00000000/86h/0h/0h]xpub6BgBgsespWvERF3LHSw6pxgKvJT7WatA4owFbrMx5XfYTSUqvCFK8YrSTHhsrrNyrpCbwrcxdMzvQ5zZHnf8SHPX8KxdQdQdXXjtSGjzzX/0/*)'
    const raw = `${body}#${descriptorChecksum(body)}`
    const parsed = parseDescriptor(raw)
    expect(parsed.kind).toBe('tr')
    expect(parsed.policy.isComplex).toBe(false)
  })
})
