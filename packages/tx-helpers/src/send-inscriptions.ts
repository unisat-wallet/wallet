import { NetworkType } from '@unisat/wallet-types'
import { ErrorCodes, WalletUtilsError } from './error'
import { Transaction } from './transaction/transaction'
import { utxoHelper } from './transaction/utxo'
import { UnspentOutput } from './types'
import { bitcoin } from '@unisat/wallet-bitcoin'
import { ToSignInput } from '@unisat/keyring-service/types'

export async function sendInscriptions({
  assetUtxos,
  btcUtxos,
  toAddress,
  networkType,
  changeAddress,
  feeRate,
  enableRBF = true,
}: {
  assetUtxos: UnspentOutput[]
  btcUtxos: UnspentOutput[]
  toAddress: string
  networkType: NetworkType
  changeAddress: string
  feeRate: number
  enableRBF?: boolean
}): Promise<{
  psbt: bitcoin.Psbt
  toSignInputs: any[]
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

  for (let i = 0; i < assetUtxos.length; i++) {
    const assetUtxo = assetUtxos[i]!
    if (assetUtxo.inscriptions.length > 1) {
      throw new Error('Multiple inscriptions in one UTXO! Please split them first.')
    }
    tx.addInput(assetUtxo)
    tx.addOutput(toAddress, assetUtxo.satoshis)
    toSignInputs.push({ index: i, publicKey: assetUtxo.pubkey })
  }

  const _toSignInputs = await tx.addSufficientUtxosForFee(btcUtxos)
  toSignInputs.push(..._toSignInputs)

  const psbt = tx.toPsbt()

  return { psbt, toSignInputs }
}
