import { useCallback, useEffect, useState } from 'react'

import { useI18n, useNavigation, useTools, useWallet } from '../context'
import { useWalletConfig } from '../hooks/settings'
import type { RgbTransferItem } from '../types'
import { mergeRgbTransferAssetMetadata } from '../utils/rgb-transfer-metadata'
import { normalizeConfiguredRgbUsdt } from '../utils/rgb-usdt'

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
      'signed',
      'waiting_ack',
      'broadcasting',
      'broadcasted',
      'broadcast_failed',
      'pending_accept',
      'confirming',
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
  const configuredUsdtAssetId = useWalletConfig().rgbUsdtAssetId?.trim() || ''
  const { transferId, initialTransfer } = nav.getRouteState<'RGBTransferDetailScreen'>()
  const [transfer, setTransfer] = useState<RgbTransferItem | undefined>(() =>
    initialTransfer ? normalizeConfiguredRgbUsdt(initialTransfer, configuredUsdtAssetId) : undefined
  )
  const [loading, setLoading] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [receiveActionLoading, setReceiveActionLoading] = useState(false)
  const [broadcastRetryLoading, setBroadcastRetryLoading] = useState(false)

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
        return normalizeConfiguredRgbUsdt({
          ...latest,
          assetId: current?.assetId ?? latest.assetId,
          ticker: latest.ticker || current?.ticker,
          name: latest.name || current?.name,
          precision: latest.precision ?? current?.precision,
        }, configuredUsdtAssetId)
      })
    } catch {
      // Keep the most recently known state visible while the background refreshes.
    } finally {
      setLoading(false)
    }
  }, [configuredUsdtAssetId, transferId, wallet])

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
            ? normalizeConfiguredRgbUsdt(
                mergeRgbTransferAssetMetadata(current, detail),
                configuredUsdtAssetId
              )
            : current
        )
      })
      .catch(() => undefined)

    return () => {
      canceled = true
    }
  }, [configuredUsdtAssetId, transfer?.assetId, transfer?.precision, wallet])

  useEffect(() => {
    if (!isInProgress(transfer)) return undefined
    const intervalId = setInterval(() => void refresh(), 10_000)
    return () => clearInterval(intervalId)
  }, [refresh, transfer])

  const canCancelSend =
    transfer?.type === 'send' && String(transfer?.status || '').toLowerCase() === 'waiting_ack'
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
      const result = await wallet.abortRgbVanillaTx({ txid: abortId })
      if (!result?.aborted) {
        throw new Error(t('rgb_cancel_send_failed'))
      }
      tools.toastSuccess(t('rgb_cancel_send_success'))
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

    setReceiveActionLoading(true)
    try {
      const result = await wallet.acceptRgbReceive({ recipientId })
      if (result?.status === 'canceled') {
        tools.toastError(t('rgb_status_canceled_by_sender'))
        setTransfer(current =>
          current ? { ...current, status: 'canceled', local: true } : current
        )
        return false
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
      setTransfer(current => (current ? { ...current, status: 'rejected', local: true } : current))
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

  return {
    transfer,
    transferId,
    loading,
    cancelLoading,
    receiveActionLoading,
    broadcastRetryLoading,
    canCancelSend,
    canAcceptReceive,
    canRetryBroadcast,
    canBroadcast,
    t,
    onClickDone,
    onClickExploreTx,
    onCancelSend,
    onAcceptReceive,
    onRejectReceive,
    onRetryBroadcast,
  }
}
