import { Psbt, networks } from 'bitcoinjs-lib'
import { RgbServiceError } from '../errors'
import type { RgbFeeFunding, RgbFeeUtxo, RgbNetwork, RgbUtxo } from '../types'
import type { RgbInvoiceSeal } from './invoice'
import { invoiceSealToScriptPubKey, witnessSealDustLimit } from './witness'

export interface RgbOpretPsbtRequest {
  network: RgbNetwork
  selectedUtxos: RgbUtxo[]
  recipientSeal: RgbInvoiceSeal
  feeRate: number
  /** Required for witness beneficiaries and must be a standard dust-safe amount. */
  witnessAmountSat?: number
  enableRbf?: boolean
  preserveFundingOutput: boolean
  feeFunding?: RgbFeeFunding
}

export interface RgbOpretPsbt {
  psbtHex: string
  hostVout: number
  recipientVout?: number
  changeVout?: number
  fee: number
  feeInputCount: number
  feeOutpoints: RgbFeeUtxo['outpoint'][]
}

function scriptBytes(value: string, name: string) {
  if (!/^[0-9a-f]*$/i.test(value) || value.length % 2) {
    throw new RgbServiceError(`${name} must be hexadecimal`)
  }
  return Buffer.from(value, 'hex')
}

function publicKeyBytes(value: string) {
  const publicKey = scriptBytes(value, 'RGB UTXO public key')
  if (publicKey.length !== 33 || (publicKey[0] !== 0x02 && publicKey[0] !== 0x03)) {
    throw new RgbServiceError('RGB UTXO public key must be compressed')
  }
  return publicKey
}

function isTaprootScript(script: Buffer) {
  return script.length === 34 && script[0] === 0x51 && script[1] === 0x20
}

function isP2wpkhScript(script: Buffer) {
  return script.length === 22 && script[0] === 0x00 && script[1] === 0x14
}

function addFeeInput(psbt: Psbt, utxo: RgbFeeUtxo, enableRbf?: boolean) {
  const script = scriptBytes(utxo.scriptPubKey, 'RGB fee UTXO script')
  const publicKey = publicKeyBytes(utxo.publicKey)
  const input: any = {
    hash: utxo.outpoint.txid,
    index: utxo.outpoint.vout,
    witnessUtxo: { value: utxo.satoshis, script },
    ...(enableRbf === false ? {} : { sequence: 0xfffffffd }),
  }
  if (isTaprootScript(script)) input.tapInternalKey = publicKey.slice(1)
  psbt.addInput(input)
}

function compactSizeLength(value: number) {
  if (value < 0xfd) return 1
  if (value <= 0xffff) return 3
  if (value <= 0xffff_ffff) return 5
  return 9
}

function outputSize(script: Uint8Array) {
  return 8 + compactSizeLength(script.length) + script.length
}

// The PSBT starts with an empty OP_RETURN host, then commitOpretRgbPsbt replaces it
// with OP_RETURN + a 32-byte MPC commitment before signing and broadcasting.
const OPRET_RGB_COMMITMENT_SCRIPT_SIZE = 34

/** Conservative vsize estimate for P2TR RGB inputs and standard SegWit BTC fee inputs. */
function estimateSegwitVsize(inputScripts: Uint8Array[], outputScripts: Uint8Array[]) {
  const witnessInputBytes = inputScripts.reduce((size, value) => {
    const script = Buffer.from(value)
    if (isTaprootScript(script)) return size + 66 // item count, item length, 64-byte Schnorr signature.
    if (isP2wpkhScript(script)) return size + 109 // stack and worst-case DER signature plus compressed pubkey.
    throw new RgbServiceError('RGB fee UTXOs must be P2WPKH or P2TR')
  }, 0)
  const base =
    4 +
    compactSizeLength(inputScripts.length) +
    inputScripts.length * 41 +
    compactSizeLength(outputScripts.length) +
    outputScripts.reduce((size, script) => size + outputSize(script), 0) +
    4
  const witness = 2 + witnessInputBytes
  return Math.ceil((base * 4 + witness) / 4)
}

function bitcoinNetwork(network: RgbNetwork) {
  return network === 'mainnet' ? networks.bitcoin : networks.testnet
}

function validateRequest(input: RgbOpretPsbtRequest) {
  if (!input.selectedUtxos.length)
    throw new RgbServiceError('RGB PSBT requires at least one funding UTXO')
  if (!Number.isFinite(input.feeRate) || input.feeRate <= 0) {
    throw new RgbServiceError('RGB PSBT fee rate must be positive')
  }
}

/**
 * Build the Bitcoin half of an OpretFirst RGB transfer. RGB transition and MPC
 * commitment data are deliberately added in a later step before this PSBT is
 * signed. The output at `hostVout` is reserved for that commitment.
 */
