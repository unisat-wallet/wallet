import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'

import {
  concealBlindSeal,
  decodeRgbInvoice,
  decodeNiaConsignment,
  encodeBlindRgbInvoice,
  encodeNiaContract,
  encodeNiaGenesis,
  localNiaProtocolEncoder,
} from '../src'

/**
 * Synthetic A -> B -> A history-growth test.
 *
 * This deliberately does not broadcast or use real private keys. Final
 * witnesses are placeholders accepted by bitcoinjs PSBT extraction, which
 * makes it suitable for measuring the local protocol's history handling.
 * It is not a substitute for a two-wallet testnet/regtest integration test.
 *
 * Usage:
 *   RGB_STRESS_ROUNDS=100 pnpm --filter @unisat/rgb-service test:roundtrip-stress
 *   RGB_STRESS_ROUNDS=1000 RGB_STRESS_LOG_EVERY=100 pnpm --filter @unisat/rgb-service test:roundtrip-stress
 */

const rounds = Number(process.env['RGB_STRESS_ROUNDS'] || '0')
const requestedLogEvery = Number(process.env['RGB_STRESS_LOG_EVERY'] || '100')
const logEvery = Number.isSafeInteger(requestedLogEvery) && requestedLogEvery > 0 ? requestedLogEvery : 100
const enabled = Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 10_000

const rootTxid = '8d54c98d4c29a1ec4fd90635f543f0f7a871a78eb6a6e706342f831d92e3ba19'
const finalWitness = Buffer.concat([Buffer.from([1, 64]), Buffer.alloc(64)])

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000
}

function signedPsbt(psbtHex: string): string {
  const psbt = Psbt.fromHex(psbtHex)
  psbt.data.inputs.forEach((_, index) => {
    psbt.updateInput(index, { finalScriptWitness: finalWitness })
  })
  return psbt.toHex()
}

