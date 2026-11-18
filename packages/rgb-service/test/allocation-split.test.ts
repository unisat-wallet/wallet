import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import { encodeRgbContractId, prepareAllocationSplit } from '../src'

describe('prepareAllocationSplit', () => {
  it('builds one transition and one carrier output for each contract', () => {
    const assetIds = [1, 2].map(value =>
      encodeRgbContractId(Uint8Array.from({ length: 32 }, () => value))
    )
    const selectedUtxo = {
      outpoint: { txid: 'a'.repeat(64), vout: 0 },
      satoshis: 330,
      scriptPubKey: `5120${'11'.repeat(32)}`,
      publicKey: `02${'22'.repeat(32)}`,
      allocations: assetIds.map((assetId, index) => ({
        assetId,
        amount: String((index + 1) * 10),
        settled: true,
        spendable: true,
        opId: String(index + 3).repeat(64),
        assignmentIndex: index,
        assignmentType: 4000,
      })),
    }
    const prepared = prepareAllocationSplit({
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
      selectedUtxo,
      feeRate: 2,
      feeFunding: {
        utxos: [{
          outpoint: { txid: 'b'.repeat(64), vout: 1 },
          satoshis: 10_000,
          scriptPubKey: selectedUtxo.scriptPubKey,
          publicKey: selectedUtxo.publicKey,
        }],
        changeScriptPubKey: selectedUtxo.scriptPubKey,
        changeDustLimit: 330,
      },
      histories: assetIds.map(assetId => ({
        assetId,
        format: 'v1' as const,
        genesis: Uint8Array.from([0, 0]),
        witnessBundles: [],
      })),
    })
    const psbt = Psbt.fromHex(prepared.psbt)
    const assets = JSON.parse(prepared.metadata?.['assets'] || '[]')

    expect(prepared.lockedOutpoints).toEqual([selectedUtxo.outpoint])
    expect(assets).toHaveLength(2)
    expect(assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: assetIds[0], amount: '10' }),
      expect.objectContaining({ assetId: assetIds[1], amount: '20' }),
    ]))
    expect(assets.map((asset: { vout: number }) => asset.vout).sort()).toEqual([1, 2])
    expect(psbt.txOutputs.slice(1, 3).map(output => output.value)).toEqual([330, 330])
    // Two transition records plus the shared close-method record.
    expect(psbt.data.globalMap.unknownKeyVals).toHaveLength(3)
  })
})