export function createRgbOpretPsbt(input: RgbOpretPsbtRequest): RgbOpretPsbt {
  validateRequest(input)
  const fundingScript = scriptBytes(input.selectedUtxos[0]!.scriptPubKey, 'RGB funding script')
  if (!isTaprootScript(fundingScript)) {
    throw new RgbServiceError('RGB funding UTXOs must use the dedicated BIP86 Taproot account')
  }
  const totalInput = input.selectedUtxos.reduce((total, utxo) => {
    if (!Number.isSafeInteger(utxo.satoshis) || utxo.satoshis <= 0) {
      throw new RgbServiceError('RGB funding UTXO value is invalid')
    }
    const script = scriptBytes(utxo.scriptPubKey, 'RGB funding script')
    if (!script.equals(fundingScript) || !isTaprootScript(script)) {
      throw new RgbServiceError('RGB funding UTXOs must share the dedicated funding script')
    }
    publicKeyBytes(utxo.publicKey)
    return total + utxo.satoshis
  }, 0)

  const recipientScript = invoiceSealToScriptPubKey(input.recipientSeal)
  const witnessDustLimit =
    input.recipientSeal.type === 'witness' ? witnessSealDustLimit(input.recipientSeal) : 0
  if (
    recipientScript &&
    (!Number.isSafeInteger(input.witnessAmountSat) || input.witnessAmountSat! < witnessDustLimit)
  ) {
    throw new RgbServiceError(`RGB witness beneficiary requires at least ${witnessDustLimit} sats`)
  }
  const rgbFundingAmount = input.preserveFundingOutput ? totalInput : 0
  const fixedOutputScripts = [
    new Uint8Array(OPRET_RGB_COMMITMENT_SCRIPT_SIZE),
    ...(recipientScript ? [recipientScript] : []),
    ...(input.preserveFundingOutput ? [fundingScript] : []),
  ]
  const recipientAmount = recipientScript ? input.witnessAmountSat! : 0
  const feeFunding = input.feeFunding
  if (!feeFunding?.utxos.length) {
    throw new RgbServiceError('RGB transfer requires an ordinary BTC UTXO to pay the network fee')
  }
  const feeChangeScript = scriptBytes(feeFunding.changeScriptPubKey, 'RGB BTC change script')
  const feeUtxos = [...feeFunding.utxos].sort((left, right) => left.satoshis - right.satoshis)
  const rgbInputScripts = input.selectedUtxos.map(utxo =>
    scriptBytes(utxo.scriptPubKey, 'RGB funding script')
  )
  const selectedFeeUtxos: RgbFeeUtxo[] = []
  let feeInputValue = 0
  let fee = 0
  let btcChange = 0
  let hasBtcChange = false
  for (const feeUtxo of feeUtxos) {
    selectedFeeUtxos.push(feeUtxo)
    feeInputValue += feeUtxo.satoshis
    const inputScripts = [
      ...rgbInputScripts,
      ...selectedFeeUtxos.map(utxo => scriptBytes(utxo.scriptPubKey, 'RGB fee UTXO script')),
    ]
    const feeWithoutBtcChange = Math.ceil(
      estimateSegwitVsize(inputScripts, fixedOutputScripts) * input.feeRate
    )
    if (feeInputValue < recipientAmount + feeWithoutBtcChange) continue
    const feeWithBtcChange = Math.ceil(
      estimateSegwitVsize(inputScripts, [...fixedOutputScripts, feeChangeScript]) * input.feeRate
    )
    const candidateChange =
      totalInput + feeInputValue - recipientAmount - rgbFundingAmount - feeWithBtcChange
    if (candidateChange >= feeFunding.changeDustLimit) {
      fee = feeWithBtcChange
      btcChange = candidateChange
      hasBtcChange = true
    } else {
      fee = totalInput + feeInputValue - recipientAmount - rgbFundingAmount
    }
    break
  }
  if (!fee)
    throw new RgbServiceError('Ordinary BTC UTXOs do not cover the RGB transfer network fee')

  const psbt = new Psbt({ network: bitcoinNetwork(input.network) })
  input.selectedUtxos.forEach(utxo => {
    const publicKey = publicKeyBytes(utxo.publicKey)
    psbt.addInput({
      hash: utxo.outpoint.txid,
      index: utxo.outpoint.vout,
      witnessUtxo: {
        value: utxo.satoshis,
        script: scriptBytes(utxo.scriptPubKey, 'RGB funding script'),
      },
      tapInternalKey: publicKey.slice(1),
      ...(input.enableRbf === false ? {} : { sequence: 0xfffffffd }),
    })
  })
  selectedFeeUtxos.forEach(utxo => addFeeInput(psbt, utxo, input.enableRbf))

  // OpretFirst selects the first OP_RETURN output as the RGB host.
  psbt.addOutput({ script: Buffer.from([0x6a]), value: 0 })
  const recipientVout = recipientScript ? psbt.txOutputs.length : undefined
  if (recipientScript)
    psbt.addOutput({ script: Buffer.from(recipientScript), value: recipientAmount })
  const changeVout = input.preserveFundingOutput ? psbt.txOutputs.length : undefined
  if (input.preserveFundingOutput)
    psbt.addOutput({ script: fundingScript, value: rgbFundingAmount })
  if (hasBtcChange) psbt.addOutput({ script: feeChangeScript, value: btcChange })

  return {
    psbtHex: psbt.toHex(),
    hostVout: 0,
    recipientVout,
    changeVout,
    fee,
    feeInputCount: selectedFeeUtxos.length,
    feeOutpoints: selectedFeeUtxos.map(utxo => utxo.outpoint),
  }
}
