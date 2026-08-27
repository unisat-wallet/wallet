import {
  RgbService,
  type RgbPendingIssue,
  type RgbPendingReceiveHistory,
  type RgbPendingUtxoSync,
  type RgbUtxo,
} from '@unisat/rgb-service'

import type { LocalRgbWallet } from './RgbWalletCoordinator'

type RgbIndexerOutboxDependencies = {
  syncIssue: (issue: RgbPendingIssue, wallet: LocalRgbWallet) => Promise<void>
  replaceUtxos: (sync: RgbPendingUtxoSync, wallet: LocalRgbWallet) => Promise<void>
  syncReceiveHistory: (receive: RgbPendingReceiveHistory, wallet: LocalRgbWallet) => Promise<void>
  warn: (message: string, error: unknown) => void
}

/** Retries local RGB state that has been durably committed but not indexed remotely. */
export class RgbIndexerOutbox {
  constructor(private readonly dependencies: RgbIndexerOutboxDependencies) {}

  async sync(service: RgbService, wallet: LocalRgbWallet): Promise<boolean> {
    let synced = true
    // Optional guards preserve compatibility with lightweight controller test doubles.
    for (const issue of service.getPendingIssues?.() || []) {
      try {
        await this.dependencies.syncIssue(issue, wallet)
        await service.markIssueSynced(issue.assetId)
      } catch (error) {
        synced = false
        this.dependencies.warn('Failed to sync pending RGB issuance', error)
      }
    }

    const utxoSync = service.getPendingUtxoSync?.()
    if (utxoSync) {
      try {
        await this.dependencies.replaceUtxos(utxoSync, wallet)
        await service.markUtxoSyncCompleted(utxoSync.txid)
      } catch (error) {
        synced = false
        this.dependencies.warn('Failed to sync pending RGB UTXOs', error)
      }
    }
    return synced
  }

  async syncReceiveHistory(service: RgbService, wallet: LocalRgbWallet): Promise<void> {
    for (const receive of service.getPendingReceiveHistory?.() || []) {
      if (receive.status && receive.status !== 'settled') continue
      try {
        await this.dependencies.syncReceiveHistory(receive, wallet)
        await service.markReceiveHistorySynced(receive.transferId)
      } catch (error) {
        this.dependencies.warn('Failed to sync RGB receive history', error)
      }
    }
  }
}

export function toRgbIndexedUtxos(outpoints: RgbUtxo[]): Array<{
  txid: string
  vout: number
  satoshis: number
  scriptPk: string
  publicKey: string
  allocations: RgbUtxo['allocations']
}> {
  return outpoints.map(utxo => ({
    txid: utxo.outpoint.txid,
    vout: utxo.outpoint.vout,
    satoshis: utxo.satoshis,
    scriptPk: utxo.scriptPubKey,
    publicKey: utxo.publicKey,
    allocations: utxo.allocations,
  }))
}
