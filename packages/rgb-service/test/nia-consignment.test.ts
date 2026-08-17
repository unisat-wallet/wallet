import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import {
  commitOpretRgbPsbt,
  decodeNiaConsignment,
  decodeRgbInvoice,
  encodeNiaContract,
  encodeNiaGenesis,
  encodeNiaTransition,
  encodeNiaTransferConsignment,
  prepareNiaOpretTransfer,
  serializeNiaOpretWitnessBundle,
  transitionBundleId,
  validateNiaConsignmentParentSpends,
  validateNiaConsignmentParentState,
} from '../src'

const txid = '8d54c98d4c29a1ec4fd90635f543f0f7a871a78eb6a6e706342f831d92e3ba19'

function genesis() {
  return encodeNiaGenesis({
    ticker: 'PARSE',
    name: 'Parse NIA',
    precision: 0,
    timestamp: 1_713_261_744,
    network: 'mainnet',
    allocations: [{ txid, vout: 0, blinding: 1n, amount: 100n }],
  })
}

describe('decodeNiaConsignment', () => {
  it('round-trips a strict locally-issued NIA Contract', () => {
    const encoded = genesis()
    const decoded = decodeNiaConsignment(encodeNiaContract(encoded).strict)

    expect(decoded).toMatchObject({
      assetId: `rgb:${Buffer.from(encoded.assetId).toString('hex')}`,
      transfer: false,
      terminals: [],
      transitions: [],
    })
    expect(Buffer.from(decoded.genesis.strict)).toEqual(Buffer.from(encoded.strict))
  })

  it('extracts the local transfer transition and its parent operation IDs', () => {
    const encoded = genesis()
    const assetId = `rgb:${Buffer.from(encoded.assetId).toString('hex')}`
    const invoice = decodeRgbInvoice(
      `rgb:${assetId.slice(4)}/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm?amount=60`
    )
    const prepared = prepareNiaOpretTransfer({
      network: 'mainnet',
      assetId,
      amount: '60',
      selectedUtxos: [
        {
          outpoint: { txid, vout: 0 },
          satoshis: 10_000,
          scriptPubKey: `5120${'11'.repeat(32)}`,
          publicKey: `02${'22'.repeat(32)}`,
          allocations: [
            {
              assetId,
              amount: '100',
              settled: true,
              spendable: true,
              opId: assetId.slice(4),
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
            outpoint: { txid: 'cc'.repeat(32), vout: 1 },
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
    const transaction = (
      (psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx
    ).toBuffer()
    const bundle = serializeNiaOpretWitnessBundle({
      witnessTx: transaction,
      contractId: assetId,
      transitionId: prepared.transitionId,
      transition: prepared.transition,
      inputs: [{ opId: assetId.slice(4), assignmentType: 4000, assignmentIndex: 0 }],
      entropy: 2n,
    })
    const consignment = encodeNiaTransferConsignment({
      genesis: encoded,
      witnessBundle: bundle.strict,
      terminals: [
        {
          bundleId: bundle.bundleId,
          secretSeals: [
            invoice.seal.type === 'confidential' ? invoice.seal.secretSeal : new Uint8Array(32),
          ],
        },
      ],
    })
    const decoded = decodeNiaConsignment(consignment)

    expect(decoded.transfer).toBe(true)
    expect(decoded.transitions).toEqual([
      expect.objectContaining({
        opId: Buffer.from(prepared.transitionId).toString('hex'),
        contractId: assetId.slice(4),
        parentOpIds: [assetId.slice(4)],
      }),
    ])

    expect(decoded.witnessBundles[0]?.inputs).toContainEqual({ txid, vout: 0 })
    decoded.witnessBundles[0]!.inputs = [{ txid: 'ff'.repeat(32), vout: 0 }]
    expect(() => validateNiaConsignmentParentSpends(decoded)).toThrow(
      'witness does not spend its parent seal'
    )

    expect(() => decodeNiaConsignment(Uint8Array.from([...consignment, 0x55]))).toThrow(
      'Consignment has trailing data'
    )

    const tampered = Uint8Array.from(consignment)
    const host = tampered.findIndex(
      (value, index) => value === 0x6a && tampered[index + 1] === 0x20
    )
    tampered[host + 2] ^= 0x01
    expect(() => decodeNiaConsignment(tampered)).toThrow(
      'OP_RETURN does not match its MPC commitment'
    )
  })

  it('accepts a witness transfer consignment without blind terminals', () => {
    const encoded = genesis()
    const assetId = `rgb:${Buffer.from(encoded.assetId).toString('hex')}`
    const invoice = decodeRgbInvoice(
      `rgb:${assetId.slice(4)}/schema/~/bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw?amount=60`
    )
    const prepared = prepareNiaOpretTransfer({
      network: 'mainnet',
      assetId,
      amount: '60',
      selectedUtxos: [
        {
          outpoint: { txid, vout: 0 },
          satoshis: 10_000,
          scriptPubKey: `5120${'11'.repeat(32)}`,
          publicKey: `02${'22'.repeat(32)}`,
          allocations: [
            {
              assetId,
              amount: '100',
              settled: true,
              spendable: true,
              opId: assetId.slice(4),
              assignmentIndex: 0,
              assignmentType: 4000,
            },
          ],
        },
      ],
      recipientSeal: invoice.seal,
      witnessAmountSat: 330,
      feeRate: 2,
      feeFunding: {
        utxos: [
          {
            outpoint: { txid: 'cc'.repeat(32), vout: 1 },
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
    const bundle = serializeNiaOpretWitnessBundle({
      witnessTx: (
        (psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx
      ).toBuffer(),
      contractId: assetId,
      transitionId: prepared.transitionId,
      transition: prepared.transition,
      inputs: [{ opId: assetId.slice(4), assignmentType: 4000, assignmentIndex: 0 }],
      entropy: 2n,
    })
    const decoded = decodeNiaConsignment(
      encodeNiaTransferConsignment({
        genesis: encoded,
        witnessBundle: bundle.strict,
        terminals: [],
      })
    )

    expect(decoded.terminals).toEqual([])
    expect(decoded.transitions[0]?.assignments[0]).toMatchObject({
      amount: 60n,
      seal: { txid: null, vout: 1 },
    })
  })

  it('rejects a bundle input that is not consumed by its committed transition', () => {
    const encoded = genesis()
    const assetId = `rgb:${Buffer.from(encoded.assetId).toString('hex')}`
    const invoice = decodeRgbInvoice(
      `rgb:${assetId.slice(4)}/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm?amount=60`
    )
    const prepared = prepareNiaOpretTransfer({
      network: 'mainnet',
      assetId,
      amount: '60',
      selectedUtxos: [
        {
          outpoint: { txid, vout: 0 },
          satoshis: 10_000,
          scriptPubKey: `5120${'11'.repeat(32)}`,
          publicKey: `02${'22'.repeat(32)}`,
          allocations: [
            {
              assetId,
              amount: '100',
              settled: true,
              spendable: true,
              opId: assetId.slice(4),
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
            outpoint: { txid: 'cc'.repeat(32), vout: 1 },
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
    const transaction = (
      (psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx
    ).toBuffer()
    const bundle = serializeNiaOpretWitnessBundle({
      witnessTx: transaction,
      contractId: assetId,
      transitionId: prepared.transitionId,
      transition: prepared.transition,
      inputs: [{ opId: assetId.slice(4), assignmentType: 4000, assignmentIndex: 1 }],
      entropy: 2n,
    })
    const consignment = encodeNiaTransferConsignment({
      genesis: encoded,
      witnessBundle: bundle.strict,
      terminals: [
        {
          bundleId: bundle.bundleId,
          secretSeals: [
            invoice.seal.type === 'confidential' ? invoice.seal.secretSeal : new Uint8Array(32),
          ],
        },
      ],
    })

    expect(() => decodeNiaConsignment(consignment)).toThrow(
      'NIA WitnessBundle input does not match its referenced Transition'
    )
  })

  it('rejects a complete transfer that inflates its consumed NIA assignments', () => {
    const encoded = genesis()
    const assetId = `rgb:${Buffer.from(encoded.assetId).toString('hex')}`
    const invoice = decodeRgbInvoice(
      `rgb:${assetId.slice(4)}/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm?amount=60`
    )
    if (invoice.seal.type !== 'confidential') throw new Error('Expected a confidential invoice')
    const revealedTxid = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
    const transition = encodeNiaTransition({
      contractId: assetId,
      nonce: 1n,
      inputs: [{ opId: assetId.slice(4), assignmentIndex: 0 }],
      assignments: [
        {
          amount: 101n,
          seal: { secretSeal: Buffer.from(invoice.seal.secretSeal).toString('hex') },
        },
        { amount: 1n, seal: { txid: revealedTxid, vout: 4, blinding: 5n } },
      ],
    })
    const bundleInput = { opId: assetId.slice(4), assignmentType: 4000, assignmentIndex: 0 }
    const bundleId = transitionBundleId([{ ...bundleInput, transitionId: transition.opId }])
    const psbt = new Psbt()
    psbt.addInput({ hash: txid, index: 0 })
    psbt.addOutput({ script: Buffer.from([0x6a]), value: 0 })
    const committed = commitOpretRgbPsbt({
      psbtHex: psbt.toHex(),
      hostVout: 0,
      entropy: 2n,
      messages: [{ protocolId: transition.strict.slice(2, 34), message: bundleId }],
      transitionId: transition.opId,
      transition: transition.strict,
    })
    const committedPsbt = Psbt.fromHex(committed.psbtHex)
    const transaction = (
      (committedPsbt.data.globalMap.unsignedTx as any).tx || committedPsbt.data.globalMap.unsignedTx
    ).toBuffer()
    const bundle = serializeNiaOpretWitnessBundle({
      witnessTx: transaction,
      contractId: assetId,
      transitionId: transition.opId,
      transition: transition.strict,
      inputs: [bundleInput],
      entropy: 2n,
    })
    const consignment = decodeNiaConsignment(
      encodeNiaTransferConsignment({
        genesis: encoded,
        witnessBundle: bundle.strict,
        terminals: [
          {
            bundleId: bundle.bundleId,
            secretSeals: [invoice.seal.secretSeal],
          },
        ],
      })
    )

    expect(
      consignment.transitions[0]!.assignments.some(
        assignment =>
          'txid' in assignment.seal &&
          assignment.seal.txid === revealedTxid &&
          assignment.seal.vout === 4 &&
          assignment.seal.blinding === 5n
      )
    ).toBe(true)
    expect(() => validateNiaConsignmentParentState(consignment)).toThrow(
      'creates more value than its consumed assignments'
    )
  })
})
