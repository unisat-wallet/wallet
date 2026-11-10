import {
  RgbService,
  RgbTransferAwaitingAckError,
  RgbTransferRejectedError,
} from '@unisat/rgb-service'
import type { LocalRgbServiceContext } from './RgbWalletCoordinator'

// Proxy v1 releases the signed transaction to the receiver after ACK. Give
// its broadcast a short propagation window before offering the sender-side
// fallback action, otherwise a just-accepted transfer briefly opens a stale
// Broadcast sheet while the chain source is still catching up.
const RECEIVER_BROADCAST_PROPAGATION_MS = 15_000

export type RgbRemoteActivity = {
  id?: string
  assetId?: string
  type?: string
  amount?: string | number | null
  txid?: string
  timestamp?: number
  createdAt?: number
  status?: string
  rejectionReason?: string
  ticker?: string
  name?: string
  precision?: number
}

type RgbTransferQueryDependencies = {
  getContext: () => Promise<LocalRgbServiceContext>
  syncReceiveHistory: (service: RgbService, context: LocalRgbServiceContext) => Promise<void>
  syncPendingTransfers: (service: RgbService, context: LocalRgbServiceContext) => Promise<void>
  reconcileIndexedBroadcasts?: (
    service: RgbService,
    context: LocalRgbServiceContext,
    activity: RgbRemoteActivity[]
  ) => Promise<void>
  syncReceivedAllocations: () => Promise<LocalRgbServiceContext>
  getRemoteActivity: (
    address: string,
    currentPage: number,
    pageSize: number,
    scope?: { assetId?: string; type?: string }
  ) => Promise<{ total: number; list: RgbRemoteActivity[] }>
  getRemoteActivityStatuses?: (
    wallet: LocalRgbServiceContext['wallet'],
    references: Array<{ id?: string; txid?: string }>
  ) => Promise<{ total: number; list: RgbRemoteActivity[] }>
  warn: (message: string, error: unknown) => void
}

/** Merges durable local RGB records into the first page of indexer activity. */
export class RgbTransferQuery {
  private readonly confirmedBurnTxids = new Set<string>()
  private readonly recentActivity = new Map<string, {
    promise: ReturnType<RgbTransferQueryDependencies['getRemoteActivity']>
    expiresAt: number
  }>()

  constructor(private readonly dependencies: RgbTransferQueryDependencies) {}

  private getRemoteActivity(
    wallet: LocalRgbServiceContext['wallet'],
    currentPage: number,
    pageSize: number,
    refresh: boolean,
    scope?: { assetId?: string; type?: string }
  ) {
    const key = JSON.stringify([
      wallet.network, wallet.walletId, wallet.fundingAddress, currentPage, pageSize,
      scope?.assetId, scope?.type,
    ])
    if (currentPage !== 1) {
      return this.dependencies.getRemoteActivity(
        wallet.fundingAddress, currentPage, pageSize, scope
      )
    }
    if (refresh) this.recentActivity.delete(key)
    const cached = this.recentActivity.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.promise

    const entry = {
      promise: this.dependencies.getRemoteActivity(
        wallet.fundingAddress, currentPage, pageSize, scope
      ),
      expiresAt: Number.POSITIVE_INFINITY,
    }
    this.recentActivity.delete(key)
    this.recentActivity.set(key, entry)
    if (this.recentActivity.size > 20) {
      this.recentActivity.delete(this.recentActivity.keys().next().value!)
    }
    void entry.promise.then(
      () => { entry.expiresAt = Date.now() + 2_000 },
      () => { if (this.recentActivity.get(key) === entry) this.recentActivity.delete(key) }
    )
    return entry.promise
  }

  private receiveStateKey(service: RgbService): string {
    return JSON.stringify({
      pending: service.getPendingReceives().map(receive => [
        receive.recipientId,
        receive.pendingAccept?.txid,
        receive.pendingValidationFailure?.reason,
        receive.rejection?.kind,
        receive.rejection?.rejectedAt,
        receive.receivedConsignment?.txid,
        receive.receivedConsignment?.accepted,
        receive.receivedConsignment?.broadcastDetectedAt,
      ]),
      history: (service.getPendingReceiveHistory?.() || []).map(receive => [
        receive.transferId, receive.txid, receive.status,
      ]),
    })
  }