describe.skipIf(!enabled)('RGB synthetic round-trip stress', () => {
  it(
    `builds ${rounds} alternating transfers with complete validation history`,
    async () => {
      const startedAt = process.hrtime.bigint()
      const genesis = encodeNiaGenesis({
        ticker: 'STRESS',
        name: 'RGB history stress',
        precision: 0,
        timestamp: 1_713_261_744,
        network: 'mainnet',
        allocations: [{ txid: rootTxid, vout: 0, blinding: 1n, amount: 100n }],
      })
      const assetId = `rgb:${Buffer.from(genesis.assetId).toString('hex')}`
      const fundingScript = `5120${'11'.repeat(32)}`
      const fundingPublicKey = `02${'22'.repeat(32)}`
      const contract = Buffer.from(encodeNiaContract(genesis).strict).toString('base64')

      let utxo = {
        outpoint: { txid: rootTxid, vout: 0 },
        satoshis: 10_000,
        scriptPubKey: fundingScript,
        publicKey: fundingPublicKey,
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
      }
      let history = [{ opId: assetId.slice(4), payload: contract }]
      let currentBlindSeal: { txid: string; vout: number; blinding: bigint } | undefined
      let firstPayloadBytes = 0
      let lastPayloadBytes = 0
      let totalPayloadBytes = 0
      let maxPrepareMs = 0
      let maxCompleteMs = 0

      for (let round = 1; round <= rounds; round++) {
        const actor = round % 2 === 1 ? 'A->B' : 'B->A'
        // A blind invoice targets the next participant's already-funded
        // Taproot RGB UTXO. This matches the wallet's actual receive model;
        // a witness receive output is not an RGB funding UTXO in this code.
        const nextBlindSeal = {
          txid: round.toString(16).padStart(64, '0'),
          vout: 0,
          blinding: BigInt(round),
        }
        const invoice = decodeRgbInvoice(
          encodeBlindRgbInvoice({
            network: 'mainnet',
            seal: nextBlindSeal,
            assetId,
            amount: '100',
            transportEndpoints: ['rpcs://stress.invalid'],
          })
        )
        const request = { assetId, amount: '100', invoice: invoice.raw, feeRate: 2 }
        const input = {
          wallet: {
            // Actor names make the output readable; this synthetic test does
            // not exercise actual key ownership or signatures.
            walletId: actor,
            fundingAddress: `bc1p-stress-${round % 2 === 1 ? 'a' : 'b'}`,
            network: 'mainnet' as const,
          },
          snapshot: { utxos: [utxo], syncedAt: round },
          request,
          intent: {
            assetId,
            amount: '100',
            invoice,
            transition: {
              assetId,
              inputAmount: '100',
              recipientAmount: '100',
              changeAmount: '0',
              recipientId: invoice.recipientId,
              inputs: [{ outpoint: utxo.outpoint, assetId, amount: '100' }],
              preservedAllocations: [],
            },
          },
          selectedUtxos: [utxo],
          feeFunding: {
            // Reusing this synthetic fee UTXO is intentional: no transaction
            // is broadcast, so chain double-spend rules are not in scope.
            utxos: [
              {
                outpoint: { txid: 'cc'.repeat(32), vout: 1 },
                satoshis: 10_000,
                scriptPubKey: fundingScript,
                publicKey: fundingPublicKey,
              },
            ],
            changeScriptPubKey: fundingScript,
            changeDustLimit: 330,
          },
          validationHistory: {
            assetId,
            consignments: history,
            localContract: contract,
            localGenesis: Buffer.from(genesis.strict).toString('base64'),
            ...(currentBlindSeal ? { knownBlindSeals: [currentBlindSeal] } : {}),
          },
        }

        const prepareStartedAt = process.hrtime.bigint()
        const prepared = await localNiaProtocolEncoder.prepareTransfer(input)
        maxPrepareMs = Math.max(maxPrepareMs, elapsedMs(prepareStartedAt))

        const completeStartedAt = process.hrtime.bigint()
        const completed = await localNiaProtocolEncoder.completeTransfer({
          wallet: input.wallet,
          pending: { prepared, request, createdAt: round },
          signedPsbt: signedPsbt(prepared.psbt),
        })
        maxCompleteMs = Math.max(maxCompleteMs, elapsedMs(completeStartedAt))

        const payload = completed.consignments[0]!.payload
        const decoded = decodeNiaConsignment(Uint8Array.from(Buffer.from(payload, 'base64')))
        const transition = decoded.transitions.find(item => item.opId === prepared.id)
        const assignmentIndex = transition?.assignments.findIndex(
          assignment =>
            'secretSeal' in assignment.seal &&
            assignment.seal.secretSeal === Buffer.from(concealBlindSeal(nextBlindSeal)).toString('hex')
        )
        expect(transition).toBeDefined()
        expect(assignmentIndex).toBeGreaterThanOrEqual(0)
        expect(decoded.witnessBundles).toHaveLength(round)

        lastPayloadBytes = Buffer.byteLength(payload, 'base64')
        firstPayloadBytes ||= lastPayloadBytes
        totalPayloadBytes += lastPayloadBytes
        utxo = {
          ...utxo,
          outpoint: { txid: nextBlindSeal.txid, vout: nextBlindSeal.vout },
          satoshis: 10_000,
          allocations: [
            {
              assetId,
              amount: '100',
              settled: true,
              spendable: true,
              opId: prepared.id,
              assignmentIndex: assignmentIndex!,
              assignmentType: 4000,
            },
          ],
        }
        // The latest transfer already contains the complete ancestry. Keeping
        // only it models a compact backend response while preserving the same
        // worst-case serialized history in each outgoing consignment.
        history = [{ opId: prepared.id, payload }]
        currentBlindSeal = nextBlindSeal

        if (round % logEvery === 0 || round === rounds) {
          console.info(
            JSON.stringify({
              round,
              direction: actor,
              historyBundles: decoded.witnessBundles.length,
              consignmentBytes: lastPayloadBytes,
              elapsedMs: Number(elapsedMs(startedAt).toFixed(1)),
            })
          )
        }
      }

      console.info(
        JSON.stringify({
          result: 'ok',
          rounds,
          genesisContractBytes: Buffer.byteLength(contract, 'base64'),
          firstConsignmentBytes: firstPayloadBytes,
          lastConsignmentBytes: lastPayloadBytes,
          totalProducedConsignmentBytes: totalPayloadBytes,
          growthBytes: lastPayloadBytes - firstPayloadBytes,
          maxPrepareMs: Number(maxPrepareMs.toFixed(1)),
          maxCompleteMs: Number(maxCompleteMs.toFixed(1)),
          elapsedMs: Number(elapsedMs(startedAt).toFixed(1)),
        })
      )
    },
    10 * 60_000
  )
})

if (process.env['RGB_STRESS_ROUNDS'] && !enabled) {
  throw new Error('RGB_STRESS_ROUNDS must be an integer between 1 and 10000')
}
