import { ed25519 } from '@noble/curves/ed25519'
import {
  serializeBfaValidationAttestation,
  type BfaValidationAttestationPayload,
  type SignedBfaValidationAttestation,
} from '@unisat/rgb-service'

/** Verify an attestation only against release-pinned keys; the response key is never self-trusted. */
export function verifyRgbValidationAttestation(
  signed: SignedBfaValidationAttestation,
  trustedPublicKeys: string[]
): signed is SignedBfaValidationAttestation & { payload: BfaValidationAttestationPayload } {
  try {
    const publicKey = signed.publicKey.toLowerCase()
    return (
      /^[0-9a-f]{64}$/.test(publicKey) &&
      /^[0-9a-f]{128}$/i.test(signed.signature) &&
      trustedPublicKeys.some(key => key.toLowerCase() === publicKey) &&
      ed25519.verify(
        Buffer.from(signed.signature, 'hex'),
        serializeBfaValidationAttestation(signed.payload),
        Buffer.from(publicKey, 'hex')
      )
    )
  } catch {
    return false
  }
}
