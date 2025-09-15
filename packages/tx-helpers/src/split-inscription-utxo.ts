import { NetworkType } from '@unisat/wallet-types'
import { ToSignInput } from '@unisat/keyring-service/types'

import { ErrorCodes, WalletUtilsError } from './error'
import { InscriptionUnit, InscriptionUnspendOutput, Transaction, utxoHelper } from './transaction'
import { UnspentOutput } from './types'
import { bitcoin } from '@unisat/wallet-bitcoin'
export const UTXO_DUST = 546
export async function splitInscriptionUtxo({
  btcUtxos,
  assetUtxo,
  networkType,
  changeAddress,
  feeRate,
  enableRBF = true,
  outputValue = 546,
}: {
  btcUtxos: UnspentOutput[]
  assetUtxo: UnspentOutput
  networkType: NetworkType
  changeAddress: string
  feeRate: number
  enableRBF?: boolean
  outputValue?: number
}): Promise<{
  psbt: bitcoin.Psbt
  toSignInputs: any[]
  splitedCount: number
}> {
  if (utxoHelper.hasAnyAssets(btcUtxos)) {
    throw new WalletUtilsError(ErrorCodes.NOT_SAFE_UTXOS)
  }

  const tx = new Transaction()
  tx.setNetworkType(networkType)
  tx.setFeeRate(feeRate)
  tx.setEnableRBF(enableRBF)
  tx.setChangeAddress(changeAddress)

  const toSignInputs: ToSignInput[] = []

  let lastUnit: InscriptionUnit | undefined = undefined
  let splitedCount = 0
  const ordUtxo = new InscriptionUnspendOutput(assetUtxo, outputValue)
  tx.addInput(ordUtxo.utxo)
  toSignInputs.push({ index: 0, publicKey: ordUtxo.utxo.pubkey })

  for (let j = 0; j < ordUtxo.inscriptionUnits.length; j++) {
    const unit = ordUtxo.inscriptionUnits[j] as InscriptionUnit

    if (unit.hasInscriptions()) {
      tx.addChangeOutput(unit.satoshis)
      lastUnit = unit
      splitedCount++
      continue
    }
    tx.addChangeOutput(unit.satoshis)
    lastUnit = unit
  }
  if (!lastUnit) {
    throw new WalletUtilsError(ErrorCodes.UNKNOWN)
  }

  if (!lastUnit.hasInscriptions()) {
    tx.removeChangeOutput()
  }

  if (lastUnit.satoshis < UTXO_DUST) {
    lastUnit.satoshis = UTXO_DUST
  }

  const _toSignInputs = await tx.addSufficientUtxosForFee(btcUtxos)
  toSignInputs.push(..._toSignInputs)

  const psbt = tx.toPsbt()

  return { psbt, toSignInputs, splitedCount }
}
