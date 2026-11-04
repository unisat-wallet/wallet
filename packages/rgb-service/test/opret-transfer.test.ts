import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import { decodeRgbInvoice, prepareNiaOpretTransfer } from '../src'

describe('prepareNiaOpretTransfer', () => {
  it('locally combines NIA transition, bundle message and Opret PSBT commitment', () => {
    const invoice = decodeRgbInvoice(
      'rgb:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/~/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    )
    const prepared = prepareNiaOpretTransfer({
      network: 'mainnet',
      assetId: 'rgb:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amount: '60',
      selectedUtxos: [
        {
          outpoint: { txid: 'b'.repeat(64), vout: 0 },
          satoshis: 10_000,
          scriptPubKey: `5120${'11'.repeat(32)}`,
          publicKey: `02${'22'.repeat(32)}`,
          allocations: [
            {
              assetId: 'rgb:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              amount: '100',
              settled: true,
              spendable: true,
              opId: 'cc'.repeat(32),
              assignmentIndex: 0,
              assignmentType: 4000,
            },
          ],
        },
      ],
      recipientSeal: invoice.seal,
      feeRate: 2,
      feeFunding: {
        utxos: [
          {
            outpoint: { txid: 'c'.repeat(64), vout: 1 },
            satoshis: 10_000,
            scriptPubKey: `5120${'11'.repeat(32)}`,
            publicKey: `02${'22'.repeat(32)}`,
          },
        ],
        changeScriptPubKey: `5120${'11'.repeat(32)}`,
        changeDustLimit: 330,
      },
      nonce: 1n,
      entropy: 2n,
      recipientBlinding: 3n,
      changeBlinding: 4n,
    })
    const psbt = Psbt.fromHex(prepared.psbtHex)

    expect(prepared.transitionId).toHaveLength(32)
    expect(prepared.bundleId).toHaveLength(32)
    expect(prepared.fascia.length).toBeGreaterThan(prepared.transition.length)
    expect(psbt.txOutputs[prepared.hostVout]!.script).toHaveLength(34)
    expect(psbt.txOutputs[prepared.hostVout]!.script[0]).toBe(0x6a)
    expect(psbt.data.globalMap.unknownKeyVals).toHaveLength(2)
  })
})
