import {
  RgbService,
  RgbTransferAwaitingAckError,
  RgbTransferRejectedError,
} from '@unisat/rgb-service'
import type { NetworkType } from '@unisat/wallet-types'

import type { LocalRgbServiceContext } from './RgbWalletCoordinator'

export type RgbRemoteActivity = {
  id?: string
  assetId?: string
  type?: string
  amount?: string | number | null
  txid?: string
  timestamp?: number
  createdAt?: number
  status?: string
  from?: string
  to?: string
  ticker?: string
  name?: string
  precision?: number
}

type RgbTransferQueryDependencies = {
  getContext: () => Promise<LocalRgbServiceContext>
  syncReceiveHistory: (service: RgbService, context: LocalRgbServiceContext) => Promise<void>
  syncPendingTransfers: (service: RgbService, context: LocalRgbServiceContext) => Promise<void>
  syncReceivedAllocations: () => Promise<LocalRgbServiceContext>
  getRemoteActivity: (
    address: string,
    currentPage: number,
    pageSize: number
  ) => Promise<{ total: number; list: RgbRemoteActivity[] }>
  getNetworkType: () => NetworkType
  getInvoiceDestination: (
    invoice: string | undefined,
    networkType: NetworkType
  ) => string | undefined
  getCounterpartyAddress: (
    scriptPubKeys: string[] | undefined,
    networkType: NetworkType,
    ownAddress: string
  ) => string | undefined
  getConsignmentOutputScripts: (payload?: string) => string[] | undefined
  warn: (message: string, error: unknown) => void
}