  private pendingActivityReferences(service: RgbService) {
    const references = new Map<string, { id?: string; txid?: string }>()
    const add = (id?: string, txid?: string) => {
      if (!id && !txid) return
      const key = `${id || ''}:${txid || ''}`
      if (!references.has(key)) references.set(key, {
        ...(id ? { id } : {}),
        ...(txid ? { txid } : {}),
      })
    }
    const isPending = (status: unknown) =>
      !['settled', 'confirmed', 'failed', 'rejected', 'canceled', 'cancelled'].includes(
        String(status || '').toLowerCase()
      )
    for (const transfer of service.getPendingTransfers()) {
      add(
        transfer.id,
        transfer.delivery?.completed.txid ?? transfer.broadcast?.completed.txid
      )
    }
    for (const send of service.getPendingSendHistory?.() || []) {
      if (isPending(send.status)) add(send.transferId, send.txid)
    }
    for (const receive of service.getPendingReceiveHistory?.() || []) {
      if (isPending(receive.status)) add(receive.transferId, receive.txid)
    }
    for (const receive of service.getPendingReceives()) {
      add(
        receive.proxyRecipientId || receive.recipientId,
        receive.receivedConsignment?.txid ?? receive.pendingAccept?.txid
      )
    }
    return [...references.values()].slice(0, 50)
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- preserve the precise merged activity response.
  async getTransfers(
    currentPage: number,
    pageSize: number,
    options?: { skipSync?: boolean; assetId?: string; type?: string; statusOnly?: boolean }
  ) {
    let context = await this.dependencies.getContext()
    let { service, wallet } = context
    const scope = options?.assetId || options?.type
      ? {
          ...(options.assetId ? { assetId: options.assetId } : {}),
          ...(options.type ? { type: options.type } : {}),
        }
      : undefined
    // A pending receive can settle or be rejected during the sync below.
    // Fetch its remote history afterwards so this request does not render an
    // old confirmed row immediately after publishing the newer outcome.
    const receiveMayChange = !options?.skipSync &&
      ((service.getPendingReceiveHistory?.().length || 0) > 0 || service.getPendingReceives().length > 0)
    const receiveStateBeforeSync = receiveMayChange ? this.receiveStateKey(service) : undefined
    const activityPromise = receiveMayChange || options?.statusOnly
      ? undefined
      : this.getRemoteActivity(wallet, currentPage, pageSize, false, scope)
    if (!options?.skipSync) {
      try {
        await this.dependencies.syncReceiveHistory(service, context)
      } catch (error) {
        this.dependencies.warn(
          'Failed to synchronize RGB receive history while loading activity',
          error
        )
      }
      const hasLateAcknowledgement = (service.getPendingSendHistory?.() || []).some(send =>
        send.status === 'broadcasted' && send.recipientAckExpected && send.recipientAck === undefined
      )
      if (service.getPendingTransfers().length || hasLateAcknowledgement) {
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

    const remoteActivityRequest = options?.statusOnly && this.dependencies.getRemoteActivityStatuses
      ? this.dependencies.getRemoteActivityStatuses(
          wallet,
          this.pendingActivityReferences(service)
        )
      : activityPromise || this.getRemoteActivity(
          wallet,
          currentPage,
          pageSize,
          receiveStateBeforeSync !== undefined && receiveStateBeforeSync !== this.receiveStateKey(service),
          scope
        )
    const [activity, initialPendingTransfers] = await Promise.all([
      remoteActivityRequest,
      Promise.resolve(service.getPendingTransfers()),
    ])
    if (!options?.skipSync && initialPendingTransfers.some(transfer => !transfer.delivery && !transfer.broadcast)) {
      try {
        await this.dependencies.reconcileIndexedBroadcasts?.(service, context, activity.list)
      } catch (error) {
        this.dependencies.warn('Failed to reconcile an indexed RGB broadcast', error)
      }
    }
    const pendingTransfers = service.getPendingTransfers()
    const snapshotUtxos = new Map(
      (service.getSnapshot?.()?.utxos || []).map(utxo => [
        `${utxo.outpoint.txid}:${utxo.outpoint.vout}`,
        utxo,
      ])
    )
    const lockedAssetAmount = (transfer: typeof pendingTransfers[number]) => {
      let amount = 0n
      const visited = new Set<string>()
      for (const outpoint of transfer.prepared?.lockedOutpoints || []) {
        const key = `${outpoint.txid}:${outpoint.vout}`
        if (visited.has(key)) continue
        visited.add(key)
        const utxo = snapshotUtxos.get(key)
        if (
          !utxo ||
          (utxo.chainStatus &&
            ['spent', 'replaced', 'pending_spend'].includes(utxo.chainStatus))
        ) continue
        for (const allocation of utxo.allocations) {
          if (allocation.assetId === transfer.request.assetId && allocation.settled && allocation.spendable)
            amount += BigInt(allocation.amount)
        }
      }
      return amount.toString()
    }
    const localAssetMetadata = (assetId: string) => {
      try {
        const { name, ticker } = service.getLocalAssetDetail(assetId)
        return { name, ticker }
      } catch {
        return { name: undefined, ticker: undefined }
      }
    }
    const matchesScope = (value: unknown) => {
      const item = value as { assetId?: string; type?: string }
      return (!options?.assetId || item.assetId === options.assetId) &&
        (!options?.type || item.type === options.type)
    }
    // Treat the server-side scope as an optimization, not as a trust boundary.
    // Older/indexer replicas may ignore the asset query briefly; never merge
    // those rows into a token detail screen.
    const remoteActivity = activity.list.filter(matchesScope)
    const remoteScopeWasIgnored = remoteActivity.length !== activity.list.length
    const confirmedActivityTxids = new Set(
      remoteActivity
        .filter(item => ['confirmed', 'settled'].includes(String(item.status ?? '').toLowerCase()))
        .map(item => item.txid)
        .filter((txid): txid is string => !!txid)
    )
    const burnTxids = [...new Set((service.getPendingSendHistory?.() || [])
      .filter(send => send.burn && send.txid)
      .map(send => send.txid!))]
    await Promise.all(burnTxids.map(async txid => {
      if (confirmedActivityTxids.has(txid) || this.confirmedBurnTxids.has(txid)) return
      try {
        if (await service.getBurnTransactionStatus(txid) === 'confirmed')
          this.confirmedBurnTxids.add(txid)
      } catch (error) {
        this.dependencies.warn('Failed to check BFA burn confirmation', error)
      }
    }))
    const now = Date.now()
    const localSends = pendingTransfers.map(transfer => ({
      id: `local-send:${transfer.id}`,
      transferId: transfer.id,
      assetId: transfer.request.assetId,
      ...localAssetMetadata(transfer.request.assetId),
      type: 'send' as const,
      ...(transfer.request.burn ? { burn: true } : {}),
      ...(transfer.request.burnDestination
        ? { burnDestinationChainId: transfer.request.burnDestination.destinationChainId }
        : {}),
      amount: transfer.request.amount,
      lockedAmount: lockedAssetAmount(transfer),
      precision: transfer.request.precision,
      txid: transfer.delivery?.completed.txid ?? transfer.broadcast?.completed.txid,
      timestamp: transfer.createdAt,
      acknowledgedAt: transfer.delivery?.acknowledgedAt,
      status: transfer.delivery?.broadcastError
        ? 'broadcast_failed'
        : transfer.delivery?.externalBroadcast
          ? 'ready_for_dapp_finalize'
          : transfer.delivery?.acknowledgedAt
            ? now - transfer.delivery.acknowledgedAt < RECEIVER_BROADCAST_PROPAGATION_MS
              ? 'broadcasting'
              : 'ready_to_broadcast'
            : transfer.delivery?.donationReadyAt
              ? 'broadcasting'
              : transfer.delivery
                ? 'waiting_ack'
                : transfer.broadcast
                  ? 'broadcasted'
                  : 'signed',
      local: true,
    })).filter(matchesScope)
    const localSendHistory = (service.getPendingSendHistory?.() || []).map(send => ({
      id: `local-send:${send.transferId}`,
      transferId: send.transferId,
      assetId: send.assetId,
      ...localAssetMetadata(send.assetId),
      type: 'send' as const,
      ...(send.burn ? { burn: true } : {}),
      ...(send.burnDestinationChainId ? { burnDestinationChainId: send.burnDestinationChainId } : {}),
      amount: send.amount,
      precision: send.precision,
      txid: send.txid,
      timestamp: send.createdAt,
      status: send.burn && send.txid &&
        (confirmedActivityTxids.has(send.txid) || this.confirmedBurnTxids.has(send.txid))
        ? 'confirmed'
        : send.recipientAck === false
        ? 'rejected'
        : send.recipientAckExpected && send.txid && confirmedActivityTxids.has(send.txid)
          ? 'confirmed'
          : send.status,
      broadcasted: send.status === 'broadcasted',
      awaitingRecipientAck: send.status === 'broadcasted' && send.recipientAckExpected && send.recipientAck === undefined,
      recipientRejected: send.recipientAck === false,
      local: true,
    })).filter(matchesScope)
    const issueHistory = service.getIssueHistory?.() || []
    const issuanceTxidByAssetId = new Map(
      issueHistory.flatMap(issue =>
        issue.issuanceTxid ? [[issue.assetId, issue.issuanceTxid] as const] : []
      )
    )
    const localIssues = issueHistory.map(issue => ({
      id: `local-issue:${issue.assetId}`,
      assetId: issue.assetId,
      type: 'issue' as const,
      amount: issue.amount,
      txid: issue.issuanceTxid ?? issue.txid,
      timestamp: issue.createdAt,
      status: rgbIssueActivityStatus(issue.chainStatus),
      local: true,
      ticker: issue.asset.ticker,
      name: issue.asset.name,
      precision: issue.asset.precision,
    })).filter(matchesScope)
    const localReceives = service.getPendingReceives().flatMap(receive => {
      // Rejected receives remain encrypted recovery tombstones. Their
      // display-only history row is the public activity; never expose the
      // retained invoice, payload, or Proxy key through the pending list.
      if (receive.rejection) return []
      // Witness invoices created by the same account share the beneficiary
      // script recipient ID. The nonce-derived proxy recipient is the unique
      // transport/action identity for each invoice.
      const receiveId = receive.proxyRecipientId || receive.recipientId
      const receivedConsignment = receive.receivedConsignment
      const receivedAssetId =
        receivedConsignment?.assetId ?? receive.pendingAccept?.assetId ?? receive.assetId
      const receivedAmount =
        receivedConsignment?.amount ?? receive.pendingAccept?.amount ?? receive.amount
      const receivedPrecision = receivedConsignment?.precision ?? receive.pendingAccept?.precision
      const acknowledgementPending =
        (receivedConsignment as { acknowledgementPending?: boolean } | undefined)
          ?.acknowledgementPending === true
      // ACK intent is durable and cannot be rejected. Only a Proxy v1 batch
      // is waiting for other recipients; a non-batch receipt is finalizing
      // recovery of its released transaction.
      if (receivedConsignment && acknowledgementPending) {
        return [
          {
            id: `local-receive:${receiveId}`,
            transferId: receiveId,
            assetId: receivedAssetId,
            type: 'receive' as const,
            amount: receivedAmount,
            precision: receivedPrecision,
            batch: receivedConsignment.batch,
            txid: receivedConsignment.txid,
            timestamp: receivedConsignment.receivedAt,
            status: receivedConsignment.batch ? 'waiting_batch_release' : 'confirming',
            local: true,
          },
        ]
      }
      const awaitingAccept = !!receive.pendingAccept && !receivedConsignment?.accepted
      if (receive.pendingValidationFailure && !receivedConsignment?.accepted) {
        return [{
          id: `local-receive:${receiveId}`,
          transferId: receiveId,
          assetId: receivedAssetId,
          type: 'receive' as const,
          amount: receivedAmount,
          precision: receivedPrecision,
          txid: receive.pendingValidationFailure.txid || '',
          timestamp: receive.pendingValidationFailure.discoveredAt,
          status: 'validation_failed',
          rejectionReason: receive.pendingValidationFailure.reason,
          canReject: receive.pendingValidationFailure.reviewStatus === 'rejection_allowed',
          rejectLocally: !receive.pendingValidationFailure.endpoint,
          local: true,
        }]
      }
      if (awaitingAccept && receive.pendingAccept) {
        return [
          {
            id: `local-receive:${receiveId}`,
            transferId: receiveId,
            assetId: receivedAssetId,
            type: 'receive' as const,
            amount: receivedAmount,
            precision: receivedPrecision,
            batch: receive.pendingAccept.batch,
            txid: receive.pendingAccept.txid,
            timestamp: receive.pendingAccept.discoveredAt || receive.createdAt,
            status: 'pending_accept',
            local: true,
          },
        ]
      }
      if (!receivedConsignment?.accepted) {
        if (!receivedConsignment) return []
        this.dependencies.warn(
          'RGB activity exposed a local receive without pending acceptance data',
          {
            hasPendingAccept: Boolean(receive.pendingAccept),
            accepted: receivedConsignment.accepted,
            acknowledgementPending: receivedConsignment.acknowledgementPending,
            recipientType: receive.recipientType,
          }
        )
        return [
          {
            id: `local-receive:${receiveId}`,
            transferId: receiveId,
            assetId: receivedAssetId,
            type: 'receive' as const,
            amount: receivedAmount,
            precision: receivedPrecision,
            batch: receivedConsignment.batch,
            txid: receivedConsignment.txid,
            timestamp: receivedConsignment.receivedAt,
            status: 'pending_accept',
            local: true,
          },
        ]
      }
      return [
        {
          id: `local-receive:${receiveId}`,
          transferId: receiveId,
          assetId: receivedAssetId,
          type: 'receive' as const,
          amount: receivedAmount,
          precision: receivedPrecision,
          batch: receivedConsignment.batch,
          txid: receivedConsignment.txid,
          timestamp: receivedConsignment.receivedAt,
          status: receivedConsignment.broadcastDetectedAt ? 'confirming' : 'waiting_receive',
          local: true,
        },
      ]
    }).filter(matchesScope)
    const localReceiveHistory = (service.getPendingReceiveHistory?.() || []).map(receive => ({
      id: receive.transferId,
      transferId: receive.transferId,
      assetId: receive.assetId,
      type: 'receive' as const,
      amount: receive.amount,
      precision: receive.precision,
      batch: receive.batch,
      txid: receive.txid,
      timestamp: receive.createdAt,
      status: receive.status ?? 'settled',
      rejectionReason: receive.rejectionReason,
      local: receive.status === 'canceled' || receive.status === 'rejected',
    })).filter(matchesScope)
    const visibleLocalSendHistory = localSendHistory.filter(
      send =>
        send.burn ||
        !send.broadcasted ||
        send.awaitingRecipientAck ||
        send.recipientRejected ||
        !send.txid ||
        !confirmedActivityTxids.has(send.txid)
    )
    for (const send of localSendHistory) {
      if (
        send.burn ||
        !send.broadcasted ||
        send.awaitingRecipientAck ||
        send.recipientRejected ||
        !send.txid ||
        !confirmedActivityTxids.has(send.txid)
      )
        continue
      try {
        await service.markSendHistoryConfirmed(send.transferId)
      } catch (error) {
        this.dependencies.warn('Failed to clear confirmed RGB send history', error)
      }
    }
    const includeLocalTransfers = currentPage === 1
    const indexedSendIds = new Set(remoteActivity
      .filter(item =>
        item.type === 'send' && item.id && item.txid &&
        ['mempool', 'broadcasted', 'confirmed', 'settled'].includes(
          String(item.status ?? '').toLowerCase()
        )
      )
      .flatMap(item => item.id ? [item.id] : []))
    const visibleLocalSends = includeLocalTransfers
      ? localSends.filter(send => !indexedSendIds.has(send.transferId))
      : []
    const visibleLocalIssues = includeLocalTransfers ? localIssues : []
    const visibleLocalReceiveHistory = includeLocalTransfers
      ? localReceiveHistory
      : []
    const visibleLocalReceives = includeLocalTransfers ? localReceives : []
    const visibleLocalHistory = includeLocalTransfers ? visibleLocalSendHistory : []
    const localNonReceiveTxids = new Set(
      [
        ...visibleLocalSends,
        ...visibleLocalIssues,
        ...visibleLocalHistory,
      ]
        .map(item => item.txid)
        .filter(Boolean)
    )
    if (includeLocalTransfers) {
      for (const issue of issueHistory) {
        localNonReceiveTxids.add(issue.txid)
        if (issue.issuanceTxid) localNonReceiveTxids.add(issue.issuanceTxid)
      }
    }
    const localReceiveIds = new Set(
      [...visibleLocalReceives, ...visibleLocalReceiveHistory]
        .map(item => item.transferId?.replace(/^local-receive:|^receive:/, ''))
        .filter(Boolean)
    )
    const pendingAcceptCount = visibleLocalReceives.filter(
      item => item.status === 'pending_accept'
    ).length
    const remotePendingAcceptCount = remoteActivity.filter(
      item =>
        item.type === 'receive' &&
        String(item.status ?? '').toLowerCase() === 'pending_accept'
    ).length
    if (remotePendingAcceptCount > 0) {
      this.dependencies.warn('RGB remote activity contains pending-accept receives', {
        count: remotePendingAcceptCount,
        localPendingAcceptCount: pendingAcceptCount,
      })
    }
    const remoteItems = remoteActivity
      .filter(item => {
        if (item.type === 'receive' && item.id &&
          localReceiveIds.has(item.id.replace(/^local-receive:|^receive:/, ''))) return false
        if (item.type !== 'receive' && item.txid && localNonReceiveTxids.has(item.txid)) return false
        const status = String(item.status ?? '').toLowerCase()
        const inProgressReceive =
          item.type === 'receive' &&
          ['waiting_batch_release', 'waiting_receive', 'waitingcounterparty', 'pending', 'unconfirmed'].includes(status)
        if (inProgressReceive && pendingAcceptCount > 0) return false
        return true
      })
      .map((item, index) => ({
        id: item.id ?? item.txid ?? `activity:${index}`,
        assetId: item.assetId,
        type: item.type === 'send' || item.type === 'receive' ? item.type : 'issue',
        amount: item.amount === null || item.amount === undefined ? undefined : String(item.amount),
        txid:
          item.type !== 'send' && item.type !== 'receive' && item.assetId
            ? (issuanceTxidByAssetId.get(item.assetId) ?? item.txid)
            : item.txid,
        ticker: item.ticker,
        name: item.name,
        precision: item.precision,
        timestamp: item.timestamp ?? item.createdAt ?? 0,
        status:
          item.type === 'receive' &&
          ['waiting_batch_release', 'waiting_receive', 'waitingcounterparty'].includes(
            String(item.status ?? '').toLowerCase()
          )
            ? 'confirming'
            : (item.status ?? 'settled'),
        rejectionReason: item.rejectionReason,
      }))
    const list = [
      ...visibleLocalSends,
      ...visibleLocalIssues,
      ...visibleLocalHistory,
      ...visibleLocalReceives,
      ...visibleLocalReceiveHistory,
      ...remoteItems,
    ].sort((left, right) => right.timestamp - left.timestamp)
    // Local records appear on page one, but every page must report the same total.
    const localOnlyTransferKeys = new Set(
      [
        ...localSends,
        ...localIssues,
        ...localSendHistory.filter(send => !send.broadcasted && (!send.txid || !confirmedActivityTxids.has(send.txid))),
        ...localReceives,
        ...localReceiveHistory,
      ]
        .map(item => ('transferId' in item ? item.transferId : undefined) ?? item.txid ?? item.id)
        .filter(Boolean)
    )

    return {
      currentPage,
      pageSize,
      // When the first remote page contains every remote record, `list` is the
      // complete deduplicated history. Adding local records to the remote total
      // would count transfers present in both sources twice.
      total: remoteScopeWasIgnored
        ? list.length
        : currentPage === 1 && activity.list.length >= activity.total
        ? list.length
        : Math.max(activity.total + localOnlyTransferKeys.size, list.length),
      list,
    }
  }
}

function rgbIssueActivityStatus(chainStatus?: string) {
  if (chainStatus === 'confirmed' || chainStatus === 'spent') return 'confirmed'
  if (chainStatus === 'replaced') return 'failed'
  return 'unconfirmed'
}
