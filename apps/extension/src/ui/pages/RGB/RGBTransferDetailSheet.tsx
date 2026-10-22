import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button, Checkbox, Column, Row, Text, Icon, CopyableAddress, RGBAssetIcon } from '@/ui/components';
import { BottomSheetHeader } from '@/ui/components/BottomSheetHeader';
import { BottomModal } from '@/ui/components/BottomModal';
import { getRgbAssetName } from '@/ui/components/RGBAssetIcon';
import { colors } from '@/ui/theme/colors';
import {
  getRgbTokenIconInfo,
  getRgbTokenPrecision,
  toRgbDisplayAmount,
  useChain,
  useI18n,
  useTools,
  useWallet,
  type RgbTransferItem
} from '@unisat/wallet-state';

import { useRgbWriteLeaseGuard } from './components/useRgbWriteLeaseGuard';
import { RGBRejectReceiveConfirmModal } from './components/RGBRejectReceiveConfirmModal';
import { RGBTransferReasonTooltip } from './components/RGBTransferReasonTooltip';

function getStatusLabel(status: string, t: (key: string) => string, type?: RgbTransferItem['type']) {
  switch (status.toLowerCase()) {
    case 'signed':
      return t('rgb_status_signed');
    case 'waiting_ack':
      return t('rgb_status_waiting_ack');
    case 'ready_to_broadcast':
      return t('rgb_status_ready_to_broadcast');
    case 'broadcasting':
      return t('rgb_status_broadcasting');
    case 'broadcasted':
      return t('rgb_status_broadcasted');
    case 'broadcast_failed':
      return t('rgb_status_broadcast_failed');
    case 'pending_accept':
      return t('rgb_status_pending_accept');
    case 'validation_failed':
      return t('rgb_status_validation_failed');
    case 'confirming':
    case 'pending':
    case 'unconfirmed':
    case 'waitingconfirmations':
      return t('rgb_status_confirming');
    case 'waiting_receive':
    case 'waitingcounterparty':
      return t('rgb_status_waiting_receive');
    case 'settled':
    case 'confirmed':
      return t('rgb_status_confirmed');
    case 'canceled':
    case 'cancelled':
      return type === 'receive' ? t('rgb_status_canceled_by_sender') : t('rgb_status_canceled');
    case 'rejected':
      return type === 'send' ? t('rgb_status_rejected_by_receiver') : t('rejected');
    default:
      return status || t('pending');
  }
}

function getTransferTitle(type: RgbTransferItem['type'] | undefined, t: (key: string) => string) {
  if (type === 'receive') return t('receive');
  if (type === 'issue') return t('issue');
  return t('send');
}

function getDescription(transfer: RgbTransferItem | undefined, t: (key: string) => string) {
  if (transfer?.status === 'waiting_ack') return t('rgb_transfer_waiting_ack_description');
  if (transfer?.status === 'ready_to_broadcast') return t('rgb_transfer_ready_to_broadcast_description');
  if (transfer?.status === 'broadcasting') return t('rgb_transfer_broadcasting_description');
  if (transfer?.status === 'broadcasted') return t('rgb_transfer_broadcasted_description');
  if (transfer?.status === 'broadcast_failed') return t('rgb_transfer_broadcast_failed_description');
  if (transfer?.status === 'pending_accept') return t('rgb_transfer_pending_accept_description');
  if (transfer?.status === 'validation_failed') return t('rgb_transfer_validation_failed_description');
  if (transfer?.status === 'confirming') {
    return t('rgb_transfer_confirming_description');
  }
  if (transfer?.status === 'canceled' || transfer?.status === 'cancelled') {
    return transfer.type === 'receive'
      ? t('rgb_transfer_canceled_by_sender_description')
      : t('rgb_transfer_canceled_description');
  }
  return '';
}

function getStatusColor(status: string) {
  const value = status.toLowerCase();
  if (['settled', 'confirmed'].includes(value)) return '#7CDB98';
  if (['canceled', 'cancelled', 'rejected', 'failed', 'broadcast_failed'].includes(value)) return '#EE344C';
  return '#F4B62C';
}

