import { bitcoin } from '@unisat/wallet-bitcoin'
import { DummyTxType, RiskType } from '@unisat/wallet-shared'
import { AddressType, NetworkType } from '@unisat/wallet-types'
import { describe, expect, it } from 'vitest'
import { PsbtDecoder, createDummyTx, getSighashSingleInputIndexes } from '../src'
import { LocalWallet } from '../src/wallet/local-wallet'

async function decodeWithSighashType(sighashType: number) {
  const wallet = LocalWallet.fromRandom(AddressType.P2TR, NetworkType.MAINNET)
  const { psbt, toSignInputs } = createDummyTx({
    address: wallet.address,
    pubkey: wallet.pubkey,
    txType: DummyTxType.SEND_BTC,
  })
  psbt.data.inputs[0]!.sighashType = sighashType

  const decoder = new PsbtDecoder({
    toSignData: {
      psbtHex: psbt.toHex(),
      toSignInputs,
    },
    networkType: NetworkType.MAINNET,
  })
  return decoder.decode()
}

describe('decode psbt sighash risk detection', () => {
  it('identifies only signed inputs using SIGHASH_SINGLE, including ANYONECANPAY', () => {
    const indexes = getSighashSingleInputIndexes(
      {
        psbtHex: '',
        toSignInputs: [
          { index: 0, publicKey: '', sighashTypes: [bitcoin.Transaction.SIGHASH_SINGLE] },
          { index: 1, publicKey: '' },
          { index: 2, publicKey: '' },
        ],
      },
      [
        { sighashType: bitcoin.Transaction.SIGHASH_ALL },
        { sighashType: bitcoin.Transaction.SIGHASH_SINGLE },
        {
          sighashType:
            bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY,
        },
        { sighashType: bitcoin.Transaction.SIGHASH_SINGLE },
      ]
    )

    expect(indexes).toEqual([1, 2])
  })

  it('detects SIGHASH_NONE as dangerous', async () => {
    const dangerous = await decodeWithSighashType(bitcoin.Transaction.SIGHASH_NONE)
    expect(dangerous.risks.some(r => r.type === RiskType.SIGHASH_NONE)).toBe(true)
  })

  it('detects SIGHASH_NONE | ANYONECANPAY as dangerous', async () => {
    const dangerous = await decodeWithSighashType(
      bitcoin.Transaction.SIGHASH_NONE | bitcoin.Transaction.SIGHASH_ANYONECANPAY
    )
    expect(dangerous.risks.some(r => r.type === RiskType.SIGHASH_NONE)).toBe(true)
  })

  it('does not flag SIGHASH_SINGLE | ANYONECANPAY as dangerous', async () => {
    const safe = await decodeWithSighashType(
      bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY
    )
    expect(safe.risks.some(r => r.type === RiskType.SIGHASH_NONE)).toBe(false)
  })

  it('does not flag SIGHASH_ALL as dangerous', async () => {
    const safe = await decodeWithSighashType(bitcoin.Transaction.SIGHASH_ALL)
    expect(safe.risks.some(r => r.type === RiskType.SIGHASH_NONE)).toBe(false)
  })
})
