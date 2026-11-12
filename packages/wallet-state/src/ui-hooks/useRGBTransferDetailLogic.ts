import { useCallback, useEffect, useState } from 'react'

import { useI18n, useNavigation, useTools, useWallet } from '../context'
import { useWalletConfig } from '../hooks/settings'
import type { RgbTransferItem } from '../types'
import { mergeRgbTransferAssetMetadata } from '../utils/rgb-transfer-metadata'
import { normalizeConfiguredRgbAsset } from '../utils/rgb-usdt'
import { useRgbAcceptProgress } from './useRgbAcceptProgress'

function isInProgress(transfer?: RgbTransferItem) {
  if (transfer?.awaitingRecipientAck) return true
  if (!transfer) return false
  if (
    ['canceled', 'cancelled', 'rejected', 'settled', 'confirmed', 'failed'].includes(
      transfer.status.toLowerCase()
    )
  ) {
    return false
  }
  return (
    transfer.local ||
    [
      'incomplete',
      'signed',
      'waiting_ack',
      'broadcasting',
      'broadcasted',
      'broadcast_failed',
      'ready_for_dapp_finalize',
      'ready_for_external_broadcast',
      'pending_accept',
      'confirming',
      'waiting_batch_release',
      'waiting_receive',
      'pending',
      'unconfirmed',
    ].includes(transfer.status.toLowerCase())
  )
}

function resolveAbortTransferId(transfer?: RgbTransferItem, transferId?: string) {
  const candidates = [transfer?.transferId, transferId, transfer?.id, transfer?.txid]
  for (const candidate of candidates) {
    if (!candidate) continue
    return candidate.startsWith('local-send:') ? candidate.slice('local-send:'.length) : candidate
  }
  return ''
}

function resolveReceiveRecipientId(transfer?: RgbTransferItem, transferId?: string) {
  const candidates = [transfer?.transferId, transferId, transfer?.id]
  for (const candidate of candidates) {
    if (!candidate) continue
    return candidate.replace(/^local-receive:/, '').replace(/^receive:/, '')
  }
  return ''
}

function getTransferActionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (!error || typeof error !== 'object') return fallback
  const message = (error as Record<string, unknown>)['message']
  return typeof message === 'string' && message ? message : fallback
}

