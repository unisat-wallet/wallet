import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import { createRgbAllocationSplitPsbt, createRgbOpretPsbt, decodeRgbInvoice } from '../src'

const utxo = {
  outpoint: { txid: 'a'.repeat(64), vout: 1 },
  satoshis: 10_000,
  scriptPubKey: `5120${'11'.repeat(32)}`,
  publicKey: `02${'22'.repeat(32)}`,
  allocations: [],
}

const feeFunding = {
  utxos: [{
    outpoint: { txid: 'b'.repeat(64), vout: 0 },
    satoshis: 10_000,
    scriptPubKey: utxo.scriptPubKey,
    publicKey: utxo.publicKey,
  }],
  changeScriptPubKey: utxo.scriptPubKey,
  changeDustLimit: 330,
}

describe('createRgbOpretPsbt', () => {
  it('builds an unsigned local OpretFirst PSBT for a blind beneficiary', () => {
    const invoice = decodeRgbInvoice(
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    )
    const built = createRgbOpretPsbt({
      network: 'mainnet',
      selectedUtxos: [utxo],
      recipientSeal: invoice.seal,
      feeRate: 2,
      preserveFundingOutput: true,
      feeFunding,
    })
    const psbt = Psbt.fromHex(built.psbtHex)

    expect(built).toMatchObject({ hostVout: 0, recipientVout: undefined, changeVout: 1 })
    expect(psbt.txOutputs).toHaveLength(3)
    expect(psbt.txOutputs[0]!.script.toString('hex')).toBe('6a')
    expect(psbt.txOutputs[1]!.script.toString('hex')).toBe(utxo.scriptPubKey)
    expect(psbt.txOutputs[1]!.value).toBe(utxo.satoshis)
    expect(psbt.data.inputs[0]!.tapInternalKey!.toString('hex')).toBe('22'.repeat(32))
    expect(built.feeOutpoints).toEqual([feeFunding.utxos[0]!.outpoint])
  })

  it('reserves fees for the final RGB commitment in the OP_RETURN host', () => {
    const invoice = decodeRgbInvoice(
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    )
    const built = createRgbOpretPsbt({
      network: 'mainnet',
      selectedUtxos: [utxo],
      recipientSeal: invoice.seal,
      feeRate: 1,
      preserveFundingOutput: true,
      feeFunding,
    })

    // Two P2TR inputs and three P2TR/OP_RETURN outputs are 255 vB once the
    // empty host becomes OP_RETURN <32-byte RGB commitment>.
    expect(built.fee).toBe(255)
  })

  it('uses the fee UTXO without a change output when the remaining BTC is dust', () => {
    const invoice = decodeRgbInvoice(
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    )
    const built = createRgbOpretPsbt({
      network: 'mainnet', selectedUtxos: [utxo], recipientSeal: invoice.seal,
      feeRate: 40, preserveFundingOutput: true, feeFunding,
    })
    const psbt = Psbt.fromHex(built.psbtHex)

    expect(built.fee).toBe(feeFunding.utxos[0]!.satoshis)
    expect(built.feeOutpoints).toEqual([feeFunding.utxos[0]!.outpoint])
    expect(psbt.txOutputs).toHaveLength(2)
    expect(psbt.txOutputs[1]!.value).toBe(utxo.satoshis)
  })

  it('rejects a transfer when ordinary BTC UTXOs cannot cover the network fee', () => {
    const invoice = decodeRgbInvoice(
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    )
    expect(() => createRgbOpretPsbt({
      network: 'mainnet', selectedUtxos: [utxo], recipientSeal: invoice.seal,
      feeRate: 50, preserveFundingOutput: true, feeFunding,
    })).toThrow('Ordinary BTC UTXOs do not cover the RGB transfer network fee')
  })

  it('uses the witness beneficiary script and reserves its output index', () => {
    const invoice = decodeRgbInvoice(
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw'
    )
    const built = createRgbOpretPsbt({
      network: 'mainnet',
      selectedUtxos: [utxo],
      recipientSeal: invoice.seal,
      witnessAmountSat: 1_000,
      feeRate: 2,
      preserveFundingOutput: true,
      feeFunding,
    })
    const psbt = Psbt.fromHex(built.psbtHex)

    expect(built).toMatchObject({ hostVout: 0, recipientVout: 1, changeVout: 2 })
    expect(psbt.txOutputs[1]!.script.toString('hex')).toBe('0014c709ed6c37348cc00e8dd3ce9fb9683ec24c15a6')
    expect(psbt.txOutputs[1]!.value).toBe(1_000)
  })

  it('returns the RGB input satoshis to the ordinary BTC change output for a full transfer', () => {
    const invoice = decodeRgbInvoice(
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    )
    const built = createRgbOpretPsbt({
      network: 'mainnet',
      selectedUtxos: [utxo],
      recipientSeal: invoice.seal,
      feeRate: 2,
      preserveFundingOutput: false,
      feeFunding,
    })
    const psbt = Psbt.fromHex(built.psbtHex)

    expect(built.changeVout).toBeUndefined()
    expect(psbt.txOutputs).toHaveLength(2)
    expect(psbt.txOutputs[1]!.value).toBeGreaterThan(feeFunding.utxos[0]!.satoshis - built.fee)
  })

  it('accepts a P2WPKH BTC input for RGB transfer fees', () => {
    const invoice = decodeRgbInvoice(
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    )
    const built = createRgbOpretPsbt({
      network: 'mainnet',
      selectedUtxos: [utxo],
      recipientSeal: invoice.seal,
      feeRate: 2,
      preserveFundingOutput: true,
      feeFunding: {
        utxos: [{
          outpoint: { txid: 'c'.repeat(64), vout: 0 },
          satoshis: 10_000,
          scriptPubKey: `0014${'22'.repeat(20)}`,
          publicKey: utxo.publicKey,
        }],
        changeScriptPubKey: `0014${'22'.repeat(20)}`,
        changeDustLimit: 294,
      },
    })
    const psbt = Psbt.fromHex(built.psbtHex)

    expect(psbt.data.inputs[1]!.tapInternalKey).toBeUndefined()
    expect(psbt.txOutputs[psbt.txOutputs.length - 1]!.script.toString('hex')).toBe(`0014${'22'.repeat(20)}`)
  })

  it('requires an explicit dust-safe Bitcoin allocation for witness beneficiaries', () => {
    const invoice = decodeRgbInvoice(
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw'
    )
    expect(() =>
      createRgbOpretPsbt({ network: 'mainnet', selectedUtxos: [utxo], recipientSeal: invoice.seal, feeRate: 2, preserveFundingOutput: true, feeFunding })
    ).toThrow('requires at least')
  })

  it('requires the standard dust amount for legacy witness beneficiary scripts', () => {
    expect(() =>
      createRgbOpretPsbt({
        network: 'mainnet',
        selectedUtxos: [utxo],
        recipientSeal: {
          type: 'witness',
          pay2vout: new Uint8Array(33),
          addressType: 'p2pkh',
          addressPayload: new Uint8Array(20),
        },
        witnessAmountSat: 330,
        feeRate: 2,
        preserveFundingOutput: true,
        feeFunding,
      })
    ).toThrow('requires at least 546 sats')
  })
})

describe('createRgbAllocationSplitPsbt', () => {
  it('creates one wallet carrier output per asset without reusing the RGB input value twice', () => {
    const selected = { ...utxo, satoshis: 330 }
    const built = createRgbAllocationSplitPsbt({
      network: 'mainnet', selectedUtxo: selected, outputCount: 3, feeRate: 2, feeFunding,
    })
    const psbt = Psbt.fromHex(built.psbtHex)

    expect(built.assetVouts).toEqual([1, 2, 3])
    expect(psbt.txOutputs.slice(1, 4).map(output => output.value)).toEqual([330, 330, 330])
    expect(psbt.txOutputs.slice(1, 4).every(output =>
      output.script.toString('hex') === selected.scriptPubKey
    )).toBe(true)
    expect(built.feeOutpoints).toEqual([feeFunding.utxos[0]!.outpoint])
  })

  it('rejects a split that has fewer than two contract outputs', () => {
    expect(() => createRgbAllocationSplitPsbt({
      network: 'mainnet', selectedUtxo: utxo, outputCount: 1, feeRate: 2, feeFunding,
    })).toThrow('requires at least two asset outputs')
  })
})