function formatDate(timestamp: number) {
  if (!timestamp) return '--';
  const date = new Date(timestamp > 1000000000000 ? timestamp : timestamp * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function resolveAbortTransferId(transfer?: RgbTransferItem, transferId?: string) {
  const candidates = [transfer?.transferId, transferId, transfer?.id, transfer?.txid];
  for (const candidate of candidates) {
    if (!candidate) continue;
    return candidate.startsWith('local-send:') ? candidate.slice('local-send:'.length) : candidate;
  }
  return '';
}

function resolveReceiveRecipientId(transfer?: RgbTransferItem, transferId?: string) {
  const candidates = [transfer?.transferId, transferId, transfer?.id];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.startsWith('local-receive:')) return candidate.slice('local-receive:'.length);
    if (candidate.startsWith('receive:')) return candidate.slice('receive:'.length);
    return candidate;
  }
  return '';
}

function getTransferActionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (!error || typeof error !== 'object') return fallback;
  const message = (error as Record<string, unknown>)['message'];
  return typeof message === 'string' && message ? message : fallback;
}

function DetailRow({
  label,
  value,
  valueColor = 'rgba(255,255,255,0.85)'
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <Row fullX justifyBetween itemsCenter style={{ minHeight: 32 }}>
      <Text
        text={label}
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: 'rgba(255,255,255,0.45)'
        }}
      />
      <Text
        text={value}
        ellipsis
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: valueColor,
          textAlign: 'right',
          maxWidth: '60%'
        }}
      />
    </Row>
  );
}

const confirmMaskStyle = {
  position: 'fixed' as const,
  inset: 0,
  zIndex: 1100,
  background: 'rgba(0,0,0,0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 16px',
  boxSizing: 'border-box' as const
};

const confirmModalStyle = {
  width: '100%',
  borderRadius: 14,
  padding: '28px 16px 24px',
  background: '#171B21',
  boxSizing: 'border-box' as const,
  position: 'relative' as const
};

export type RGBTransferDetailSheetProps = {
  transfer?: RgbTransferItem;
  transferId?: string;
  loading?: boolean;
  onClose: () => void;
  onClickExploreTx?: () => void;
  onCanceled?: () => void;
  onAccepted?: () => void;
  remainingBroadcastCount?: number;
};

