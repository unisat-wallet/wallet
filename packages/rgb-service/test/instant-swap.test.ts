import { schnorr } from '@noble/curves/secp256k1'
import { Psbt, Transaction } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import {
  completeInstantSwapTemplate,
  encodeBfaTransferConsignment,
  encodeNiaGenesis,
  encodeNiaTransferConsignment,
  encodeRgbContractId,
  prepareNiaOpretTransfer,
  serializeBfaOpretWitnessBundle,
  serializeNiaOpretWitnessBundle,
} from '../src'
import { convertNiaV0ConsignmentToV1 } from '../src/protocol/nia-v0-migration'

const sellerPrivateKey = Uint8Array.from(Buffer.from('11'.repeat(32), 'hex'))
const buyerOutputKey = schnorr.getPublicKey(Uint8Array.from(Buffer.from('22'.repeat(32), 'hex')))
const sellerOutputKey = schnorr.getPublicKey(sellerPrivateKey)
const placeholderOutputKey = schnorr.getPublicKey(Uint8Array.from(Buffer.from('33'.repeat(32), 'hex')))
const sellerScript = Buffer.from(`5120${Buffer.from(sellerOutputKey).toString('hex')}`, 'hex')
const placeholderScript = Buffer.from(`5120${Buffer.from(placeholderOutputKey).toString('hex')}`, 'hex')
const receiverScript = Buffer.from(`5120${Buffer.from(buyerOutputKey).toString('hex')}`, 'hex')
const sellerTxid = '44'.repeat(32)

function fixture(nativeV1History = false) {
  const genesis = encodeNiaGenesis({
    ticker: 'INST', name: 'Instant test', precision: 0, timestamp: 1,
    network: 'signet',
    allocations: [{ txid: sellerTxid, vout: 0, blinding: 1n, amount: 100n }],
  })
  const assetId = encodeRgbContractId(genesis.assetId)
  const parentOpId = Buffer.from(genesis.assetId).toString('hex')
  const template = new Psbt()
  template.addInput({
    hash: '00'.repeat(32), index: 0, sequence: 0xffff_ffff,
    witnessUtxo: { value: 5_330, script: placeholderScript },
  })
  template.addInput({
    hash: sellerTxid, index: 0, sequence: 0xffff_ffff,
    witnessUtxo: { value: 330, script: sellerScript }, sighashType: 0x83,
  })
  template.addOutput({ script: Buffer.from([0x6a]), value: 0 })
  template.addOutput({ script: sellerScript, value: 5_330 })
  template.addOutput({ script: placeholderScript, value: 330 })
  const prepared = prepareNiaOpretTransfer({
    network: 'signet', assetId, amount: '100',
    selectedUtxos: [{
      outpoint: { txid: sellerTxid, vout: 0 }, satoshis: 330,
      scriptPubKey: sellerScript.toString('hex'), publicKey: `02${'55'.repeat(32)}`,
      allocations: [{
        assetId, amount: '100', settled: true, spendable: true,
        opId: parentOpId, assignmentIndex: 0, assignmentType: 4000,
      }],
    }],
    recipientSeal: {
      type: 'witness', pay2vout: Uint8Array.from([5, ...placeholderOutputKey]),
      addressType: 'p2tr', addressPayload: placeholderOutputKey,
    },
    witnessAmountSat: 330, feeRate: 1, nonce: 2n, entropy: 3n,
    recipientBlinding: 4n, changeBlinding: 5n,
    swapPsbt: template.toHex(), swapMode: 'instant',
  })
  const sellerSigned = Psbt.fromHex(prepared.psbtHex)
  const templateTx = (sellerSigned.data.globalMap.unsignedTx as any).tx as Transaction
  const templateHash = templateTx.hashForWitnessV1(
    1,
    sellerSigned.data.inputs.map(input => input.witnessUtxo!.script),
    sellerSigned.data.inputs.map(input => input.witnessUtxo!.value),
    0x83
  )
  sellerSigned.data.inputs[1]!.tapKeySig = Buffer.from([
    ...schnorr.sign(templateHash, sellerPrivateKey),
    0x83,
  ])
  const bundleInputs = [{ opId: parentOpId, assignmentType: 4000, assignmentIndex: 0 }]
  const bundle = serializeNiaOpretWitnessBundle({
    witnessTx: Uint8Array.from(templateTx.toBuffer()),
    contractId: assetId, transitionId: prepared.transitionId,
    transition: prepared.transition, inputs: bundleInputs, entropy: 3n,
  })
  const nativeBundle = serializeBfaOpretWitnessBundle({
    witnessTx: Uint8Array.from(templateTx.toBuffer()),
    contractId: assetId, transitionId: prepared.transitionId,
    transition: prepared.transition, inputs: bundleInputs, entropy: 3n,
  })
  const historyWitnessBundles = nativeV1History ? [nativeBundle.strict] : []
  const consignment = nativeV1History
    ? Buffer.from(encodeBfaTransferConsignment({
        genesis: genesis.strict,
        validatedWitnessBundles: historyWitnessBundles,
        witnessBundle: nativeBundle.strict,
      })).toString('base64')
    : Buffer.from(convertNiaV0ConsignmentToV1(encodeNiaTransferConsignment({
        genesis, witnessBundle: bundle.strict, terminals: [],
      }))).toString('base64')
  const protocolState = Buffer.from(JSON.stringify({
    version: 1, assetId, amount: '100',
    transitionId: Buffer.from(prepared.transitionId).toString('hex'),
    transition: Buffer.from(prepared.transition).toString('hex'),
    bundleId: Buffer.from(prepared.bundleId).toString('hex'),
    entropy: '3', genesis: Buffer.from(genesis.strict).toString('base64'),
    historyWitnessBundles: JSON.stringify(
      historyWitnessBundles.map(item => Buffer.from(item).toString('base64'))
    ), inputs: JSON.stringify(bundleInputs), recipientVout: 2,
  })).toString('base64')
  const listing = {
    version: 1 as const, transferId: 'instant', assetId, amount: '100', priceSats: '5000',
    psbt: sellerSigned.toHex(), consignment, templateTxid: templateTx.getId(),
    sellerOutpoint: { txid: sellerTxid, vout: 0 }, sellerInputIndex: 1 as const,
    sellerPayoutVout: 1 as const, receiverVout: 2 as const, protocolState,
  }
  const final = new Psbt()
  final.addInput({
    hash: '66'.repeat(32), index: 1, sequence: 0xffff_ffff,
    witnessUtxo: { value: 7_000, script: receiverScript },
  })
  final.addInput({
    hash: sellerTxid, index: 0, sequence: 0xffff_ffff,
    witnessUtxo: { value: 330, script: sellerScript }, sighashType: 0x83,
    tapKeySig: sellerSigned.data.inputs[1]!.tapKeySig,
  })
  final.addOutput({ script: sellerSigned.txOutputs[0]!.script, value: 0 })
  final.addOutput({ script: sellerScript, value: 5_330 })
  final.addOutput({ script: receiverScript, value: 330 })
  final.addOutput({ script: receiverScript, value: 1_570 })
  return { listing, final }
}

