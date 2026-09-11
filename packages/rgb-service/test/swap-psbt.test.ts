import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import { prepareNiaOpretTransfer } from '../src'

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
})
