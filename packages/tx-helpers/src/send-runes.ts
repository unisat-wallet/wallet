import bigInt from 'big-integer'

import { createTx } from './transaction/transaction'
import { utxoHelper } from './transaction/utxo'
import { UnspentOutput } from './types'
import { encodeRunestoneProtostone, ProtoStone, RuneId } from '@unisat/alkanes-lib'
import { NetworkType } from '@unisat/wallet-types'
import { ToSignInput } from '@unisat/keyring-service/types'
import { ErrorCodes, WalletError } from '@unisat/wallet-shared'

// only one arc20 can be send
export async function sendRunes({
  assetUtxos,
  btcUtxos,
  assetAddress,
  btcAddress,
  toAddress,
  networkType,
  runeid,
  runeAmount,
  outputValue,
  feeRate,
  enableRBF = true,
}: {
  assetUtxos: UnspentOutput[]
  btcUtxos: UnspentOutput[]
  assetAddress: string
  btcAddress: string
  toAddress: string
  networkType: NetworkType
  runeid: string
  runeAmount: string
  outputValue: number
  feeRate: number
  enableRBF?: boolean
}) {
  if (!/^[1-9]\d*$/.test(runeAmount)) {
    throw new Error('Rune amount must be a positive integer')
  }
  const parsedRuneAmount = BigInt(runeAmount)

  // safe check
  if (utxoHelper.hasInscription(assetUtxos)) {
    throw new WalletError(ErrorCodes.NOT_SAFE_UTXOS)
  }

  if (utxoHelper.hasAnyAssets(btcUtxos)) {
    throw new WalletError(ErrorCodes.NOT_SAFE_UTXOS)
  }

  const tx = createTx({ networkType, feeRate, changeAddress: btcAddress, enableRBF })

  const toSignInputs: ToSignInput[] = []

  // add assets
  assetUtxos.forEach((v, index) => {
    tx.addInput(v)
    toSignInputs.push({ index, publicKey: v.pubkey })
  })

  let fromRuneAmount = bigInt(0)
  let hasOtherRunes = false
  let hasAlkanes = false
  assetUtxos.forEach(v => {
    if (v.runes) {
      v.runes.forEach(w => {
        if (w.runeid === runeid) {
          fromRuneAmount = fromRuneAmount.plus(bigInt(w.amount))
        } else {
          hasOtherRunes = true
        }
      })
    }
    if (v.alkanes?.length) {
      hasAlkanes = true
    }
  })

  const changedRuneAmount = fromRuneAmount.minus(bigInt(parsedRuneAmount.toString()))

  if (changedRuneAmount.lt(0)) {
    throw new WalletError(ErrorCodes.INSUFFICIENT_ASSET_UTXO)
  }

  let needChange = false
  if (hasOtherRunes || hasAlkanes || changedRuneAmount.gt(0)) {
    needChange = true
  }

  const runeId = RuneId.fromString(runeid)
  const runeOutput = needChange ? 2 : 1
  const changeOutput = needChange ? 1 : runeOutput
  const protostones = hasAlkanes
    ? [
        ProtoStone.message({
          protocolTag: BigInt(1),
          pointer: changeOutput,
          refundPointer: 0,
          calldata: Buffer.alloc(0),
        }),
      ]
    : []
  const script = encodeRunestoneProtostone({
    pointer: changeOutput,
    edicts: [{ id: runeId, amount: parsedRuneAmount, output: runeOutput }],
    protostones,
  }).encodedRunestone

  // add op_return
  tx.addScriptOutput(script, 0)

  if (needChange) {
    // OUTPUT_1
    // add change
    tx.addOutput(assetAddress, outputValue)
  }

  tx.addOutput(toAddress, outputValue)

  // add btc
  const _toSignInputs = await tx.addSufficientUtxosForFee(btcUtxos, true)
  toSignInputs.push(..._toSignInputs)

  const psbt = tx.toPsbt()

  return { psbt, toSignInputs }
}