export function useRGBTransferDetailLogic() {
  const nav = useNavigation()
  const wallet = useWallet()
  const tools = useTools()
  const { t } = useI18n()
  const walletConfig = useWalletConfig()
  const { transferId, initialTransfer, source } = nav.getRouteState<'RGBTransferDetailScreen'>()
  const [transfer, setTransfer] = useState<RgbTransferItem | undefined>(() =>
    initialTransfer ? normalizeConfiguredRgbAsset(initialTransfer, walletConfig) : undefined
  )
  const [loading, setLoading] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [receiveActionLoading, setReceiveActionLoading] = useState(false)
  const [broadcastRetryLoading, setBroadcastRetryLoading] = useState(false)
  const [cancellationReviewLoading, setCancellationReviewLoading] = useState(false)
  const [senderCanceledVisible, setSenderCanceledVisible] = useState(false)
  const {
    progress: acceptProgress,
    start: startAcceptProgress,
    stop: stopAcceptProgress,
  } = useRgbAcceptProgress()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await wallet.getRgbTransfers(1, 50)
      setTransfer(current => {
        const latest = result.list.find(
          item =>
            item.transferId === transferId ||
            item.id === transferId ||
            item.id === `local-send:${transferId}` ||
            (!!current?.txid && item.txid === current.txid)
        )
        if (!latest) return current
        return normalizeConfiguredRgbAsset({
          ...latest,
          assetId: current?.assetId ?? latest.assetId,
          ticker: latest.ticker || current?.ticker,
          name: latest.name || current?.name,
          precision: latest.precision ?? current?.precision,
        }, walletConfig)
      })
    } catch {
      // Keep the most recently known state visible while the background refreshes.
    } finally {
      setLoading(false)
    }
  }, [transferId, wallet, walletConfig])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!transfer?.assetId) return undefined

    let canceled = false
    void Promise.resolve(wallet.getRGBAssetDetail('', transfer.assetId))
      .then(detail => {
        if (canceled || !detail) return
        setTransfer(current =>
          current?.assetId === transfer.assetId
            ? normalizeConfiguredRgbAsset(
                mergeRgbTransferAssetMetadata(current, detail),
                walletConfig
              )
            : current
        )
      })
      .catch(() => undefined)

    return () => {
      canceled = true
    }
  }, [transfer?.assetId, transfer?.precision, wallet, walletConfig])

  useEffect(() => {
    if (!isInProgress(transfer)) return undefined
    const intervalId = setInterval(() => void refresh(), 10_000)
    return () => clearInterval(intervalId)
  }, [refresh, transfer])

  const canCancelSend =
    source !== 'send_result' &&
    transfer?.type === 'send' &&
    ['incomplete', 'signed', 'waiting_ack', 'ready_for_dapp_finalize'].includes(
      String(transfer?.status || '').toLowerCase()
    )
  const canAcceptReceive =
    transfer?.type === 'receive' &&
    transfer.local === true &&
    String(transfer?.status || '').toLowerCase() === 'pending_accept'
  const canRetryBroadcast =
    transfer?.type === 'send' && String(transfer?.status || '').toLowerCase() === 'broadcast_failed'
  const canBroadcast =
    transfer?.type === 'send' && String(transfer?.status || '').toLowerCase() === 'ready_to_broadcast'

  const onClickDone = () => {
    nav.navigate('AssetsTabScreen')
  }

  const onClickExploreTx = () => {
    if (transfer?.txid) nav.navToExplorerTx(transfer.txid)
  }

  const onCancelSend = async () => {
    const abortId = resolveAbortTransferId(transfer, transferId)
    if (!abortId) {
      tools.toastError(t('rgb_cancel_send_failed'))
      return false
    }
    if (cancelLoading) return false

    setCancelLoading(true)
    try {
      const requiresAcknowledgedAbort =
        String(transfer?.status || '').toLowerCase() === 'ready_for_dapp_finalize'
      const transferStatus = String(transfer?.status || '').toLowerCase()
      const discardUnsigned = ['incomplete', 'signed'].includes(transferStatus)
      const result = requiresAcknowledgedAbort
        ? await wallet.abortRgbAcknowledgedSwap({ txid: abortId })
        : await wallet.abortRgbVanillaTx({
            txid: abortId,
            ...(discardUnsigned ? { discardUnsigned: true } : {}),
          })
      if (result?.['reviewRequested']) {
        setTransfer(current => current ? {
          ...current,
          status: 'broadcast_failed',
          local: true,
          cancellationReviewRequested: true,
        } : current)
        tools.toastSuccess(t('rgb_broadcast_cancellation_review_requested'))
        return true
      }
      if (!result?.aborted) {
        throw new Error(
          result?.['reason'] === 'acknowledged_requires_review'
            ? t('rgb_acknowledged_requires_cancellation_review')
            : result?.['reason'] === 'transfer_already_progressed'
              ? t('rgb_discard_incomplete_transfer_progressed')
              : result?.['reason'] || t('rgb_cancel_send_failed')
        )
      }
      tools.toastSuccess(t(discardUnsigned
        ? 'rgb_discard_incomplete_transfer_success'
        : 'rgb_cancel_send_success'))
      setTransfer(current =>
        current
          ? {
              ...current,
              status: 'canceled',
              local: true,
              transferId:
                typeof result['transferId'] === 'string'
                  ? result['transferId']
                  : current.transferId,
            }
          : current
      )
      return true
    } catch (e: unknown) {
      const message = getTransferActionErrorMessage(e, t('rgb_cancel_send_failed'))
      tools.toastError(message)
      return false
    } finally {
      setCancelLoading(false)
    }
  }

  const onAcceptReceive = async () => {
    const recipientId = resolveReceiveRecipientId(transfer, transferId)
    if (!recipientId || receiveActionLoading) return false

    const progressId = startAcceptProgress(1)
    setReceiveActionLoading(true)
    try {
      const result = await wallet.acceptRgbReceive({ recipientId, progressId })
      if (result?.status === 'canceled') {
        setTransfer(current =>
          current ? { ...current, status: 'canceled', local: true } : current
        )
        setSenderCanceledVisible(true)
        return false
      }
      if (result?.status === 'pending') {
        tools.toastSuccess(t('rgb_status_waiting_batch_release'))
        setTransfer(current =>
          current ? { ...current, status: 'waiting_batch_release', local: true } : current
        )
        return true
      }
      if (!result?.accepted) throw new Error(t('rgb_accept_transfer_failed'))
      tools.toastSuccess(t('rgb_accept_transfer_success'))
      setTransfer(current =>
        current ? { ...current, status: 'waiting_receive', local: true } : current
      )
      return true
    } catch (e: unknown) {
      const message = getTransferActionErrorMessage(e, t('rgb_accept_transfer_failed'))
      tools.toastError(message)
      return false
    } finally {
      setReceiveActionLoading(false)
      stopAcceptProgress()
    }
  }

  const onRejectReceive = async () => {
    const recipientId = resolveReceiveRecipientId(transfer, transferId)
    if (!recipientId || receiveActionLoading) return false

    setReceiveActionLoading(true)
    try {
      const result = await wallet.rejectRgbReceive({ recipientId })
      if (!result?.rejected) throw new Error(t('rgb_reject_transfer_failed'))
      tools.toastSuccess(t('rgb_reject_transfer_success'))
      setTransfer(current => (current ? {
        ...current,
        status: 'rejected',
        local: true,
        ...(result.rejectionReason ? { rejectionReason: result.rejectionReason } : {}),
      } : current))
      return true
    } catch (e: unknown) {
      const message = getTransferActionErrorMessage(e, t('rgb_reject_transfer_failed'))
      tools.toastError(message)
      return false
    } finally {
      setReceiveActionLoading(false)
    }
  }

  const onRetryBroadcast = async () => {
    const retryId = resolveAbortTransferId(transfer, transferId)
    if (!retryId || broadcastRetryLoading) return false

    setBroadcastRetryLoading(true)
    try {
      const result = await wallet.retryRgbBroadcast({ transferId: retryId })
      if (result.broadcast) {
        if (transfer) {
          setTransfer({ ...transfer, status: 'broadcasted', local: true })
        }
        return true
      }
      setTransfer(current =>
        current ? { ...current, status: result.status, local: true } : current
      )
      throw new Error(result.error || t('rgb_retry_broadcast_failed'))
    } catch (e: unknown) {
      const message = getTransferActionErrorMessage(e, t('rgb_retry_broadcast_failed'))
      tools.toastError(message)
      return false
    } finally {
      setBroadcastRetryLoading(false)
    }
  }

  const onRequestCancellationReview = async () => {
    const retryId = resolveAbortTransferId(transfer, transferId)
    if (!retryId || cancellationReviewLoading || transfer?.cancellationReviewRequested) return false
    setCancellationReviewLoading(true)
    try {
      const result = await wallet.requestRgbBroadcastCancellationReview({ transferId: retryId })
      if (result.status === 'canceled') {
        setTransfer(current => current ? { ...current, status: 'canceled', local: true } : current)
        tools.toastSuccess(t('rgb_cancel_send_success'))
      } else {
        setTransfer(current => current ? { ...current, cancellationReviewRequested: true } : current)
        tools.toastSuccess(t('rgb_broadcast_cancellation_review_requested'))
      }
      return true
    } catch (e: unknown) {
      tools.toastError(getTransferActionErrorMessage(e, t('rgb_broadcast_cancellation_review_failed')))
      return false
    } finally {
      setCancellationReviewLoading(false)
    }
  }

  return {
    transfer,
    transferId,
    loading,
    cancelLoading,
    receiveActionLoading,
    acceptProgress,
    broadcastRetryLoading,
    cancellationReviewLoading,
    cancellationReviewRequested: transfer?.cancellationReviewRequested === true,
    canCancelSend,
    isIncompleteSend: ['incomplete', 'signed'].includes(
      String(transfer?.status || '').toLowerCase()
    ),
    canAcceptReceive,
    canRetryBroadcast,
    canBroadcast,
    senderCanceledVisible,
    t,
    onClickDone,
    onClickExploreTx,
    onCancelSend,
    onAcceptReceive,
    onRejectReceive,
    onRetryBroadcast,
    onRequestCancellationReview,
    dismissSenderCanceled: () => setSenderCanceledVisible(false),
  }
}