describe('RGB Instant Swap completion', () => {
  it('verifies the seller authorization and rebinds the consignment to the final txid', () => {
    const { listing, final } = fixture()
    const completed = completeInstantSwapTemplate({
      listing, finalPsbt: final.toHex(), receiverScriptPubKey: receiverScript.toString('hex'),
    })
    expect(completed.txid).not.toBe(listing.templateTxid)
    expect(completed.consignment).not.toBe(listing.consignment)
    expect(completed.receiverVout).toBe(2)
  })

  it('rejects a buyer transaction that changes the protected seller payout', () => {
    const { listing, final } = fixture()
    ;((final.data.globalMap.unsignedTx as any).tx as Transaction).outs[1]!.value = 5_329
    expect(() => completeInstantSwapTemplate({
      listing, finalPsbt: final.toHex(), receiverScriptPubKey: receiverScript.toString('hex'),
    })).toThrow('protected output 1')
  })

  it('rebinds a native v1 listing with native v1 witness history', () => {
    const { listing, final } = fixture(true)
    expect(() => completeInstantSwapTemplate({
      listing, finalPsbt: final.toHex(), receiverScriptPubKey: receiverScript.toString('hex'),
    })).not.toThrow()
  })

  it('accepts a semantically identical legacy v1 transfer envelope', () => {
    const { listing, final } = fixture(true)
    const current = Buffer.from(listing.consignment, 'base64')
    // Wallet 1.8.0-1.8.2 inserted a Strict terminals map after the v1
    // transfer discriminator. An empty map is semantically identical to the
    // current encoding and must not invalidate an otherwise signed listing.
    const headerLength = current.subarray(0, 7).equals(Buffer.from('RGB\0TFR')) ? 7 : 0
    const body = current.subarray(headerLength)
    const legacy = Buffer.concat([
      current.subarray(0, headerLength),
      body.subarray(0, 2),
      Buffer.from([0, 0]),
      body.subarray(2),
    ])
    listing.consignment = legacy.toString('base64')

    expect(() => completeInstantSwapTemplate({
      listing, finalPsbt: final.toHex(), receiverScriptPubKey: receiverScript.toString('hex'),
    })).not.toThrow()
  })
})
