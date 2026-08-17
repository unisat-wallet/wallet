import { RgbServiceError } from '../errors'
import type { RgbInvoiceSeal } from './invoice'

/**
 * Turn an RGB witness beneficiary into the exact Bitcoin output script it
 * names. Blind beneficiaries deliberately have no transaction output.
 */
export function witnessSealToScriptPubKey(seal: Extract<RgbInvoiceSeal, { type: 'witness' }>) {
  const payload = seal.addressPayload
  switch (seal.addressType) {
    case 'p2pkh':
      if (payload.length !== 20)
        throw new RgbServiceError('RGB P2PKH beneficiary payload is invalid')
      return Uint8Array.from([0x76, 0xa9, 0x14, ...payload, 0x88, 0xac])
    case 'p2sh':
      if (payload.length !== 20)
        throw new RgbServiceError('RGB P2SH beneficiary payload is invalid')
      return Uint8Array.from([0xa9, 0x14, ...payload, 0x87])
    case 'p2wpkh':
      if (payload.length !== 20)
        throw new RgbServiceError('RGB P2WPKH beneficiary payload is invalid')
      return Uint8Array.from([0x00, 0x14, ...payload])
    case 'p2wsh':
      if (payload.length !== 32)
        throw new RgbServiceError('RGB P2WSH beneficiary payload is invalid')
      return Uint8Array.from([0x00, 0x20, ...payload])
    case 'p2tr':
      if (payload.length !== 32)
        throw new RgbServiceError('RGB P2TR beneficiary payload is invalid')
      return Uint8Array.from([0x51, 0x20, ...payload])
  }
}

/** Minimum standard Bitcoin output amount for each witness invoice beneficiary. */
export function witnessSealDustLimit(seal: Extract<RgbInvoiceSeal, { type: 'witness' }>) {
  switch (seal.addressType) {
    case 'p2pkh':
      return 546
    case 'p2sh':
      return 540
    case 'p2wpkh':
    case 'p2wsh':
    case 'p2tr':
      return 330
  }
}

export function invoiceSealToScriptPubKey(seal: RgbInvoiceSeal) {
  return seal.type === 'witness' ? witnessSealToScriptPubKey(seal) : undefined
}
