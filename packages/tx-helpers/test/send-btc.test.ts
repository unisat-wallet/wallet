import { ErrorCodes, UnspentOutput } from '@unisat/wallet-shared'
import { AddressType, NetworkType } from '@unisat/wallet-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalWallet, sendAllBTC, sendBTC, Transaction } from '../src'
import { dummySendAllBTC, dummySendBTC, expectFeeRate, genDummyUtxo, genDummyUtxos } from './utils'

describe('sendBTC', () => {
  beforeEach(() => {
    // todo
  })

  const testAddressTypes = [
    AddressType.P2TR,
    AddressType.P2WPKH,
    AddressType.P2PKH,
    AddressType.P2SH_P2WPKH,
    AddressType.M44_P2TR, // deprecated
    AddressType.M44_P2WPKH, // deprecated
  ]
  testAddressTypes.forEach(addressType => {
    const fromWallet = LocalWallet.fromRandom(addressType, NetworkType.MAINNET)
    const toWallet = LocalWallet.fromRandom(addressType, NetworkType.MAINNET)

    describe('basic ' + addressType, function () {
      it('huge balance', async function () {
        const ret = await dummySendBTC({
          wallet: fromWallet,
          btcUtxos: [genDummyUtxo(fromWallet, 100000000)],
          tos: [{ address: toWallet.address, satoshis: 1000 }],
          feeRate: 1,
        })
        expect(ret.inputCount).eq(1)
        expect(ret.outputCount).eq(2)
        expectFeeRate(addressType, ret.feeRate, 1)
        expect(ret.psbt.txOutputs[0].value).eq(1000)
      })

      it('send all balance', async function () {
        const ret = await dummySendAllBTC({
          wallet: fromWallet,
          toAddress: toWallet.address,
          btcUtxos: genDummyUtxos(fromWallet, [100000000, 100000000]),
          feeRate: 1,
        })
        expect(ret.inputCount).eq(2)
        expect(ret.outputCount).eq(1)
        expectFeeRate(addressType, ret.feeRate, 1)
        expect(ret.psbt.txOutputs[0].address).eq(toWallet.address)
      })

      it('estimates send-all fee without signing a dummy PSBT', async function () {
        const calNetworkFeeSpy = vi.spyOn(Transaction.prototype, 'calNetworkFee')
        const ret = await sendAllBTC({
          btcUtxos: genDummyUtxos(fromWallet, [100000000, 100000000]),
          toAddress: toWallet.address,
          networkType: fromWallet.networkType,
          feeRate: 1,
        })

        expect(calNetworkFeeSpy).not.toHaveBeenCalled()

        await fromWallet.signPsbt(ret.psbt, { autoFinalized: true, toSignInputs: ret.toSignInputs })
        const tx = ret.psbt.extractTransaction(true)
        expect(ret.psbt.getFee()).gte(tx.virtualSize())
        expect(ret.psbt.getFee() - tx.virtualSize()).lte(4)

        calNetworkFeeSpy.mockRestore()
      })

      it('sets RBF sequence by default and preserves final sequence when disabled', async function () {
        const rbfRet = await sendBTC({
          btcUtxos: [genDummyUtxo(fromWallet, 100000000)],
          tos: [{ address: toWallet.address, satoshis: 1000 }],
          networkType: fromWallet.networkType,
          changeAddress: fromWallet.address,
          feeRate: 1,
        })
        expect(rbfRet.psbt.txInputs[0].sequence).eq(0xfffffffd)

        const nonRbfRet = await sendBTC({
          btcUtxos: [genDummyUtxo(fromWallet, 100000000)],
          tos: [{ address: toWallet.address, satoshis: 1000 }],
          networkType: fromWallet.networkType,
          changeAddress: fromWallet.address,
          feeRate: 1,
          enableRBF: false,
        })
        expect(nonRbfRet.psbt.txInputs[0].sequence).eq(0xffffffff)
      })
    })

    describe('fee rate ' + addressType, function () {
      const feeRates = [1, 1.3, 10, 1000, 10000]
      feeRates.forEach(feeRate => {
        it('feeRate=' + feeRate, async function () {
          const ret = await dummySendBTC({
            wallet: fromWallet,
            btcUtxos: [genDummyUtxo(fromWallet, 100000000)],
            tos: [{ address: toWallet.address, satoshis: 1000 }],
            feeRate,
          })
          expect(ret.inputCount).eq(1)
          expect(ret.outputCount).eq(2)
          expectFeeRate(addressType, ret.feeRate, feeRate)
          expect(ret.psbt.txOutputs[0].value).eq(1000)
        })
      })
    })

    describe('select UTXO', function () {
      it('1 utxo', async function () {
        const ret = await dummySendBTC({
          wallet: fromWallet,
          btcUtxos: [genDummyUtxo(fromWallet, 100000000)],
          tos: [{ address: toWallet.address, satoshis: 1000 }],
          feeRate: 1,
        })
        expect(ret.inputCount).eq(1)
        expect(ret.outputCount).eq(2)
        expectFeeRate(addressType, ret.feeRate, 1)
      })

      it('total 2 utxo but only use 1', async function () {
        const { inputCount, outputCount } = await dummySendBTC({
          wallet: fromWallet,
          btcUtxos: [genDummyUtxo(fromWallet, 10000), genDummyUtxo(fromWallet, 1000)],
          tos: [{ address: toWallet.address, satoshis: 1000 }],
          feeRate: 1,
        })
        expect(inputCount).eq(1)
        expect(outputCount).eq(2)
        expectFeeRate(addressType, 1, 1)
      })

      it('total 3 utxo', async function () {
        const ret = await dummySendBTC({
          wallet: fromWallet,
          btcUtxos: genDummyUtxos(fromWallet, [5000, 5000, 10000]),
          tos: [{ address: toWallet.address, satoshis: 10000 }],
          feeRate: 1,
        })
        expect(ret.inputCount).eq(3)
        expect(ret.outputCount).eq(2)
        expectFeeRate(addressType, ret.feeRate, 1)
      })

      it('insufficent balance', async function () {
        try {
          await dummySendBTC({
            wallet: fromWallet,
            btcUtxos: genDummyUtxos(fromWallet, [5000, 5000, 278]),
            tos: [{ address: toWallet.address, satoshis: 10000 }],
            feeRate: 1,
          })
        } catch (e: any) {
          expect(e.code).eq(ErrorCodes.INSUFFICIENT_FEE_UTXO)
        }
      })
    })

    describe('send to multi receivers', function () {
      it('2 receivers', async function () {
        const ret = await dummySendBTC({
          wallet: fromWallet,
          tos: [
            {
              address: toWallet.address,
              satoshis: 1000,
            },
            {
              address: toWallet.address,
              satoshis: 5000,
            },
          ],
          btcUtxos: [genDummyUtxo(fromWallet, 10000)],
          feeRate: 1,
        })
        expect(ret.inputCount).eq(1)
        expect(ret.outputCount).eq(3)
        expectFeeRate(addressType, ret.feeRate, 1)
      })
    })

    describe('to many UTXO', function () {
      it('500 inputs => 2 outputs', async function () {
        const btcUtxos: UnspentOutput[] = []
        for (let i = 0; i < 1000; i++) {
          btcUtxos.push(genDummyUtxo(fromWallet, 1000))
        }
        const ret = await dummySendBTC({
          wallet: fromWallet,
          btcUtxos,
          tos: [{ address: toWallet.address, satoshis: 1000 * 500 }],
          feeRate: 1,
        })
        expect(ret.psbt.txOutputs[0].address).eq(toWallet.address)
        expect(ret.psbt.txOutputs[0].value).eq(1000 * 500)
        expectFeeRate(addressType, ret.feeRate, 1)
      })
    })

    describe('send with memo', function () {
      it('allow hex and utf8 ', async function () {
        const ret1 = await dummySendBTC({
          wallet: fromWallet,
          tos: [
            {
              address: toWallet.address,
              satoshis: 1000,
            },
          ],
          btcUtxos: [genDummyUtxo(fromWallet, 10000)],
          feeRate: 1,
          memo: Buffer.from('hello').toString('hex'),
          // dump: true,
        })
        const data1 = ret1.psbt.txOutputs[1].script.toString('hex')
        expect(ret1.inputCount).eq(1)
        expect(ret1.outputCount).eq(3)
        expectFeeRate(addressType, ret1.feeRate, 1)

        const ret2 = await dummySendBTC({
          wallet: fromWallet,
          tos: [
            {
              address: toWallet.address,
              satoshis: 1000,
            },
          ],
          btcUtxos: [genDummyUtxo(fromWallet, 10000)],
          feeRate: 1,
          memo: 'hello',
        })
        const data2 = ret2.psbt.txOutputs[1].script.toString('hex')
        expect(data1).eq(data2)
      })
    })

    describe('send with memos', function () {
      it('allow hex and utf8 ', async function () {
        const ret1 = await dummySendBTC({
          wallet: fromWallet,
          tos: [
            {
              address: toWallet.address,
              satoshis: 1000,
            },
          ],
          btcUtxos: [genDummyUtxo(fromWallet, 10000)],
          feeRate: 1,
          memos: ['52554e455f54455354', '0083ed9fceff016401'],
          // dump: true,
        })
        const data1 = ret1.psbt.txOutputs[1].script.toString('hex')
        expect(ret1.inputCount).eq(1)
        expect(ret1.outputCount).eq(3)
        expectFeeRate(addressType, ret1.feeRate, 1)
        expect(data1).eq('6a0952554e455f54455354090083ed9fceff016401')
      })
    })
  })

  describe('sendAllBTC performance', function () {
    it('builds a 500-input send-all PSBT within 3 seconds', async function () {
      const fromWallet = LocalWallet.fromRandom(AddressType.P2WPKH, NetworkType.MAINNET)
      const toWallet = LocalWallet.fromRandom(AddressType.P2WPKH, NetworkType.MAINNET)
      const btcUtxos = genDummyUtxos(fromWallet, Array(500).fill(100000))

      const start = performance.now()
      const ret = await sendAllBTC({
        btcUtxos,
        toAddress: toWallet.address,
        networkType: fromWallet.networkType,
        feeRate: 1,
      })
      const duration = performance.now() - start

      expect(ret.psbt.txInputs.length).eq(500)
      expect(ret.psbt.txOutputs.length).eq(1)
      expect(duration).lt(3000)

      await fromWallet.signPsbt(ret.psbt, { autoFinalized: true, toSignInputs: ret.toSignInputs })
      const tx = ret.psbt.extractTransaction(true)
      const actualFeeRate = ret.psbt.getFee() / tx.virtualSize()
      expect(actualFeeRate).gte(1)
      expect(actualFeeRate).lt(1.01)
    })
  })

  describe('safe UTXO (descriptor integration regression)', function () {
    it('rejects inscription-bearing UTXOs with NOT_SAFE_UTXOS', async function () {
      const wallet = LocalWallet.fromRandom(AddressType.P2WPKH, NetworkType.MAINNET)
      await expect(
        sendBTC({
          btcUtxos: [
            genDummyUtxo(wallet, 10000, {
              inscriptions: [{ inscriptionId: 'i0', offset: 0 }],
            }),
          ],
          tos: [{ address: wallet.address, satoshis: 1000 }],
          networkType: NetworkType.MAINNET,
          changeAddress: wallet.address,
          feeRate: 1,
        })
      ).rejects.toMatchObject({
        code: ErrorCodes.NOT_SAFE_UTXOS,
      })
    })
  })

  describe('P2PKH', function () {
    const wallet_P2WPKH = LocalWallet.fromRandom(AddressType.P2WPKH, NetworkType.MAINNET)
    const wallet_P2PKH = LocalWallet.fromRandom(AddressType.P2PKH, NetworkType.MAINNET)

    it('use nonWitnessUtxo for P2PKH', async function () {
      const ret1 = await dummySendBTC({
        wallet: wallet_P2WPKH,
        btcUtxos: [genDummyUtxo(wallet_P2WPKH, 10000)],
        tos: [{ address: wallet_P2PKH.address, satoshis: 5000 }],
        feeRate: 1,
      })
      const tx1 = ret1.psbt.extractTransaction()
      const ret2 = await dummySendBTC({
        wallet: wallet_P2PKH,
        btcUtxos: [
          {
            txid: tx1.getId(),
            vout: 0,
            satoshis: 5000,
            scriptPk: wallet_P2PKH.scriptPk,
            addressType: wallet_P2PKH.addressType,
            pubkey: wallet_P2PKH.pubkey,
            inscriptions: [],
            rawtx: tx1.toHex(),
          },
        ],
        tos: [{ address: wallet_P2PKH.address, satoshis: 3000 }],
        feeRate: 1,
      })
      expect(ret2.feeRate).eq(1)
    })
  })
})
