import { ToSignInput } from '@unisat/keyring-service/types'
import { Risk, RiskType } from '@unisat/wallet-shared'
import { bitcoin } from '@unisat/wallet-bitcoin'
import { tapleafHash } from 'bitcoinjs-lib/src/payments/bip341.js'

function isP2sh(script: Buffer) {
  return (
    script.length === 23 &&
    script[0] === bitcoin.opcodes['OP_HASH160'] &&
    script[1] === 0x14 &&
    script[22] === bitcoin.opcodes['OP_EQUAL']
  )
}

function isP2wsh(script: Buffer) {
  return script.length === 34 && script[0] === bitcoin.opcodes['OP_0'] && script[1] === 0x20
}

function isP2tr(script: Buffer) {
  return script.length === 34 && script[0] === bitcoin.opcodes['OP_1'] && script[1] === 0x20
}

function getPrevoutScript(psbt: bitcoin.Psbt, inputIndex: number) {
  const input = psbt.data.inputs[inputIndex]
  if (!input) return
  if (input.nonWitnessUtxo) {
    const transaction = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo)
    return transaction.outs[psbt.txInputs[inputIndex]!.index]?.script
  }
  return input.witnessUtxo?.script
}

function getMeaningfulScript(psbt: bitcoin.Psbt, inputIndex: number) {
  const input = psbt.data.inputs[inputIndex]
  const prevoutScript = getPrevoutScript(psbt, inputIndex)
  if (!input || !prevoutScript) return

  if (isP2sh(prevoutScript)) {
    if (!input.redeemScript) return
    if (isP2wsh(input.redeemScript)) return input.witnessScript
    return input.redeemScript
  }
  if (isP2wsh(prevoutScript)) return input.witnessScript
  return prevoutScript
}

function pubkeyInScript(pubkey: Buffer, script: Buffer) {
  const chunks = bitcoin.script.decompile(script)
  if (!chunks) return false

  const pubkeyHash = bitcoin.crypto.hash160(pubkey)
  const xOnlyPubkey = pubkey.length === 32 ? pubkey : pubkey.slice(1, 33)
  return chunks.some(
    chunk =>
      Buffer.isBuffer(chunk) &&
      (chunk.equals(pubkey) || chunk.equals(pubkeyHash) || chunk.equals(xOnlyPubkey))
  )
}

function selectedTapleafDoesNotReferencePubkey(
  input: bitcoin.Psbt['data']['inputs'][number],
  pubkey: Buffer,
  tapLeafHashToSign: Buffer | string | undefined
) {
  if (!tapLeafHashToSign) return false
  const selectedHash = Buffer.isBuffer(tapLeafHashToSign)
    ? tapLeafHashToSign
    : Buffer.from(tapLeafHashToSign, 'hex')
  const selectedLeaf = input.tapLeafScript?.find(tapLeaf =>
    tapleafHash({ output: tapLeaf.script, version: tapLeaf.leafVersion }).equals(selectedHash)
  )
  return selectedLeaf ? !pubkeyInScript(pubkey, selectedLeaf.script) : false
}

/**
 * Detects inputs that bitcoinjs-lib's upstream checkScriptForPubkey would reject.
 * The wallet permits these signatures for specialized protocols, but surfaces an
 * explicit, user-confirmable warning in the normal SignPsbt approval flow.
 */
export function getSigningPubkeyRisk(
  psbtHex: string,
  toSignInputs: ToSignInput[] | undefined
): Risk | undefined {
  if (!toSignInputs?.length) return

  const psbt = bitcoin.Psbt.fromHex(psbtHex)
  const hasUnverifiedInput = toSignInputs.some(toSignInput => {
    const input = psbt.data.inputs[toSignInput.index]
    const prevoutScript = getPrevoutScript(psbt, toSignInput.index)
    if (!input || !prevoutScript) return false

    const pubkey = Buffer.from(toSignInput.publicKey, 'hex')
    if (isP2tr(prevoutScript)) {
      // Without an explicit leaf selection, the patched bitcoinjs-lib retains
      // the upstream pubkey filter. Specialized leaves may bypass that filter
      // only when the caller selects their exact hash, which requires warning.
      return selectedTapleafDoesNotReferencePubkey(
        input,
        pubkey,
        toSignInput.tapLeafHashToSign
      )
    }

    const script = getMeaningfulScript(psbt, toSignInput.index)
    if (!script) return false

    try {
      return !pubkeyInScript(pubkey, script)
    } catch {
      return false
    }
  })

  if (!hasUnverifiedInput) return
  return {
    type: RiskType.SIGNING_PUBKEY_NOT_IN_SCRIPT,
    level: 'danger',
    title: 'signing_pubkey_not_in_script_risk_title',
    desc: 'signing_pubkey_not_in_script_risk_description',
  }
}
