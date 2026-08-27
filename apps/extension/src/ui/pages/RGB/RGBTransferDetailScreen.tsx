import { Button, Card, Column, Content, CopyableAddress, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { colors } from '@/ui/theme/colors';
import { spacing } from '@/ui/theme/spacing';
import { shortAddress } from '@/ui/utils';
import {
  getRgbTokenPrecision,
  toRgbDisplayAmount,
  useRGBTransferDetailLogic,
  type RgbTransferItem
} from '@unisat/wallet-state';

import { RGBTransferNotificationPanel } from './components/RGBTransferNotificationPanel';

function getStatusLabel(status: string, t: (key: string) => string, type?: RgbTransferItem['type']) {
  switch (status.toLowerCase()) {
    case 'signed':
      return t('rgb_status_signed');
    case 'waiting_ack':
      return t('rgb_status_waiting_ack');
    case 'broadcasting':
      return t('rgb_status_broadcasting');
    case 'broadcasted':
      return t('rgb_status_broadcasted');
    case 'broadcast_failed':
      return t('rgb_status_broadcast_failed');
    case 'pending_accept':
      return t('rgb_status_pending_accept');
    case 'confirming':
    case 'pending':
    case 'unconfirmed':
    case 'waitingconfirmations':
      return t('rgb_status_confirming');
    case 'waiting_receive':
    case 'waitingcounterparty':
      return t('rgb_status_confirming');
    case 'settled':
    case 'confirmed':
      return t('rgb_status_confirmed');
    case 'canceled':
    case 'cancelled':
      return type === 'receive' ? t('rgb_status_canceled_by_sender') : t('rgb_status_canceled');
    case 'rejected':
      return t('rejected');
    default:
      return status || t('pending');
  }
}

function getDescription(transfer: RgbTransferItem | undefined, t: (key: string) => string) {
  if (transfer?.status === 'waiting_ack') return t('rgb_transfer_waiting_ack_description');
  if (transfer?.status === 'broadcasting') return t('rgb_transfer_broadcasting_description');
  if (transfer?.status === 'broadcasted') return t('rgb_transfer_broadcasted_description');
  if (transfer?.status === 'broadcast_failed') return t('rgb_transfer_broadcast_failed_description');
  if (transfer?.status === 'pending_accept') return t('rgb_transfer_pending_accept_description');
  if (transfer?.status === 'confirming' || transfer?.status === 'waiting_receive') {
    return t('rgb_transfer_confirming_description');
  }
  if (transfer?.status === 'canceled' || transfer?.status === 'cancelled') {
    return transfer.type === 'receive'
      ? t('rgb_transfer_canceled_by_sender_description')
      : t('rgb_transfer_canceled_description');
  }
  return '';
}

function isCanceledStatus(status: string) {
  return ['canceled', 'cancelled'].includes(status.toLowerCase());
}

function isConfirmedStatus(status: string) {
  return ['settled', 'confirmed'].includes(status.toLowerCase());
}

export default function RGBTransferDetailScreen() {
  const {
    transfer,
    transferId,
    loading,
    receiveActionLoading,
    broadcastRetryLoading,
    canAcceptReceive,
    canRetryBroadcast,
    notification,
    dismissNotification,
    onClickDone,
    onClickExploreTx,
    onAcceptReceive,
    onRejectReceive,
    onRetryBroadcast,
    t
  } = useRGBTransferDetailLogic();
  const status = transfer?.status || 'pending';
  const assetLabel = transfer?.ticker || transfer?.name || 'RGB';
  const displayAmount = transfer?.amount
    ? toRgbDisplayAmount(transfer.amount, getRgbTokenPrecision(transfer))
    : '--';
  const description = getDescription(transfer, t);
  const statusLabel = getStatusLabel(status, t, transfer?.type);
  const canExplore =
    !!transfer?.txid &&
    !['waiting_ack', 'broadcasting', 'broadcast_failed', 'pending_accept', 'rejected'].includes(status);
  const assetIdDisplay =
    transfer?.assetId?.replace(/^rgb:/i, '').slice(0, 12) || transfer?.assetId || '--';
  const counterpartyAddress =
    transfer?.type === 'receive' ? transfer?.from?.trim() : transfer?.type === 'send' ? transfer?.to?.trim() : '';
  const counterpartyLabel = transfer?.type === 'receive' ? t('from') : transfer?.type === 'send' ? t('to') : '';

  return (
    <Layout>
      <Header title={t('rgb_transfer_details')} onBack={onClickDone} />
      <Content style={{ gap: spacing.large, paddingLeft: 10, paddingRight: 10 }}>
        <Column mt="lg" itemsCenter gap="sm">
          <Icon icon={transfer?.type === 'receive' ? 'history_receive' : 'history_send'} size={48} />
          <Text
            preset="title"
            text={statusLabel}
            textCenter
            style={{
              color: isConfirmedStatus(status) ? '#7CDB98' : isCanceledStatus(status) ? '#EE344C' : undefined
            }}
          />
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
              <Text text={t('amount')} color="textDim" />
              <Text text={[displayAmount, assetLabel].filter(Boolean).join(' ')} />
            </Row>
            {counterpartyLabel ? (
              <Row justifyBetween itemsCenter>
                <Text text={counterpartyLabel} color="textDim" />
                {counterpartyAddress ? (
                  <CopyableAddress address={counterpartyAddress} />
                ) : (
                  <Text text="--" />
                )}
              </Row>
            ) : null}
            <Row justifyBetween itemsCenter>
              <Text text={t('asset_id')} color="textDim" />
              <Text text={assetIdDisplay} ellipsis />
            </Row>
            {status !== 'rejected' ? (
              <Row justifyBetween itemsCenter>
                <Text text={t('rgb_transfer_id')} color="textDim" />
                <Text text={shortAddress(transfer?.transferId || transferId, 10)} ellipsis />
              </Row>
            ) : null}
          </Column>
        </Card>

        {canExplore ? (
          <Row justifyCenter itemsCenter onClick={onClickExploreTx} gap="sm">
            <Icon icon="eye" color="textDim" />
            <Text preset="regular-bold" text={t('view_on_uniscan')} color="textDim" />
          </Row>
        ) : null}
        {loading ? <Text text={t('loading')} color="textDim" textCenter /> : null}
      </Content>
      <Footer>
        {canAcceptReceive ? (
          <Row fullX gap="md">
            <Button
              full
              text={t('rgb_reject_transfer')}
              preset="default"
              disabled={receiveActionLoading}
              onClick={() => void onRejectReceive()}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.42)' }}
              textStyle={{ color: colors.white, fontWeight: 'normal' }}
            />
            <Button
              full
              text={t('rgb_accept_transfer')}
              disabled={receiveActionLoading}
              onClick={() => void onAcceptReceive()}
            />
          </Row>
        ) : canRetryBroadcast ? (
          <Button
            full
            text={t('rgb_retry_broadcast')}
            disabled={broadcastRetryLoading}
            onClick={() => void onRetryBroadcast()}
          />
        ) : (
          <Button full text={t('done')} onClick={onClickDone} />
        )}
      </Footer>
      <RGBTransferNotificationPanel
        notification={notification}
        actionText={t('done')}
        onAction={dismissNotification}
        onClose={dismissNotification}
      />
    </Layout>
  );
}
