import { describe, expect, it } from 'vitest'
import { encodeRgbContractId } from '../src/protocol/contract-id'
import { verifyRevealedNiaAllocations } from '../src/protocol/nia-allocation'
import type { DecodedNiaConsignment } from '../src/protocol/nia-consignment'
import type { RgbUtxo } from '../src/types'

describe('NIA allocation history', () => {
  it('matches a revealed seal whose explicit txid differs from its parent witness', () => {
    const assetId = encodeRgbContractId(new Uint8Array(32).fill(1))
    const opId = '5c'.repeat(32)
    const txid = '9c'.repeat(32)
    const consignment = {
      assetId,
      witnessBundles: [{
        txid: '49'.repeat(32),
        outputs: [],
        transitions: [{
          opId,
          assignments: [
            { seal: { txid, vout: 3, blinding: 1n }, amount: 100n },
            { seal: { secretSeal: 'ab'.repeat(32) }, amount: 1n },
          ],
        }],
      }],
    } as unknown as DecodedNiaConsignment
    const utxo: RgbUtxo = {
      outpoint: { txid, vout: 3 },
      satoshis: 1000,
      scriptPubKey: `5120${'11'.repeat(32)}`,
      publicKey: `02${'22'.repeat(32)}`,
      allocations: [{
        assetId, amount: '100', settled: true, spendable: true,
        opId, assignmentIndex: 0, assignmentType: 4000,
      }],
    }

    expect(() => verifyRevealedNiaAllocations({ assetId, consignments: [consignment], utxos: [utxo] }))
      .not.toThrow()
    expect(() => verifyRevealedNiaAllocations({
      assetId, consignments: [consignment],
      utxos: [{ ...utxo, outpoint: { txid: 'aa'.repeat(32), vout: 3 } }],
    })).toThrow('RGB revealed allocation does not match its witness transaction output')
    expect(() => verifyRevealedNiaAllocations({
      assetId, consignments: [consignment],
      utxos: [{ ...utxo, outpoint: { txid, vout: 4 } }],
    })).toThrow('RGB revealed allocation does not match its witness transaction output')
    expect(() => verifyRevealedNiaAllocations({
      assetId, consignments: [consignment],
      utxos: [{ ...utxo, allocations: [{ ...utxo.allocations[0]!, amount: '99' }] }],
    })).toThrow('RGB revealed allocation does not match its witness transaction output')
  })
})