export function RGBTransferDetailSheet({
  transfer,
  transferId,
  loading,
  onClose,
  onClickExploreTx,
  onCanceled,
  onAccepted,
  remainingBroadcastCount = 0
}: RGBTransferDetailSheetProps) {
  const { t } = useI18n();
  const chain = useChain();
  const wallet = useWallet();
  const tools = useTools();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const [cancelConfirmVisible, setCancelConfirmVisible] = useState(false);
  const [rejectConfirmVisible, setRejectConfirmVisible] = useState(false);
  const [cancelAcknowledged, setCancelAcknowledged] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [broadcastRetryLoading, setBroadcastRetryLoading] = useState(false);

  const status = transfer?.status || 'pending';
  useEffect(() => {
    if (transfer?.type !== 'receive' || status.toLowerCase() !== 'rejected') return;
    const historyId = transfer.transferId || transferId || transfer.id;
    const recipientId = historyId.replace(/^local-receive:/, '').replace(/^receive:/, '');
    let canceled = false;
    void wallet.getRgbPendingReceiveInvoices({ skipSync: true }).then(
      ({ list }) => {
        if (canceled) return;
        const pending = list.find((invoice) => invoice.recipientId === recipientId);
        console.warn('[RGB receive recovery] Rejected history detail', {
          historyId,
          recipientId,
          txid: transfer.txid || null,
          assetId: transfer.assetId || null,
          amount: transfer.amount || null,
          status: transfer.status,
          source: transfer.local ? 'local' : 'indexer',
          timestamp: transfer.timestamp,
          pendingInvoice: pending
            ? {
                status: pending.status,
                kind: pending.kind,
                assetId: pending.assetId,
                amount: pending.amount,
                createdAt: pending.createdAt,
                expirationTimestamp: pending.expirationTimestamp
              }
            : null
        });
      },
      (error: unknown) => {
        if (!canceled) {
          console.warn('[RGB receive recovery] Pending invoice lookup failed', {
            historyId,
            error: getTransferActionErrorMessage(error, 'Unknown error')
          });
        }
      }
    );
    return () => {
      canceled = true;
    };
  }, [
    transfer?.id,
    transfer?.transferId,
    transfer?.type,
    transfer?.status,
    transfer?.txid,
    transfer?.assetId,
    transfer?.amount,
    transfer?.local,
    transfer?.timestamp,
    transferId,
    wallet
  ]);
  const ticker = transfer?.ticker || transfer?.name || 'RGB';
  const assetName = transfer?.name || transfer?.ticker || 'RGB';
  const isCanceledReceive = transfer?.type === 'receive' && ['canceled', 'cancelled'].includes(status.toLowerCase());
  const isRejectedReceive = transfer?.type === 'receive' && status.toLowerCase() === 'rejected';
  const hasValidationFailure = transfer?.type === 'receive' && status.toLowerCase() === 'validation_failed';
  const amountPrefix = isCanceledReceive
    ? ''
    : transfer?.type === 'receive'
      ? '+'
      : transfer?.type === 'send'
        ? '-'
        : '';
  const displayAmount = transfer?.amount ? toRgbDisplayAmount(transfer.amount, getRgbTokenPrecision(transfer)) : '--';
  const amountText = amountPrefix + displayAmount;
  const description = getDescription(transfer, t);
  const canExplore =
    !!transfer?.txid &&
    !['waiting_ack', 'ready_to_broadcast', 'broadcasting', 'broadcast_failed', 'pending_accept', 'validation_failed', 'rejected', 'canceled', 'cancelled'].includes(status.toLowerCase()) &&
    !!onClickExploreTx;
  const canCancelSend =
    transfer?.type === 'send' && ['signed', 'waiting_ack'].includes(String(transfer?.status || '').toLowerCase());
  const canAcceptReceive =
    transfer?.type === 'receive' &&
    transfer.local === true &&
    String(transfer?.status || '').toLowerCase() === 'pending_accept';
  const canRetryBroadcast =
    transfer?.type === 'send' && String(transfer?.status || '').toLowerCase() === 'broadcast_failed';
  const canBroadcast =
    transfer?.type === 'send' && String(transfer?.status || '').toLowerCase() === 'ready_to_broadcast';
  const isUnbroadcastSend = transfer?.type === 'send' && !transfer.burn &&
    ['signed', 'waiting_ack', 'ready_to_broadcast'].includes(status.toLowerCase());
  const reservedAmount = transfer?.lockedAmount && /^\d+$/.test(transfer.lockedAmount)
    ? BigInt(transfer.lockedAmount)
    : undefined;
  const sendingAmount = transfer?.amount && /^\d+$/.test(transfer.amount)
    ? BigInt(transfer.amount)
    : undefined;
  const expectedChange = isUnbroadcastSend && reservedAmount !== undefined && sendingAmount !== undefined &&
    reservedAmount >= sendingAmount
    ? reservedAmount - sendingAmount
    : undefined;
  const assetId = transfer?.assetId?.trim();
  const isIssue = transfer?.type === 'issue';
  const recordId = isIssue ? transfer?.txid : transfer?.transferId || transferId || '';
  const detailRecordId = isRejectedReceive || hasValidationFailure
    ? resolveReceiveRecipientId(transfer, transferId)
    : recordId || '';

  const onCancelSend = async () => {
    const abortId = resolveAbortTransferId(transfer, transferId);
    if (!abortId) {
      tools.toastError(t('rgb_cancel_send_failed'));
      return false;
    }
    if (cancelLoading) return false;

    setCancelLoading(true);
    try {
      const result = await wallet.abortRgbVanillaTx({ txid: abortId });
      if (!result?.aborted) {
        throw new Error(t('rgb_cancel_send_failed'));
      }
      tools.toastSuccess(t('rgb_cancel_send_success'));
      onClose();
      onCanceled?.();
      return true;
    } catch (e: unknown) {
      const message = getTransferActionErrorMessage(e, t('rgb_cancel_send_failed'));
      tools.toastError(message);
      return false;
    } finally {
      setCancelLoading(false);
    }
  };

  const onAcceptReceive = async () => {
    const recipientId = resolveReceiveRecipientId(transfer, transferId);
    if (!recipientId || actionLoading) return;
    setActionLoading(true);
    try {
      const result = await wallet.acceptRgbReceive({ recipientId });
      if (result?.status === 'canceled') {
        tools.toastError(t('rgb_status_canceled_by_sender'));
      } else if (!result?.accepted) {
        throw new Error(t('rgb_accept_transfer_failed'));
      } else {
        tools.toastSuccess(t('rgb_accept_transfer_success'));
        onAccepted?.();
      }
      onClose();
      onCanceled?.();
    } catch (e: unknown) {
      const message = getTransferActionErrorMessage(e, t('rgb_accept_transfer_failed'));
      tools.toastError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const onRejectReceive = async () => {
    const recipientId = resolveReceiveRecipientId(transfer, transferId);
    if (!recipientId || actionLoading) return;
    setActionLoading(true);
    try {
      await wallet.rejectRgbReceive({ recipientId });
      tools.toastSuccess(t('rgb_reject_transfer_success'));
      onClose();
      onCanceled?.();
    } catch (e: unknown) {
      const message = getTransferActionErrorMessage(e, t('rgb_reject_transfer_failed'));
      tools.toastError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const onRetryBroadcast = async () => {
    const retryTransferId = resolveAbortTransferId(transfer, transferId);
    if (!retryTransferId || broadcastRetryLoading) return;
    setBroadcastRetryLoading(true);
    try {
      const result = await wallet.retryRgbBroadcast({ transferId: retryTransferId });
      if (!result.broadcast) throw new Error(result.error || t('rgb_retry_broadcast_failed'));
      tools.toastSuccess(t('rgb_transfer_broadcast_success'));
      onClose();
      onCanceled?.();
    } catch (e: unknown) {
      const message = getTransferActionErrorMessage(e, t('rgb_retry_broadcast_failed'));
      tools.toastError(message);
    } finally {
      setBroadcastRetryLoading(false);
    }
  };

  const renderCancelConfirmModal = () => {
    if (!cancelConfirmVisible || typeof document === 'undefined' || !document.body) return null;

    return createPortal(
      <div style={confirmMaskStyle}>
        <Column gap="zero" style={confirmModalStyle}>
          <Icon
            icon="close"
            color="white_muted2"
            size={12}
            onClick={() => setCancelConfirmVisible(false)}
            containerStyle={{ position: 'absolute', top: 30, right: 22 }}
          />
          <Text text={t('rgb_cancel_send_confirm_title')} color="white" size="md" textCenter />
          <Text
            text={t('rgb_cancel_send_confirm_description')}
            color="white_muted2"
            size="sm"
            wrap
            style={{ marginTop: 16 }}
          />
          <Checkbox
            checked={cancelAcknowledged}
            onChange={(event) => setCancelAcknowledged(event.target.checked)}
            style={{ marginTop: 20 }}
            data-testid="rgb-cancel-transfer-checkbox"
          >
            <Text
              text={t('rgb_cancel_send_acknowledgement')}
              size="sm"
              wrap
              style={{ lineHeight: '20px', color: 'rgba(255, 255, 255, 0.65)' }}
            />
          </Checkbox>
          <Row gap="md" fullX style={{ marginTop: 24 }}>
            <Button
              text={t('cancel_transfer')}
              preset="default"
              disabled={cancelLoading || !cancelAcknowledged}
              onClick={() => {
                setCancelConfirmVisible(false);
                void requestWrite(() => void onCancelSend());
              }}
              full
              style={{ height: 48, background: 'transparent', border: '1px solid rgba(255,255,255,0.42)' }}
              textStyle={{ color: colors.white, fontWeight: 'normal' }}
            />
            <Button
              text={t('keep_transfer')}
              preset="primary"
              disabled={cancelLoading}
              onClick={() => {
                setCancelAcknowledged(false);
                setCancelConfirmVisible(false);
              }}
              full
              style={{ height: 48 }}
              textStyle={{ color: colors.black, fontWeight: 'normal' }}
            />
          </Row>
        </Column>
      </div>,
      document.body
    );
  };

  return (
    <>
      <BottomModal onClose={onClose} bodyStyle={{ padding: 0 }}>
        <Column fullX gap="zero">
          <BottomSheetHeader
            title={getTransferTitle(transfer?.type, t)}
            onClose={onClose}
            inset={16}
            height={60}
            bottomSpacing={24}
          />

          <Column fullX itemsCenter style={{ paddingLeft: 16, paddingRight: 16, gap: 24 }}>
            <Row itemsCenter fullX style={{ gap: 8, minWidth: 0 }}>
              <RGBAssetIcon
                iconInfo={getRgbTokenIconInfo(transfer, ticker)}
                ticker={ticker}
                name={getRgbAssetName(transfer) || assetName}
                size={32}
              />
              <Column gap="xs" style={{ minWidth: 0, maxWidth: 'calc(100% - 40px)' }}>
                {!isCanceledReceive && !isRejectedReceive && !hasValidationFailure && transfer?.amount ? (
                  <Text
                    text={amountText}
                    style={{
                      fontSize: amountText.length > 22 ? 16 : 18,
                      fontWeight: 500,
                      color: 'rgba(255,255,255,0.85)',
                      lineHeight: '1.4',
                      maxWidth: '100%',
                      whiteSpace: 'nowrap',
                      overflowX: 'auto'
                    }}
                  />
                ) : null}
                <Row itemsCenter style={{ gap: 8, minWidth: 0 }}>
                  {!isCanceledReceive ? (
                    <Text
                      text={assetName}
                      ellipsis
                      style={{ minWidth: 0, fontSize: 16, fontWeight: 500, color: 'rgba(255,255,255,0.85)', lineHeight: '1.4' }}
                    />
                  ) : null}
                  <Row itemsCenter justifyCenter style={{ height: 20, flexShrink: 0, paddingLeft: 6, paddingRight: 6, borderRadius: 4, backgroundColor: 'rgba(244,182,44,0.1)' }}>
                    <Text text="RGB" style={{ fontSize: 12, fontWeight: 600, color: 'rgba(244,182,44,0.85)' }} />
                  </Row>
                </Row>
              </Column>
            </Row>

            {description ? <Text text={description} color="textDim" textCenter size="xs" /> : null}
            {isUnbroadcastSend ? <Text text={t('rgb_send_not_deducted_yet')} color="textDim" textCenter size="xs" /> : null}
            {canBroadcast && remainingBroadcastCount > 0 ? (
              <Text
                text={`${t('rgb_more_transfers_to_broadcast')}: ${remainingBroadcastCount}`}
                color="gold"
                textCenter
                size="xs"
              />
            ) : null}

            <Column fullX style={{ gap: 12 }}>
              <DetailRow label={t('date')} value={formatDate(transfer?.timestamp || 0)} />
              <Row fullX justifyBetween itemsCenter style={{ minHeight: 32 }}>
                <Text text={t('status')} style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.45)' }} />
                <Row itemsCenter gap="xs">
                  <Text
                    text={getStatusLabel(status, t, transfer?.type)}
                    style={{ fontSize: 14, fontWeight: 500, color: getStatusColor(status) }}
                  />
                  {isRejectedReceive || hasValidationFailure ? (
                    <RGBTransferReasonTooltip
                      label={t(hasValidationFailure ? 'rgb_validation_reason' : 'rgb_rejection_reason')}
                      reason={transfer?.rejectionReason || t('rgb_rejection_reason_unavailable')}
                    />
                  ) : null}
                </Row>
              </Row>
              {expectedChange !== undefined ? (
                <>
                  <DetailRow label={t('rgb_reserved_for_pending_send')} value={toRgbDisplayAmount(reservedAmount!.toString(), getRgbTokenPrecision(transfer))} />
                  <DetailRow label={t('rgb_sending_amount')} value={displayAmount} />
                  <DetailRow label={t('rgb_expected_change')} value={toRgbDisplayAmount(expectedChange.toString(), getRgbTokenPrecision(transfer))} />
                </>
              ) : null}
              {isRejectedReceive && transfer?.amount ? (
                <DetailRow label={t('amount')} value={displayAmount} />
              ) : null}
              {assetId || (!isRejectedReceive && !hasValidationFailure) ? <Row fullX justifyBetween itemsCenter style={{ minHeight: 32 }}>
                <Text
                  text={t('asset_id')}
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: 'rgba(255,255,255,0.45)',
                    flexShrink: 0
                  }}
                />
                {assetId ? (
                  <CopyableAddress address={assetId} copyPosition="after" len={10} color="ticker_color2" />
                ) : (
                  <Text
                    text="--"
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: 'rgba(255,255,255,0.85)'
                    }}
                  />
                )}
              </Row> : null}
              {status !== 'rejected' || isRejectedReceive ? (
                <Row fullX justifyBetween itemsCenter style={{ minHeight: 32 }}>
                  <Text
                    text={t(isRejectedReceive || hasValidationFailure ? 'rgb_recipient_id' : isIssue ? 'rgb_genesis_txid' : 'rgb_transfer_id')}
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: 'rgba(255,255,255,0.45)'
                    }}
                  />
                  {detailRecordId ? (
                    <CopyableAddress
                      address={detailRecordId}
                      copyPosition="after"
                      len={10}
                      color="ticker_color2"
                    />
                  ) : (
                    <Text text="--" color="ticker_color2" />
                  )}
                </Row>
              ) : null}
            </Column>

            {loading ? <Text text={t('loading')} color="textDim" textCenter size="xs" /> : null}
          </Column>

          <Column
            fullX
            style={{
              marginTop: 32,
              padding: 16,
              borderTopWidth: 1,
              borderTopColor: 'rgba(255,255,255,0.06)',
              boxSizing: 'border-box'
            }}
          >
            {canAcceptReceive ? (
              <Row gap="md" fullX>
                <Button
                  text={t('rgb_reject_transfer')}
                  preset="default"
                  disabled={actionLoading}
                  onClick={() => setRejectConfirmVisible(true)}
                  full
                  style={{
                    height: 48,
                    minHeight: 48,
                    flex: 1,
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.42)'
                  }}
                  textStyle={{ color: colors.white, fontWeight: 'normal' }}
                />
                <Button
                  text={t('rgb_accept_transfer')}
                  preset="primary"
                  disabled={actionLoading}
                  onClick={() => void requestWrite(() => void onAcceptReceive())}
                  full
                  style={{ height: 48, minHeight: 48, flex: 1 }}
                  textStyle={{ color: colors.black, fontWeight: 'normal' }}
                />
              </Row>
            ) : hasValidationFailure && transfer?.canReject ? (
              <Button
                text={t('rgb_reject_transfer')}
                preset="default"
                disabled={actionLoading}
                onClick={() => setRejectConfirmVisible(true)}
                full
                style={{ height: 48, minHeight: 48 }}
              />
            ) : canBroadcast || canRetryBroadcast ? (
              <Button
                text={t(canBroadcast ? 'Broadcast' : 'rgb_retry_broadcast')}
                preset="primary"
                disabled={broadcastRetryLoading}
                onClick={() => void requestWrite(() => void onRetryBroadcast())}
                full
                style={{ height: 48, minHeight: 48, width: '100%' }}
                textStyle={{ color: colors.black, fontWeight: 'normal' }}
              />
            ) : canCancelSend ? (
              <Button
                text={t('cancel_transfer')}
                preset="default"
                disabled={cancelLoading}
                onClick={() => {
                  setCancelAcknowledged(false);
                  setCancelConfirmVisible(true);
                }}
                style={{
                  height: 48,
                  minHeight: 48,
                  width: '100%',
                  flex: 'none',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.42)'
                }}
                textStyle={{ color: colors.white, fontWeight: 'normal' }}
              />
            ) : canExplore ? (
              <Button
                text={t(chain.unisatExplorerUrl ? 'view_on_uniscan' : 'view_on_explorer')}
                preset="primary"
                onClick={onClickExploreTx}
                style={{ height: 48, minHeight: 48, width: '100%', flex: 'none' }}
              />
            ) : (
              <Button
                text={t('done')}
                preset="primary"
                onClick={onClose}
                style={{ height: 48, minHeight: 48, width: '100%', flex: 'none' }}
              />
            )}
          </Column>
        </Column>
        {renderCancelConfirmModal()}
      </BottomModal>
      <RGBRejectReceiveConfirmModal
        visible={rejectConfirmVisible}
        loading={actionLoading}
        description={hasValidationFailure && transfer?.rejectLocally ? t('rgb_reject_receive_local_only_description') : undefined}
        onClose={() => setRejectConfirmVisible(false)}
        onConfirm={() => {
          setRejectConfirmVisible(false);
          void requestWrite(() => void onRejectReceive());
        }}
      />
      {writeLeaseModal}
    </>
  );
}
