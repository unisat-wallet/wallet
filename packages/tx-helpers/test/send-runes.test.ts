import { AddressType, NetworkType } from '@unisat/wallet-types'
import { beforeEach, describe, expect, it } from 'vitest'
import { Runestone } from '@unisat/alkanes-lib'
import { LocalWallet, sendRunes } from '../src'
import { dummySendRunes, expectFeeRate, genDummyUtxo, genDummyUtxos } from './utils'

describe('send runes', () => {
  beforeEach(() => {
    // todo
  })

  const testAddressTypes = [
    AddressType.P2TR,
    AddressType.P2SH_P2WPKH,
    AddressType.P2PKH,
    AddressType.P2SH_P2WPKH,
    // AddressType.M44_P2TR, // deprecated
    // AddressType.M44_P2WPKH, // deprecated
  ]

  it.each(['0', '00', '0x0', '0X0', '-0', ' 0', 'abc', '1.5'])(
    'rejects invalid rune edict amount %j',
    async runeAmount => {
      await expect(
        sendRunes({
          assetUtxos: [],
          btcUtxos: [],
          assetAddress: '',
          btcAddress: '',
          toAddress: '',
          networkType: NetworkType.MAINNET,
          runeid: '1000:10',
          runeAmount,
          outputValue: 546,
          feeRate: 1,
        })
      ).rejects.toThrow('Rune amount must be a positive integer')
    }
  )

  testAddressTypes.forEach(addressType => {
    const fromBtcWallet = LocalWallet.fromRandom(addressType, NetworkType.MAINNET)
    const fromAssetWallet = LocalWallet.fromRandom(addressType, NetworkType.MAINNET)

    const toWallet = LocalWallet.fromRandom(addressType, NetworkType.MAINNET)

    describe('basic ' + addressType, function () {
      it('send runes', async function () {
        const ret = await dummySendRunes({
          toAddress: toWallet.address,
          assetWallet: fromAssetWallet,
          assetUtxo: genDummyUtxo(fromAssetWallet, 546, {
            runes: [
              {
                runeid: '1000:10',
                amount: '100',
              },
            ],
          }),
          btcWallet: fromBtcWallet,
          btcUtxos: [genDummyUtxo(fromBtcWallet, 10000)],
          feeRate: 1,
          runeid: '1000:10',
          runeAmount: '100',
          outputValue: 546,
        })
        expect(ret.inputCount).eq(2)
        expect(ret.outputCount).eq(3)
        expectFeeRate(addressType, ret.feeRate, 1)

        const runestone = Runestone.fromOpreturnHex(
          ret.psbt.txOutputs[0].script.toString('hex')
        ) as Runestone
        expect(runestone.edicts).toHaveLength(1)
        expect(runestone.edicts[0]).toMatchObject({ amount: 100n, output: 1 })
        expect(runestone.edicts[0]?.id.toString()).toBe('1000:10')
      })

      it('send runes with changed', async function () {
        const ret = await dummySendRunes({
          toAddress: toWallet.address,
          assetWallet: fromAssetWallet,
          assetUtxo: genDummyUtxo(fromAssetWallet, 546, {
            runes: [
              {
                runeid: '1000:10',
                amount: '200',
              },
            ],
          }),
          btcWallet: fromBtcWallet,
          btcUtxos: [genDummyUtxo(fromBtcWallet, 10000)],
          feeRate: 1,
          runeid: '1000:10',
          runeAmount: '100',
          outputValue: 546,
        })
        expect(ret.inputCount).eq(2)
        expect(ret.outputCount).eq(4)
        expectFeeRate(addressType, ret.feeRate, 1)
      })

      it('send runes with mutlple runes utxo', async function () {
        const ret = await dummySendRunes({
          toAddress: toWallet.address,
          assetWallet: fromAssetWallet,
          assetUtxo: genDummyUtxo(fromAssetWallet, 546, {
            runes: [
              {
                runeid: '1000:10',
                amount: '100',
              },
              {
                runeid: '1001:10',
                amount: '100',
              },
              {
                runeid: '1002:10',
                amount: '100',
              },
            ],
          }),
          btcWallet: fromBtcWallet,
          btcUtxos: [genDummyUtxo(fromBtcWallet, 10000)],
          feeRate: 1,
          runeid: '1000:10',
          runeAmount: '100',
          outputValue: 546,
        })
        expect(ret.inputCount).eq(2)
        expect(ret.outputCount).eq(4)
        expectFeeRate(addressType, ret.feeRate, 1)

        const runestone = Runestone.fromOpreturnHex(
          ret.psbt.txOutputs[0].script.toString('hex')
        ) as Runestone
        expect(runestone.pointer).toEqual([BigInt(1)])
        expect(runestone.edicts[0]).toMatchObject({ amount: BigInt(100), output: 2 })
      })

      it('returns alkanes to a dedicated pointer output', async function () {
        const ret = await dummySendRunes({
          toAddress: toWallet.address,
          assetWallet: fromAssetWallet,
          assetUtxo: genDummyUtxo(fromAssetWallet, 546, {
            runes: [{ runeid: '1000:10', amount: '100' }],
            alkanes: [{ alkaneid: '2:10', amount: '100' }],
          }),
          btcWallet: fromBtcWallet,
          btcUtxos: [genDummyUtxo(fromBtcWallet, 10000)],
          feeRate: 1,
          runeid: '1000:10',
          runeAmount: '100',
          outputValue: 546,
        })

        expect(ret.outputCount).eq(4)

        const runestone = Runestone.fromOpreturnHex(
          ret.psbt.txOutputs[0].script.toString('hex')
        ) as Runestone
        const protocol = runestone.protocols?.[0]
        if (!protocol) throw new Error('Expected Alkanes protocol data')

        expect(runestone.pointer).toEqual([BigInt(1)])
        expect(protocol.protocolData.pointer).toBe(BigInt(1))
        expect(runestone.edicts[0]).toMatchObject({ amount: BigInt(100), output: 2 })
      })
    })
  })

  describe('performance', function () {
    it('builds a 500-rune-input PSBT within 3 seconds with expected fee rate', async function () {
      const fromBtcWallet = LocalWallet.fromRandom(AddressType.P2TR, NetworkType.MAINNET)
      const fromAssetWallet = LocalWallet.fromRandom(AddressType.P2TR, NetworkType.MAINNET)
      const toWallet = LocalWallet.fromRandom(AddressType.P2TR, NetworkType.MAINNET)
      const assetUtxos = genDummyUtxos(
        fromAssetWallet,
        Array(500).fill(546),
        Array(500).fill({
          runes: [
            {
              runeid: '1000:10',
              amount: '1',
            },
          ],
        })
      )

      const start = performance.now()
      const { psbt, toSignInputs } = await sendRunes({
        assetUtxos,
        btcUtxos: [genDummyUtxo(fromBtcWallet, 100000)],
        toAddress: toWallet.address,
        networkType: fromBtcWallet.networkType,
        btcAddress: fromBtcWallet.address,
        assetAddress: fromAssetWallet.address,
        feeRate: 1,
        runeid: '1000:10',
        runeAmount: '500',
        outputValue: 546,
      })
      const duration = performance.now() - start

      expect(psbt.txInputs.length).eq(500)
      expect(psbt.txOutputs.length).eq(3)
      expect(duration).lt(3000)

      const assetToSignInputs = toSignInputs.filter(v => v.publicKey === fromAssetWallet.pubkey)
      await fromAssetWallet.signPsbt(psbt, {
        autoFinalized: false,
        toSignInputs: assetToSignInputs,
      })
      psbt.finalizeAllInputs()
      const tx = psbt.extractTransaction(true)
      const actualFeeRate = psbt.getFee() / tx.virtualSize()
      expect(actualFeeRate).gte(1)
      expect(actualFeeRate).lt(1.01)
    })
  })
})
