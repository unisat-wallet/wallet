import { describe, expect, it } from 'vitest'
import { planFungibleTransition } from '../src'

const outpoint = { txid: 'a'.repeat(64), vout: 0 }

describe('planFungibleTransition', () => {
  it('conserves the transferred allocation and records asset change', () => {
    const plan = planFungibleTransition({
      assetId: 'rgb:AwMDAwMD-AwMDAwM-DAwMDAw-MDAwMDA-wMDAwMD-AwMDAwM',
      amount: '40',
      recipientId: 'bc:tapret:recipient',
      selectedUtxos: [
        {
          outpoint,
          satoshis: 1000,
          scriptPubKey: '5120' + '00'.repeat(32),
          publicKey: '02' + '11'.repeat(32),
          allocations: [{ assetId: 'rgb:AwMDAwMD-AwMDAwM-DAwMDAw-MDAwMDA-wMDAwMD-AwMDAwM', amount: '60', settled: true, spendable: true }],
        },
      ],
    })

    expect(plan).toMatchObject({
      inputAmount: '60',
      recipientAmount: '40',
      changeAmount: '20',
    })
  })

  it('requires preservation transitions for other assets on a selected UTXO', () => {
    const plan = planFungibleTransition({
      assetId: 'rgb:AwMDAwMD-AwMDAwM-DAwMDAw-MDAwMDA-wMDAwMD-AwMDAwM',
      amount: '60',
      recipientId: 'bc:tapret:recipient',
      selectedUtxos: [
        {
          outpoint,
          satoshis: 1000,
          scriptPubKey: '5120' + '00'.repeat(32),
          publicKey: '02' + '11'.repeat(32),
          allocations: [
            { assetId: 'rgb:AwMDAwMD-AwMDAwM-DAwMDAw-MDAwMDA-wMDAwMD-AwMDAwM', amount: '60', settled: true, spendable: true },
            { assetId: 'rgb:BAQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE-BAQEBAQ', amount: '5', settled: true, spendable: true },
          ],
        },
      ],
    })

    expect(plan.preservedAllocations).toEqual([{ outpoint, assetId: 'rgb:BAQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE-BAQEBAQ', amount: '5' }])
  })
})
