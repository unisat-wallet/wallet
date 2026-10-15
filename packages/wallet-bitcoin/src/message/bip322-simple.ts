import { encode } from 'varuint-bitcoin'
import { addressToScriptPk, getAddressType } from '../address'
import { bitcoin } from '../bitcoin-core'
import { toPsbtNetwork } from '../network'
import { schnorrValidator, validator } from '../utils'
import { AddressType, NetworkType } from '@unisat/wallet-types'

function bip0322_hash(message: string) {
  const { sha256 } = bitcoin.crypto
  const tag = 'BIP0322-signed-message'
  const tagHash = sha256(Buffer.from(tag))
  const result = sha256(Buffer.concat([tagHash, tagHash, Buffer.from(message)] as any))
  return result.toString('hex')
}

export function genPsbtOfBIP322Simple({
  message,
  address,
  networkType,
}: {
  message: string
  address: string
  networkType: NetworkType
}) {
  const outputScript = addressToScriptPk(address, networkType)
  const addressType = getAddressType(address, networkType)
  const supportedTypes = [
    AddressType.P2WPKH,
    AddressType.P2TR,
    AddressType.M44_P2WPKH,
    AddressType.M44_P2TR,
  ]
  if (supportedTypes.includes(addressType) == false) {
    throw new Error('Not support address type to sign')
  }

  const prevoutHash = Buffer.from(
    '0000000000000000000000000000000000000000000000000000000000000000',
    'hex'
  )
  const prevoutIndex = 0xffffffff
  const sequence = 0
  const scriptSig = Buffer.concat([
    Buffer.from('0020', 'hex'),
    Buffer.from(bip0322_hash(message), 'hex'),
  ] as any)

  const txToSpend = new bitcoin.Transaction()
  txToSpend.version = 0
  txToSpend.addInput(prevoutHash, prevoutIndex, sequence, scriptSig)
  txToSpend.addOutput(outputScript, 0)

  const psbtToSign = new bitcoin.Psbt()
  psbtToSign.setVersion(0)
  psbtToSign.addInput({
    hash: txToSpend.getHash(),
    index: 0,
    sequence: 0,
    witnessUtxo: {
      script: outputScript,
      value: 0,
    },
  })
  psbtToSign.addOutput({ script: Buffer.from('6a', 'hex'), value: 0 })

  return psbtToSign
}

export function getSignatureFromPsbtOfBIP322Simple(psbt: bitcoin.Psbt) {
  const txToSign = psbt.extractTransaction()

  if (!txToSign) throw new Error('Failed to extract transaction from PSBT')

  function encodeVarString(b: any) {
    return Buffer.concat([encode(b.byteLength), b])
  }

  if (!txToSign.ins[0]) throw new Error('Failed to extract witness from transaction')

  const len = encode(txToSign.ins[0].witness.length)
  const result = Buffer.concat([
    len,
    ...txToSign.ins[0].witness.map(w => encodeVarString(w)),
  ] as any)
  const signature = result.toString('base64')

  return signature
}

export function verifyMessageOfBIP322Simple(
  address: string,
  msg: string,
  signature: string,
  networkType: NetworkType = NetworkType.MAINNET
) {
  const addressType = getAddressType(address, networkType)
  if (addressType === AddressType.P2WPKH || addressType === AddressType.M44_P2WPKH) {
    return verifySignatureOfBIP322Simple_P2PWPKH(address, msg, signature, networkType)
  } else if (addressType === AddressType.P2TR || addressType === AddressType.M44_P2TR) {
    return verifySignatureOfBIP322Simple_P2TR(address, msg, signature, networkType)
  }
  return false
}

function verifySignatureOfBIP322Simple_P2TR(
  address: string,
  msg: string,
  sign: string,
  networkType: NetworkType = NetworkType.MAINNET
) {
  const network = toPsbtNetwork(networkType)
  const outputScript = bitcoin.address.toOutputScript(address, network)
  const prevoutHash = Buffer.from(
    '0000000000000000000000000000000000000000000000000000000000000000',
    'hex'
  )
  const prevoutIndex = 0xffffffff
  const sequence = 0
  const scriptSig = Buffer.concat([
    Buffer.from('0020', 'hex'),
    Buffer.from(bip0322_hash(msg), 'hex'),
  ] as any)

  const txToSpend = new bitcoin.Transaction()
  txToSpend.version = 0
  txToSpend.addInput(prevoutHash, prevoutIndex, sequence, scriptSig)
  txToSpend.addOutput(outputScript, 0)

  const data = Buffer.from(sign, 'base64')
  const _res = bitcoin.script.decompile(data.slice(1))
  if (!_res) return false
  const signature = _res[0] as Buffer
  const pubkey = Buffer.from('02' + outputScript.subarray(2).toString('hex'), 'hex')

  const psbtToSign = new bitcoin.Psbt()
  psbtToSign.setVersion(0)
  psbtToSign.addInput({
    hash: txToSpend.getHash(),
    index: 0,
    sequence: 0,
    witnessUtxo: {
      script: outputScript,
      value: 0,
    },
  })
  psbtToSign.addOutput({ script: Buffer.from('6a', 'hex'), value: 0 })
  const tapKeyHash = (psbtToSign as any).__CACHE.__TX.hashForWitnessV1(0, [outputScript], [0], 0)
  const valid = schnorrValidator(pubkey, tapKeyHash, signature)
  return valid
}

function verifySignatureOfBIP322Simple_P2PWPKH(
  address: string,
  msg: string,
  sign: string,
  networkType: NetworkType = NetworkType.MAINNET
) {
  const network = toPsbtNetwork(networkType)
  const outputScript = bitcoin.address.toOutputScript(address, network)

  const prevoutHash = Buffer.from(
    '0000000000000000000000000000000000000000000000000000000000000000',
    'hex'
  )
  const prevoutIndex = 0xffffffff
  const sequence = 0
  const scriptSig = Buffer.concat([
    Buffer.from('0020', 'hex'),
    Buffer.from(bip0322_hash(msg), 'hex'),
  ] as any)

  const txToSpend = new bitcoin.Transaction()
  txToSpend.version = 0
  txToSpend.addInput(prevoutHash, prevoutIndex, sequence, scriptSig)
  txToSpend.addOutput(outputScript, 0)

  const data = Buffer.from(sign, 'base64')
  const _res = bitcoin.script.decompile(data.slice(1))

  if (!_res || _res.length !== 2 || !Buffer.isBuffer(_res[0]) || !Buffer.isBuffer(_res[1])) {
    return false
  }

  const pubkey = _res[1]
  try {
    const pubkeyOutputScript = bitcoin.payments.p2wpkh({ pubkey, network }).output
    if (!pubkeyOutputScript?.equals(outputScript)) return false
  } catch {
    return false
  }

  const psbtToSign = new bitcoin.Psbt()
  psbtToSign.setVersion(0)
  psbtToSign.addInput({
    hash: txToSpend.getHash(),
    index: 0,
    sequence: 0,
    witnessUtxo: {
      script: outputScript,
      value: 0,
    },
  })
  psbtToSign.addOutput({ script: Buffer.from('6a', 'hex'), value: 0 })

  psbtToSign.updateInput(0, {
    partialSig: [
      {
        pubkey,
        signature: _res[0],
      },
    ],
  })
  const valid = psbtToSign.validateSignaturesOfAllInputs(validator)
  return valid
}
