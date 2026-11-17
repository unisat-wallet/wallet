import { Psbt } from 'bitcoinjs-lib'
import { RgbServiceError } from '../errors'

export interface CompletedRgbOpretPsbt {
  rawTx: string
  txid: string
}

function parsePsbt(value: string) {
  try {
    return Psbt.fromHex(value)
  } catch {
    try {
      return Psbt.fromBase64(value)
    } catch {
      throw new RgbServiceError('RGB signed transaction is not a valid PSBT')
    }
  }
}

function unsignedTransactionBytes(psbt: Psbt) {
  const transaction = (psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx
  if (!transaction?.toBuffer)
    throw new RgbServiceError('RGB PSBT is missing its unsigned transaction')
  return Buffer.from(transaction.toBuffer())
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * Verify the completed PSBT still contains the exact locally committed
 * unsigned transaction before extracting it for RGB Fascia construction and
 * broadcast. A signer may add signatures but must not alter inputs/outputs.
 */
export function completeRgbOpretPsbt(input: {
  preparedPsbt: string
  signedPsbt: string
  hostVout: number
  commitment: Uint8Array
  allowIncomplete?: boolean
}): CompletedRgbOpretPsbt {
  if (input.commitment.length !== 32)
    throw new RgbServiceError('RGB OP_RETURN commitment must be 32 bytes')
  const prepared = parsePsbt(input.preparedPsbt)
  const signed = parsePsbt(input.signedPsbt)
  if (!sameBytes(unsignedTransactionBytes(prepared), unsignedTransactionBytes(signed))) {
    throw new RgbServiceError('Signed RGB PSBT changed the committed transaction')
  }
  const hostOutput = signed.txOutputs[input.hostVout]
  const expectedScript = Buffer.from([0x6a, 0x20, ...input.commitment])
  if (!hostOutput || !hostOutput.script.equals(expectedScript)) {
    throw new RgbServiceError('Signed RGB PSBT does not preserve its OP_RETURN commitment')
  }

  if (input.allowIncomplete) {
    // RGB's OpretFirst witness commits to the unsigned transaction. This is
    // used for seller-side swap consignment publication before the buyer has
    // signed. If a later caller supplies a finalized PSBT, preserve its
    // witnesses so node preflight validates the transaction that will really
    // be broadcast instead of the unsigned transaction skeleton.
    try {
      const transaction = signed.extractTransaction()
      return { rawTx: transaction.toHex(), txid: transaction.getId() }
    } catch {
      // The initial seller publication is intentionally not fully signed.
    }
    const transaction = (signed.data.globalMap.unsignedTx as any).tx || signed.data.globalMap.unsignedTx
    if (!transaction?.toHex || !transaction?.getId)
      throw new RgbServiceError('RGB PSBT is missing its unsigned transaction')
    return { rawTx: transaction.toHex(), txid: transaction.getId() }
  }
  try {
    const transaction = signed.extractTransaction()
    return { rawTx: transaction.toHex(), txid: transaction.getId() }
  } catch {
    throw new RgbServiceError('Signed RGB PSBT is not fully finalized')
  }
}