/** Merges durable local RGB records into the first page of indexer activity. */
export class RgbTransferQuery {
  constructor(private readonly dependencies: RgbTransferQueryDependencies) {}

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- preserve the precise merged activity response.
  async getTransfers(
    currentPage: number,
    pageSize: number,
    options?: { skipSync?: boolean }
  ) {
    let context = await this.dependencies.getContext()
    let { service, wallet } = context
    const activityPromise = this.dependencies.getRemoteActivity(
      wallet.fundingAddress,
      currentPage,
      pageSize
    )
    if (!options?.skipSync) {
      try {
        await this.dependencies.syncReceiveHistory(service, context)
      } catch (error) {
        this.dependencies.warn(
          'Failed to synchronize RGB receive history while loading activity',
          error
        )
      }
      if (service.getPendingTransfers().length) {
        try {
          await this.dependencies.syncPendingTransfers(service, context)
        } catch (error) {
          const hasRetryableBroadcast = service
            .getPendingTransfers()
            .some(transfer => !!transfer.delivery?.broadcastError)
          const hasBroadcastedTransfer = service
            .getPendingTransfers()
            .some(transfer => !!transfer.broadcast)
          if (
            !(error instanceof RgbTransferAwaitingAckError) &&
            !(error instanceof RgbTransferRejectedError) &&
            !hasRetryableBroadcast &&
            !hasBroadcastedTransfer
          ) {
            this.dependencies.warn(
              'Failed to synchronize pending RGB transfer while loading activity',
              error
            )
          }
        }
      }
      const hadPendingReceives = service.getPendingReceives().length > 0
      if (hadPendingReceives) {
        try {
          context = await this.dependencies.syncReceivedAllocations()
          ;({ service, wallet } = context)
          await this.dependencies.syncReceiveHistory(service, context)
        } catch (error) {
          // Consignment/claim processing may require the writer lease. A
          // read-only device still renders durable local and remote activity;
          // it retries this background work on a later poll.
          this.dependencies.warn('Failed to synchronize RGB receives while loading activity', error)
        }
      }
    }

    const networkType = this.dependencies.getNetworkType()
    const [activity, pendingTransfers] = await Promise.all([
      activityPromise,
      Promise.resolve(service.getPendingTransfers()),
    ])
    const localSends = pendingTransfers.map(transfer => ({
      id: `local-send:${transfer.id}`,
      transferId: transfer.id,
      assetId: transfer.request.assetId,
      type: 'send' as const,
      amount: transfer.request.amount,
      txid: transfer.delivery?.completed.txid ?? transfer.broadcast?.completed.txid,
      timestamp: transfer.createdAt,
      status: transfer.delivery?.broadcastError
        ? 'broadcast_failed'
        : transfer.delivery?.acknowledgedAt
          ? 'broadcasting'
          : transfer.delivery
            ? 'waiting_ack'
            : transfer.broadcast
              ? 'broadcasted'
              : 'signed',
      local: true,
      from: wallet.fundingAddress,
      to: this.dependencies.getInvoiceDestination(transfer.request.invoice, networkType),
    }))
    const localSendHistory = (service.getPendingSendHistory?.() || []).map(send => ({
      id: `local-send:${send.transferId}`,
      transferId: send.transferId,
      assetId: send.assetId,
      type: 'send' as const,
      amount: send.amount,
      txid: send.txid,
      timestamp: send.createdAt,
      status: send.status,
      local: true,
      from: wallet.fundingAddress,
      to: this.dependencies.getInvoiceDestination(send.invoice, networkType),
    }))
    const localIssues = (service.getIssueHistory?.() || []).map(issue => ({
      id: `local-issue:${issue.assetId}`,
      assetId: issue.assetId,
      type: 'issue' as const,
      amount: issue.amount,
      txid: issue.txid,
      timestamp: issue.createdAt,
      status: rgbIssueActivityStatus(issue.chainStatus),
      local: true,
      from: wallet.fundingAddress,
      to: wallet.fundingAddress,
      ticker: issue.asset.ticker,
      name: issue.asset.name,
      precision: issue.asset.precision,
    }))
    const localReceives = service.getPendingReceives().flatMap(receive => {
      const receivedConsignment = receive.receivedConsignment
      const receivedAssetId =
        receivedConsignment?.assetId ?? receive.pendingAccept?.assetId ?? receive.assetId
      const receivedAmount =
        receivedConsignment?.amount ?? receive.pendingAccept?.amount ?? receive.amount
      const receivedPrecision =
        receivedConsignment?.precision ?? receive.pendingAccept?.precision
      const acknowledgementPending =
        (receivedConsignment as { acknowledgementPending?: boolean } | undefined)
          ?.acknowledgementPending === true
      // ACK intent is durable and cannot be rejected. Show it as waiting for
      // the sender rather than exposing the pending-accept actions again.
      if (receivedConsignment && acknowledgementPending) {
        return [
          {
            id: `local-receive:${receive.recipientId}`,
            transferId: receive.recipientId,
            assetId: receivedAssetId,
            type: 'receive' as const,
            amount: receivedAmount,
            precision: receivedPrecision,
            txid: receivedConsignment.txid,
            timestamp: receivedConsignment.receivedAt,
            status: 'waiting_receive',
            local: true,
            from: this.dependencies.getCounterpartyAddress(
              receive.pendingAccept?.counterpartyScriptPubKeys?.length
                ? receive.pendingAccept.counterpartyScriptPubKeys
                : receivedConsignment.counterpartyScriptPubKeys,
              networkType,
              wallet.fundingAddress
            ),
            to: wallet.fundingAddress,
          },
        ]
      }
      const awaitingAccept = !!receive.pendingAccept && !receivedConsignment?.accepted
      if (awaitingAccept && receive.pendingAccept) {
        return [
          {
            id: `local-receive:${receive.recipientId}`,
            transferId: receive.recipientId,
            assetId: receivedAssetId,
            type: 'receive' as const,
            amount: receivedAmount,
            precision: receivedPrecision,
            txid: receive.pendingAccept.txid,
            timestamp: receive.pendingAccept.discoveredAt || receive.createdAt,
            status: 'pending_accept',
            local: true,
            from: this.dependencies.getCounterpartyAddress(
              receive.pendingAccept.counterpartyScriptPubKeys?.length
                ? receive.pendingAccept.counterpartyScriptPubKeys
                : (this.dependencies.getConsignmentOutputScripts(receive.pendingAccept.payload) ??
                    []),
              networkType,
              wallet.fundingAddress
            ),
            to: wallet.fundingAddress,
          },
        ]
      }
      if (!receivedConsignment?.accepted) {
        if (!receivedConsignment) return []
        return [
          {
            id: `local-receive:${receive.recipientId}`,
            transferId: receive.recipientId,
            assetId: receivedAssetId,
            type: 'receive' as const,
            amount: receivedAmount,
            precision: receivedPrecision,
            txid: receivedConsignment.txid,
            timestamp: receivedConsignment.receivedAt,
            status: 'pending_accept',
            local: true,
            from: this.dependencies.getCounterpartyAddress(
              receivedConsignment.counterpartyScriptPubKeys,
              networkType,
              wallet.fundingAddress
            ),
            to: wallet.fundingAddress,
          },
        ]
      }
      return [
        {
          id: `local-receive:${receive.recipientId}`,
          transferId: receive.recipientId,
          assetId: receivedAssetId,
          type: 'receive' as const,
          amount: receivedAmount,
          precision: receivedPrecision,
          txid: receivedConsignment.txid,
          timestamp: receivedConsignment.receivedAt,
          status: receivedConsignment.broadcastDetectedAt ? 'confirming' : 'waiting_receive',
          local: true,
          from: this.dependencies.getCounterpartyAddress(
            receivedConsignment.counterpartyScriptPubKeys,
            networkType,
            wallet.fundingAddress
          ),
          to: wallet.fundingAddress,
        },
      ]
    })
    const localReceiveHistory = (service.getPendingReceiveHistory?.() || []).map(receive => ({
      id: receive.transferId,
      transferId: receive.transferId,
      assetId: receive.assetId,
      type: 'receive' as const,
      amount: receive.amount,
      precision: receive.precision,
      txid: receive.txid,
      timestamp: receive.createdAt,
      status: receive.status ?? 'settled',
      local: receive.status === 'canceled' || receive.status === 'rejected',
      from: this.dependencies.getCounterpartyAddress(
        receive.counterpartyScriptPubKeys,
        networkType,
        wallet.fundingAddress
      ),
      to: wallet.fundingAddress,
    }))
    const activityByTxid = new Map(
      activity.list
        .filter((item): item is RgbRemoteActivity & { txid: string } => !!item.txid)
        .map(item => [item.txid, item] as const)
    )
    const confirmedActivityTxids = new Set(
      activity.list
        .filter(item => ['confirmed', 'settled'].includes(String(item.status ?? '').toLowerCase()))
        .map(item => item.txid)
        .filter((txid): txid is string => !!txid)
    )
    const visibleLocalSendHistory = localSendHistory.filter(
      send => send.status !== 'broadcasted' || !send.txid || !confirmedActivityTxids.has(send.txid)
    )
    for (const send of localSendHistory) {
      if (send.status !== 'broadcasted' || !send.txid || !confirmedActivityTxids.has(send.txid))
        continue
      try {
        await service.markSendHistoryConfirmed(send.transferId)
      } catch (error) {
        this.dependencies.warn('Failed to clear confirmed RGB send history', error)
      }
    }
    const withActivityAddresses = <T>(item: T): T => {
      const current = item as T & { txid?: string; from?: string; to?: string }
      if (!current.txid) return item
      const matched = activityByTxid.get(current.txid)
      if (!matched) return item
      return { ...current, from: current.from ?? matched.from, to: current.to ?? matched.to } as T
    }
    const includeLocalTransfers = currentPage === 1
    const visibleLocalSends = includeLocalTransfers ? localSends : []
    const visibleLocalIssues = includeLocalTransfers ? localIssues : []
    // A previously persisted local NACK must not hide a transaction the
    // indexer has since confirmed. This heals historical records produced by
    // older recovery flows while the service keeps a one-way settled state for
    // all new records.
    const visibleLocalReceiveHistory = includeLocalTransfers
      ? localReceiveHistory.map(receive =>
          receive.status === 'rejected' &&
          receive.txid &&
          confirmedActivityTxids.has(receive.txid)
            ? { ...receive, status: 'settled', local: false }
            : receive
        )
      : []
    const visibleLocalReceives = includeLocalTransfers ? localReceives : []
    const visibleLocalHistory = includeLocalTransfers ? visibleLocalSendHistory : []
    const localTxids = new Set(
      [
        ...visibleLocalSends,
        ...visibleLocalIssues,
        ...visibleLocalHistory,
        ...visibleLocalReceives,
        ...visibleLocalReceiveHistory,
      ]
        .map(item => item.txid)
        .filter(Boolean)
    )
    const pendingAcceptCount = visibleLocalReceives.filter(
      item => item.status === 'pending_accept'
    ).length
    const remoteItems = activity.list
      .filter(item => {
        if (item.txid && localTxids.has(item.txid)) return false
        const status = String(item.status ?? '').toLowerCase()
        const inProgressReceive =
          item.type === 'receive' &&
          ['waiting_receive', 'waitingcounterparty', 'pending', 'unconfirmed'].includes(status)
        if (inProgressReceive && pendingAcceptCount > 0) return false
        return true
      })
      .map((item, index) => ({
        id: item.id ?? item.txid ?? `activity:${index}`,
        assetId: item.assetId,
        type: item.type === 'send' || item.type === 'receive' ? item.type : 'issue',
        amount: item.amount === null || item.amount === undefined ? undefined : String(item.amount),
        txid: item.txid,
        from: item.from,
        to: item.to,
        ticker: item.ticker,
        name: item.name,
        precision: item.precision,
        timestamp: item.timestamp ?? item.createdAt ?? 0,
        status:
          item.type === 'receive' &&
          ['waiting_receive', 'waitingcounterparty'].includes(
            String(item.status ?? '').toLowerCase()
          )
            ? 'confirming'
            : (item.status ?? 'settled'),
      }))
    const list = [
      ...visibleLocalSends.map(withActivityAddresses),
      ...visibleLocalIssues.map(withActivityAddresses),
      ...visibleLocalHistory.map(withActivityAddresses),
      ...visibleLocalReceives.map(withActivityAddresses),
      ...visibleLocalReceiveHistory.map(withActivityAddresses),
      ...remoteItems,
    ].sort((left, right) => right.timestamp - left.timestamp)
    const localOnlyTransferKeys = new Set(
      [
        ...visibleLocalSends,
        ...visibleLocalIssues,
        ...visibleLocalHistory.filter(send => send.status !== 'broadcasted'),
        ...visibleLocalReceives,
        ...visibleLocalReceiveHistory,
      ]
        .map(item => ('transferId' in item ? item.transferId : undefined) ?? item.txid ?? item.id)
        .filter(Boolean)
    )

    return {
      currentPage,
      pageSize,
      total: Math.max(activity.total + localOnlyTransferKeys.size, list.length),
      list,
    }
  }
}

function rgbIssueActivityStatus(chainStatus?: string) {
  if (chainStatus === 'confirmed' || chainStatus === 'spent') return 'confirmed'
  if (chainStatus === 'replaced') return 'failed'
  return 'unconfirmed'
}
