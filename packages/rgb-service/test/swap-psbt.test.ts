import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import { decodeRgbInvoice, invoiceSealToScriptPubKey, prepareNiaOpretTransfer } from '../src'

const txid = '11'.repeat(32)
const fundingScript = `5120${'22'.repeat(32)}`

function swapPsbt(extraOpret = false) {
  const psbt = new Psbt()
  psbt.addInput({
    hash: txid,
    index: 1,
    sequence: 0xffff_ffff,
    witnessUtxo: { value: 1000, script: Buffer.from(fundingScript, 'hex') },
  })
  psbt.addOutput({ script: Buffer.from([0x6a]), value: 0 })
  if (extraOpret) psbt.addOutput({ script: Buffer.from([0x6a]), value: 0 })
  psbt.addOutput({ script: Buffer.from(`5120${'33'.repeat(32)}`, 'hex'), value: 900 })
  return psbt.toBase64()
}

function input(psbt: string) {
  return {
    network: 'testnet4' as const,
    assetId: 'rgb:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    amount: '100',
    selectedUtxos: [
      {
        outpoint: { txid, vout: 1 },
        satoshis: 1000,
        scriptPubKey: fundingScript,
        publicKey: `02${'44'.repeat(32)}`,
        allocations: [
          {
            assetId: 'rgb:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            amount: '100',
            settled: true,
            spendable: true,
            opId: 'bb'.repeat(32),
            assignmentIndex: 0,
            assignmentType: 4000,
          },
        ],
      },
    ],
    recipientSeal: { type: 'confidential' as const, secretSeal: Uint8Array.from({ length: 32 }, () => 0x55) },
    feeRate: 1,
    nonce: 1n,
    entropy: 2n,
    recipientBlinding: 3n,
    changeBlinding: 4n,
    swapPsbt: psbt,
  }
}

describe('RGB swap PSBT preparation', () => {
  it('colors only an Opret-first template containing the reserved RGB input', () => {
    const prepared = prepareNiaOpretTransfer(input(swapPsbt()))
    const psbt = Psbt.fromHex(prepared.psbtHex)
    expect(psbt.txOutputs[0]?.script).toHaveLength(34)
    expect(psbt.txOutputs[0]?.script[0]).toBe(0x6a)
    expect(prepared.hostVout).toBe(0)
  })

  it('rejects a maker template with a second OP_RETURN output', () => {
    expect(() => prepareNiaOpretTransfer(input(swapPsbt(true)))).toThrow('additional OP_RETURN')
  })

  it('recognizes a wallet fee-pool input included by the maker template', () => {
    const feeTxid = '66'.repeat(32)
    const feeScript = `0014${'77'.repeat(20)}`
    const psbt = new Psbt()
    psbt.addInput({
      hash: txid,
      index: 1,
      sequence: 0xffff_ffff,
      witnessUtxo: { value: 1000, script: Buffer.from(fundingScript, 'hex') },
    })
    psbt.addInput({
      hash: feeTxid,
      index: 2,
      sequence: 0xffff_ffff,
      witnessUtxo: { value: 500, script: Buffer.from(feeScript, 'hex') },
    })
    psbt.addOutput({ script: Buffer.from([0x6a]), value: 0 })
    psbt.addOutput({ script: Buffer.from(`5120${'33'.repeat(32)}`, 'hex'), value: 1400 })

    const prepared = prepareNiaOpretTransfer({
      ...input(psbt.toBase64()),
      feeFunding: {
        utxos: [{ outpoint: { txid: feeTxid, vout: 2 }, satoshis: 500, scriptPubKey: feeScript, publicKey: `02${'88'.repeat(32)}` }],
        changeScriptPubKey: feeScript,
        changeDustLimit: 294,
      },
    })
    expect(prepared.feeOutpoints).toEqual([{ txid: feeTxid, vout: 2 }])
  })

  it('colors the fixed Instant Swap layout without RGB change', () => {
    const invoice = decodeRgbInvoice(
      'rgb:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/~/~/bc:wvout:BX7FZkmK-bLqNoIA-vMTGR6Z-iEeSRxL-56usKVf-tl3E0xT-GXpycHA'
    )
    const recipientScript = invoiceSealToScriptPubKey(invoice.seal)!
    const psbt = new Psbt()
    psbt.addInput({
      hash: '00'.repeat(32),
      index: 0,
      sequence: 0xffff_ffff,
      witnessUtxo: { value: 10_330, script: Buffer.from(`5120${'55'.repeat(32)}`, 'hex') },
    })
    psbt.addInput({
      hash: txid,
      index: 1,
      sequence: 0xffff_ffff,
      witnessUtxo: { value: 1000, script: Buffer.from(fundingScript, 'hex') },
      sighashType: 0x83,
    })
    psbt.addOutput({ script: Buffer.from([0x6a]), value: 0 })
    psbt.addOutput({ script: Buffer.from(`5120${'66'.repeat(32)}`, 'hex'), value: 11_000 })
    psbt.addOutput({ script: Buffer.from(recipientScript), value: 330 })

    const prepared = prepareNiaOpretTransfer({
      ...input(psbt.toHex()),
      recipientSeal: invoice.seal,
      witnessAmountSat: 330,
      swapMode: 'instant',
    })
    const colored = Psbt.fromHex(prepared.psbtHex)
    expect(prepared.recipientVout).toBe(2)
    expect(prepared.changeVout).toBeUndefined()
    expect(colored.data.inputs[1]?.sighashType).toBe(0x83)
  })

  it('rejects Instant Swap when the RGB seller input is not index 1', () => {
    expect(() => prepareNiaOpretTransfer({ ...input(swapPsbt()), swapMode: 'instant' }))
      .toThrow('seller input must be at index 1')
  })
})
