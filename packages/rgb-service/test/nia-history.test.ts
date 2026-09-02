import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import {
  decodeNiaConsignment,
  decodeRgbInvoice,
  encodeBlindRgbInvoice,
  encodeNiaContract,
  encodeNiaGenesis,
  encodeNiaTransferConsignment,
  mergeNiaConsignmentHistory,
  prepareNiaOpretTransfer,
  revealNiaConsignmentBlindSeals,
  serializeNiaOpretWitnessBundle,
} from '../src'

const genesisTxid = '8d54c98d4c29a1ec4fd90635f543f0f7a871a78eb6a6e706342f831d92e3ba19'

function root() {
  return encodeNiaGenesis({
    ticker: 'DAG',
    name: 'NIA History',
    precision: 0,
    timestamp: 1_713_261_744,
    network: 'mainnet',
    allocations: [{ txid: genesisTxid, vout: 0, blinding: 1n, amount: 100n }],
  })
}

function transfer(input: {
  assetId: string
  parentOpId: string
  parentAmount: string
  txid: string
  nonce: bigint
  entropy: bigint
  invoice?: string
}) {
  const invoice = decodeRgbInvoice(
    input.invoice ||
      `rgb:${input.assetId.slice(4)}/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm?amount=60`
  )
  const prepared = prepareNiaOpretTransfer({
    network: 'mainnet',
    assetId: input.assetId,
    amount: '60',
    selectedUtxos: [
      {
        outpoint: { txid: input.txid, vout: 0 },
        satoshis: 10_000,
        scriptPubKey: `5120${'11'.repeat(32)}`,
        publicKey: `02${'22'.repeat(32)}`,
        allocations: [
          {
            assetId: input.assetId,
            amount: input.parentAmount,
            settled: true,
            spendable: true,
            opId: input.parentOpId,
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
    nonce: input.nonce,
    entropy: input.entropy,
    recipientBlinding: 3n,
    changeBlinding: 4n,
  })
  const psbt = Psbt.fromHex(prepared.psbtHex)
  const witnessTx = (
    (psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx
  ).toBuffer()
  const bundle = serializeNiaOpretWitnessBundle({
    witnessTx,
    contractId: input.assetId,
    transitionId: prepared.transitionId,
    transition: prepared.transition,
    inputs: [{ opId: input.parentOpId, assignmentType: 4000, assignmentIndex: 0 }],
    entropy: input.entropy,
  })
  return { transitionId: Buffer.from(prepared.transitionId).toString('hex'), bundle, invoice }
}

describe('mergeNiaConsignmentHistory', () => {
  it('orders independently transported WitnessBundles by their parent Transition', () => {
    const genesis = root()
    const assetId = `rgb:${Buffer.from(genesis.assetId).toString('hex')}`
    const first = transfer({
      assetId,
      parentOpId: assetId.slice(4),
      parentAmount: '100',
      txid: genesisTxid,
      nonce: 1n,
      entropy: 2n,
    })
    const second = transfer({
      assetId,
      parentOpId: first.transitionId,
      parentAmount: '60',
      txid: 'aa'.repeat(32),
      nonce: 5n,
      entropy: 6n,
    })
    const firstPayload = Buffer.from(
      encodeNiaTransferConsignment({
        genesis,
        witnessBundle: first.bundle.strict,
        terminals: [
          {
            bundleId: first.bundle.bundleId,
            secretSeals: [
              first.invoice.seal.type === 'confidential'
                ? first.invoice.seal.secretSeal
                : new Uint8Array(32),
            ],
          },
        ],
      })
    ).toString('base64')
    const secondPayload = Buffer.from(
      encodeNiaTransferConsignment({
        genesis,
        witnessBundle: second.bundle.strict,
        terminals: [
          {
            bundleId: second.bundle.bundleId,
            secretSeals: [
              second.invoice.seal.type === 'confidential'
                ? second.invoice.seal.secretSeal
                : new Uint8Array(32),
            ],
          },
        ],
      })
    ).toString('base64')

    const merged = mergeNiaConsignmentHistory({
      assetId,
      consignments: [
        { opId: second.transitionId, payload: secondPayload },
        { opId: first.transitionId, payload: firstPayload },
      ],
      requiredOpIds: [second.transitionId],
    })

    expect(merged.transitionIds).toEqual([first.transitionId, second.transitionId].sort())
    expect(merged.witnessBundles).toHaveLength(2)
    expect(Buffer.from(merged.witnessBundles[0]!)).toEqual(Buffer.from(first.bundle.strict))
    expect(Buffer.from(merged.witnessBundles[1]!)).toEqual(Buffer.from(second.bundle.strict))

    const next = transfer({
      assetId,
      parentOpId: second.transitionId,
      parentAmount: '60',
      txid: 'bb'.repeat(32),
      nonce: 7n,
      entropy: 8n,
    })
    const chained = encodeNiaTransferConsignment({
      genesis,
      priorWitnessBundles: merged.witnessBundles,
      witnessBundle: next.bundle.strict,
      terminals: [
        {
          bundleId: next.bundle.bundleId,
          secretSeals: [
            next.invoice.seal.type === 'confidential'
              ? next.invoice.seal.secretSeal
              : new Uint8Array(32),
          ],
        },
      ],
    })
    const fullHistory = mergeNiaConsignmentHistory({
      assetId,
      consignments: [{ opId: next.transitionId, payload: Buffer.from(chained).toString('base64') }],
      requiredOpIds: [next.transitionId],
    })
    expect(fullHistory.witnessBundles).toHaveLength(3)
    expect(fullHistory.transitionIds).toEqual(
      [first.transitionId, second.transitionId, next.transitionId].sort()
    )
  })

  it('rejects a history that does not disclose a required allocation parent', () => {
    const genesis = root()
    const assetId = `rgb:${Buffer.from(genesis.assetId).toString('hex')}`
    const contract = Buffer.from(encodeNiaContract(genesis).strict).toString('base64')

    expect(() =>
      mergeNiaConsignmentHistory({
        assetId,
        consignments: [{ opId: assetId.slice(4), payload: contract }],
        requiredOpIds: ['ff'.repeat(32)],
      })
    ).toThrow('missing an allocation parent Transition')
  })

  it('merges equivalent confidential and revealed Transition representations', () => {
    const genesis = root()
    const assetId = `rgb:${Buffer.from(genesis.assetId).toString('hex')}`
    const blindSeal = { txid: 'ee'.repeat(32), vout: 2, blinding: 3n }
    const first = transfer({
      assetId,
      parentOpId: assetId.slice(4),
      parentAmount: '100',
      txid: genesisTxid,
      nonce: 1n,
      entropy: 2n,
      invoice: encodeBlindRgbInvoice({
        network: 'mainnet',
        assetId,
        amount: '60',
        seal: blindSeal,
      }),
    })
    const confidentialPayload = Buffer.from(
      encodeNiaTransferConsignment({
        genesis,
        witnessBundle: first.bundle.strict,
        terminals: [
          {
            bundleId: first.bundle.bundleId,
            secretSeals: [
              first.invoice.seal.type === 'confidential'
                ? first.invoice.seal.secretSeal
                : new Uint8Array(32),
            ],
          },
        ],
      })
    ).toString('base64')
    const revealed = revealNiaConsignmentBlindSeals(
      decodeNiaConsignment(Uint8Array.from(Buffer.from(confidentialPayload, 'base64'))),
      [blindSeal]
    )
    const revealedBundle = revealed.witnessBundles[0]
    if (!revealedBundle) throw new Error('missing revealed witness bundle')
    const revealedPayload = Buffer.from(
      encodeNiaTransferConsignment({
        genesis,
        witnessBundle: revealedBundle.strict,
        terminals: [],
      })
    ).toString('base64')

    const merged = mergeNiaConsignmentHistory({
      assetId,
      consignments: [
        { opId: first.transitionId, payload: confidentialPayload },
        { opId: first.transitionId, payload: revealedPayload },
      ],
      requiredOpIds: [first.transitionId],
    })

    expect(merged.transitionIds).toEqual([first.transitionId])
    expect(merged.witnessBundles).toHaveLength(1)
    expect(Buffer.from(merged.witnessBundles[0]!)).toEqual(Buffer.from(revealedBundle.strict))
  })
})
