import { RgbServiceError } from '../errors'

export interface BitcoinOutput {
  value: bigint
  scriptPubKey: Uint8Array
}

export interface OpretAnchor {
  outputs: BitcoinOutput[]
  hostVout: number
  inserted: boolean
}

const OP_RETURN = 0x6a

function isOpReturn(scriptPubKey: Uint8Array) {
  return scriptPubKey[0] === OP_RETURN
}

/** P2TR v1 witness program: OP_1 PUSH32 <xonly key>. */
export function isP2trScript(scriptPubKey: Uint8Array) {
  return scriptPubKey.length === 34 && scriptPubKey[0] === 0x51 && scriptPubKey[1] === 0x20
}

/**
 * Apply rgb-lib's OpretFirst host placement rule before a commitment is added:
 * insert an empty OP_RETURN at vout 0 when the transaction has Taproot outputs,
 * otherwise append it. Existing OP_RETURN outputs are retained as supplied.
 */
export function ensureOpretAnchor(outputs: readonly BitcoinOutput[]): OpretAnchor {
  const existingVout = outputs.findIndex(output => isOpReturn(output.scriptPubKey))
  if (existingVout >= 0) {
    return { outputs: [...outputs], hostVout: existingVout, inserted: false }
  }

  const host = { value: 0n, scriptPubKey: Uint8Array.from([OP_RETURN]) }
  const opretFirst = outputs.some(output => isP2trScript(output.scriptPubKey))
  const anchored = opretFirst ? [host, ...outputs] : [...outputs, host]
  return { outputs: anchored, hostVout: opretFirst ? 0 : outputs.length, inserted: true }
}

/**
 * Replace an Opret host with a canonical direct push. RGB commitments used by
 * the local encoder must fit this 75-byte direct-push form or use a dedicated
 * PSBT codec that supports the required script encoding.
 */
export function setOpretHostPayload(anchor: OpretAnchor, payload: Uint8Array): OpretAnchor {
  if (payload.length > 75) {
    throw new RgbServiceError('RGB Opret commitment exceeds direct push capacity')
  }
  const output = anchor.outputs[anchor.hostVout]
  if (!output || !isOpReturn(output.scriptPubKey)) {
    throw new RgbServiceError('RGB Opret host output is missing')
  }

  const outputs = [...anchor.outputs]
  outputs[anchor.hostVout] = {
    ...output,
    scriptPubKey: Uint8Array.from([OP_RETURN, payload.length, ...payload]),
  }
  return { ...anchor, outputs }
}
