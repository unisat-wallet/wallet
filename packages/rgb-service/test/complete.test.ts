import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import { completeRgbOpretPsbt, decodeRgbInvoice, prepareNiaOpretTransfer } from '../src'

function preparedPsbt() {
  const invoice = decodeRgbInvoice(
    'rgb:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
  )
  return prepareNiaOpretTransfer({
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
            amount: '60',
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
          outpoint: { txid: 'dd'.repeat(32), vout: 1 },
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
}

describe('completeRgbOpretPsbt', () => {
  it('rejects a signer response that changed the locally committed transaction', () => {
    const prepared = preparedPsbt()
    const altered = Psbt.fromHex(prepared.psbtHex)
    altered.addOutput({ script: Buffer.from([0x6a]), value: 0 })

    expect(() =>
      completeRgbOpretPsbt({
        preparedPsbt: prepared.psbtHex,
        signedPsbt: altered.toHex(),
        hostVout: prepared.hostVout,
        commitment: prepared.commitment,
      })
    ).toThrow('changed the committed transaction')
  })

  it('rejects an unfinalized PSBT even when its commitment is intact', () => {
    const prepared = preparedPsbt()

    expect(() =>
      completeRgbOpretPsbt({
        preparedPsbt: prepared.psbtHex,
        signedPsbt: prepared.psbtHex,
        hostVout: prepared.hostVout,
        commitment: prepared.commitment,
      })
    ).toThrow('not fully finalized')
  })

  it('can derive a consignment witness from the committed unsigned swap transaction', () => {
    const prepared = preparedPsbt()
    const completed = completeRgbOpretPsbt({
      preparedPsbt: prepared.psbtHex,
      signedPsbt: prepared.psbtHex,
      hostVout: prepared.hostVout,
      commitment: prepared.commitment,
      allowIncomplete: true,
    })

    const psbt = Psbt.fromHex(prepared.psbtHex)
    const transaction = ((psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx) as any
    expect(completed.txid).toBe(transaction.getId())
    expect(completed.rawTx).toMatch(/^[0-9a-f]+$/)
  })
})
