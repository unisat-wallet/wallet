import { useState } from 'react';

import { Button, Card, Column, Content, CopyableAddress, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { TxResultStatusMark } from '@/ui/components/TxResultStatusMark';
import { colors } from '@/ui/theme/colors';
import { spacing } from '@/ui/theme/spacing';
import {
  getRgbTokenPrecision,
  toRgbDisplayAmount,
  useChain,
  useRGBTransferDetailLogic,
  useTools,
  useWallet,
  type RgbTransferItem
} from '@unisat/wallet-state';

import { RGBRejectReceiveConfirmModal } from './components/RGBRejectReceiveConfirmModal';
import { RGBTransferReasonTooltip } from './components/RGBTransferReasonTooltip';
import { getRgbBurnNetworkName } from './rgbBurnNetworks';

function getStatusLabel(status: string, t: (key: string) => string, type?: RgbTransferItem['type']) {
  switch (status.toLowerCase()) {
    case 'signed':
      return t('rgb_status_signed');
    case 'waiting_ack':
      return t('rgb_status_waiting_ack');
    case 'ready_to_broadcast':
      return t('rgb_status_ready_to_broadcast');
    case 'ready_for_dapp_finalize':
      return t('rgb_status_ready_for_dapp_finalize');
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

function getDescription(transfer: RgbTransferItem | undefined, t: (key: string) => string) {
  if (transfer?.status === 'waiting_ack') return t('rgb_transfer_waiting_ack_description');
  if (transfer?.status === 'ready_to_broadcast') return t('rgb_transfer_ready_to_broadcast_description');
  if (transfer?.status === 'ready_for_dapp_finalize') return t('rgb_transfer_ready_for_dapp_finalize_description');
  if (transfer?.status === 'broadcasting') return t('rgb_transfer_broadcasting_description');
  if (transfer?.status === 'broadcasted') return t('rgb_transfer_broadcasted_description');
  if (transfer?.status === 'broadcast_failed') return t('rgb_transfer_broadcast_failed_description');
  if (transfer?.status === 'pending_accept') return t('rgb_transfer_pending_accept_description');
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

function isConfirmedStatus(status: string) {
  return ['settled', 'confirmed'].includes(status.toLowerCase());
}

function isFailedStatus(status: string) {
  return ['canceled', 'cancelled', 'rejected', 'validation_failed', 'broadcast_failed', 'failed'].includes(status.toLowerCase());
}

export default function RGBTransferDetailScreen() {
  const wallet = useWallet();
  const tools = useTools();
  const chain = useChain();
  const [dismissedBroadcastId, setDismissedBroadcastId] = useState<string>();
  const [rejectConfirmVisible, setRejectConfirmVisible] = useState(false);
  const {
    transfer,
    transferId,
    loading,
    receiveActionLoading,
    broadcastRetryLoading,
    canAcceptReceive,
    canRetryBroadcast,
    canBroadcast,
    onClickDone,
    onClickExploreTx,
    onAcceptReceive,
    onRejectReceive,
    onRetryBroadcast,
    t
  } = useRGBTransferDetailLogic();
  const status = transfer?.status || 'pending';
  const assetName = transfer?.name || transfer?.ticker || 'RGB';
  const displayAmount = transfer?.amount
    ? toRgbDisplayAmount(transfer.amount, getRgbTokenPrecision(transfer))
    : '--';
  const burnDestinationChainId = transfer?.burn ? transfer.burnDestinationChainId ?? 42161 : undefined;
  const description = getDescription(transfer, t);
  const statusLabel = getStatusLabel(status, t, transfer?.type);
  const canExplore =
    !!transfer?.txid &&
    !['waiting_ack', 'ready_to_broadcast', 'ready_for_dapp_finalize', 'broadcasting', 'broadcast_failed', 'pending_accept', 'canceled', 'cancelled'].includes(status.toLowerCase()) &&
    (status.toLowerCase() !== 'rejected' || !!transfer.broadcasted);
  const assetId = transfer?.assetId?.trim();

  const isConfirmed = isConfirmedStatus(status);
  const isFailed = isFailedStatus(status);
  const isRejectedReceive = transfer?.type === 'receive' && status.toLowerCase() === 'rejected';
  const hasValidationFailure = transfer?.type === 'receive' && status.toLowerCase() === 'validation_failed';
  const isIssue = transfer?.type === 'issue';
  const recordId = isIssue ? transfer?.txid : transfer?.transferId || transferId;

  const downloadBurn = async () => {
    if (!transfer?.txid) return;
    try {
      const burn = await wallet.exportRgbBurn(transfer.txid);
      const url = URL.createObjectURL(new Blob([JSON.stringify(burn, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bfa-burn-${transfer.txid}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Layout>
      <Header title={t('rgb_transfer_details')} onBack={onClickDone} />
      <Content style={{ gap: spacing.large, paddingLeft: 10, paddingRight: 10 }}>
        <Column mt="lg" itemsCenter gap="sm">
          {isFailed ? (
            <Icon icon={transfer?.type === 'receive' ? 'history_receive' : 'history_send'} size={72} />
          ) : (
            <TxResultStatusMark pending={!isConfirmed} />
          )}
          <Row itemsCenter gap="xs">
            <Text
              preset="title"
              text={statusLabel}
              textCenter
              style={{
                color: isConfirmed ? '#7CDB98' : isFailed ? '#EE344C' : '#F4B62C'
              }}
            />
            {isRejectedReceive || hasValidationFailure ? (
              <RGBTransferReasonTooltip
                label={t(hasValidationFailure ? 'rgb_validation_reason' : 'rgb_rejection_reason')}
                reason={transfer?.rejectionReason || t('rgb_rejection_reason_unavailable')}
              />
            ) : null}
          </Row>
          {description ? <Text preset="sub" text={description} color="textDim" textCenter /> : null}
        </Column>

        <Card
          fullX
          style={{
            padding: 12,
            borderRadius: 16,
            flexDirection: 'column',
            alignItems: 'stretch',
            justifyContent: 'flex-start'
          }}>
          <Column fullX gap="lg">
            <Row justifyBetween itemsCenter>
              <Text text={t('name_label')} color="textDim" />
              <Text text={assetName} color="ticker_color2" ellipsis />
            </Row>
            <Row justifyBetween itemsCenter>
              <Text text={t('asset_id')} color="textDim" style={{ flexShrink: 0 }} />
              {assetId ? (
                <CopyableAddress address={assetId} copyPosition="after" len={10} color="ticker_color2" />
              ) : (
                <Text text="--" color="ticker_color2" />
              )}
            </Row>
            <Row justifyBetween itemsCenter>
              <Text text={t('amount')} color="textDim" />
              <Text text={displayAmount} color="ticker_color2" />
            </Row>
            {burnDestinationChainId !== undefined ? (
              <Row justifyBetween itemsCenter>
                <Text text={t('rgb_burn_network')} color="textDim" />
                <Text text={getRgbBurnNetworkName(burnDestinationChainId)} color="ticker_color2" />
              </Row>
            ) : null}
            {status !== 'rejected' || transfer?.broadcasted ? (
              <Row justifyBetween itemsCenter>
                <Text text={t(isIssue ? 'rgb_genesis_txid' : 'rgb_transfer_id')} color="textDim" />
                {recordId ? (
                  <CopyableAddress
                    address={recordId}
                    copyPosition="after"
                    len={10}
                    color="ticker_color2"
                  />
                ) : (
                  <Text text="--" color="ticker_color2" />
                )}
              </Row>
            ) : null}
            {status === 'rejected' && transfer?.broadcasted && transfer.txid ? (
              <Row justifyBetween itemsCenter>
                <Text text={t('transaction_id')} color="textDim" />
                <CopyableAddress address={transfer.txid} copyPosition="after" len={10} color="ticker_color2" />
              </Row>
            ) : null}
          </Column>
        </Card>

        {canExplore ? (
          <Row justifyCenter itemsCenter onClick={onClickExploreTx} gap="sm">
            <Icon icon="eye" color="textDim" />
            <Text
              preset="regular-bold"
              text={t(chain.unisatExplorerUrl ? 'view_on_uniscan' : 'view_on_explorer')}
              color="textDim"
            />
          </Row>
        ) : null}
        {loading ? <Text text={t('loading')} color="textDim" textCenter /> : null}
      </Content>
      <Footer>
        <Column gap="sm">
          {transfer?.burn && transfer.txid ? (
            <Button
              full
              text={t(transfer.burnDestinationChainId === undefined ? 'rgb_download_burn_proof' : 'rgb_download_burn')}
              preset="primary"
              style={{ height: 50, minHeight: 50, borderRadius: 12 }}
              onClick={() => void downloadBurn()}
              data-testid="rgb-download-burn"
            />
          ) : null}
          {canAcceptReceive ? (
            <Row fullX gap="md">
              <Button
                full
                text={t('rgb_reject_transfer')}
                preset="default"
                disabled={receiveActionLoading}
                onClick={() => setRejectConfirmVisible(true)}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.42)' }}
                textStyle={{ color: colors.white, fontWeight: 'normal' }}
              />
              <Button
                full
                text={t('rgb_accept_transfer')}
                disabled={receiveActionLoading}
                data-testid="rgb-transfer-accept-button"
                onClick={() => void onAcceptReceive()}
              />
            </Row>
          ) : canBroadcast || canRetryBroadcast ? (
            <Button
              full
              text={t(canBroadcast ? 'Broadcast' : 'rgb_retry_broadcast')}
              disabled={broadcastRetryLoading}
              onClick={() => void onRetryBroadcast()}
            />
          ) : (
            <Button full text={t('done')} onClick={onClickDone} />
          )}
        </Column>
      </Footer>
      <RGBRejectReceiveConfirmModal
        visible={rejectConfirmVisible}
        loading={receiveActionLoading}
        onClose={() => setRejectConfirmVisible(false)}
        onConfirm={() => {
          void onRejectReceive().then(rejected => {
            if (rejected) setRejectConfirmVisible(false);
          });
        }}
      />
      {canBroadcast && dismissedBroadcastId !== transferId ? (
        <BottomModal onClose={() => setDismissedBroadcastId(transferId)}>
          <Column fullX gap="lg">
            <Text preset="title" text={t('rgb_status_ready_to_broadcast')} />
            <Text text={t('rgb_transfer_ready_to_broadcast_description')} color="textDim" />
            <Button
              full
              text={t('Broadcast')}
              disabled={broadcastRetryLoading}
              onClick={() => void onRetryBroadcast()}
            />
          </Column>
        </BottomModal>
      ) : null}
    </Layout>
  );
}
