import { ed25519 } from '@noble/curves/ed25519'
import {
  serializeBfaValidationAttestation,
  type BfaValidationAttestationPayload,
} from '@unisat/rgb-service'
import { describe, expect, it } from 'vitest'
import { verifyRgbValidationAttestation } from '../src/rgb/RgbValidationAttestation'

describe('RGB validation attestation trust', () => {
  const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
  const publicKey = Buffer.from(ed25519.getPublicKey(privateKey)).toString('hex')
  const payload: BfaValidationAttestationPayload = {
    version: 1,
    validatorVersion: 'bfa-v1-2026-10-26',
    network: 3,
    payloadHash: '11'.repeat(32),
    assetId: 'rgb:test',
    genesisHash: '22'.repeat(32),
    hasDynamicRejectList: false,
    bundles: [],
    expiresAt: 1000,
  }
  const signed = {
    payload,
    publicKey,
    signature: Buffer.from(
      ed25519.sign(serializeBfaValidationAttestation(payload), privateKey)
    ).toString('hex'),
  }

  it('accepts only an intact signature from a release-pinned key', () => {
    expect(verifyRgbValidationAttestation(signed, [publicKey])).toBe(true)
    expect(verifyRgbValidationAttestation(signed, ['33'.repeat(32)])).toBe(false)
    expect(
      verifyRgbValidationAttestation(
        {
          ...signed,
          payload: { ...payload, network: 2 },
        },
        [publicKey]
      )
    ).toBe(false)
  })
})
