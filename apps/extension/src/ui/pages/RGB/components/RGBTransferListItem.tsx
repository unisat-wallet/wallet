import { Column, Icon, RGBAssetIcon, Row, Text } from '@/ui/components';
import { HistoryAmount } from '@/ui/components/HistoryAmount';
import type { IconTypes } from '@/ui/components/Icon';
import { getRgbAssetName } from '@/ui/components/RGBAssetIcon';
import { colors } from '@/ui/theme/colors';
import {
  getRgbTokenIconInfo,
  getRgbTokenPrecision,
  toRgbDisplayAmount,
  useI18n,
  type RgbTransferItem
} from '@unisat/wallet-state';

export function getRgbTransferDateKey(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp > 1000000000000 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function formatTransferTime(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp > 1000000000000 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getTransferTitle(type: RgbTransferItem['type'], t: (key: string) => string) {
  if (type === 'send') return t('send');
  if (type === 'receive') return t('receive');
  return t('issue');
}

function getStatusLabel(status: string, t: (key: string) => string, type: RgbTransferItem['type']) {
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
      return t('rgb_status_confirming');
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
    case 'waiting_batch_release':
      return t('rgb_status_waiting_batch_release');
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

function isPending(status: string) {
  return !['settled', 'confirmed', 'rejected', 'failed', 'canceled', 'cancelled'].includes(status.toLowerCase());
}

function getTransferIcon(type: RgbTransferItem['type']): IconTypes {
  if (type === 'send') return 'history_send';
  if (type === 'receive') return 'history_receive';
  return 'history_inscribe';
}

export function RGBTransferListItem({
  item,
  assetLabel,
  showAssetLabel,
  showDate,
  showDirectionIcon,
  onClick
}: {
  item: RgbTransferItem;
  assetLabel?: string;
  showAssetLabel?: boolean;
  showDate?: boolean;
  showDirectionIcon?: boolean;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const resolvedAssetLabel = assetLabel || item.ticker || item.name || item.assetId?.slice(0, 8) || 'RGB';
  const assetSymbol = item.ticker?.trim() || item.name?.trim() || '';
  const assetName = item.name?.trim() || '';
  const status = item.status.toLowerCase();
  const pending = isPending(item.status);
  const showStatus = item.type !== 'issue' && (pending || ['canceled', 'cancelled', 'rejected'].includes(status));
  const isReceive = item.type === 'receive';
  const isCanceledReceive = isReceive && ['canceled', 'cancelled'].includes(status);
  const hideReceiveAmount = isReceive && ['validation_failed', 'rejected'].includes(status);
  const secondaryAssetLabel = assetName || (isCanceledReceive ? assetSymbol : '');
  const amountColor = isReceive || item.type === 'issue'
    ? 'rgba(124, 219, 152, 0.85)'
    : 'rgba(255, 255, 255, 0.85)';
  const sign = item.type === 'issue' ? '' : isReceive ? '+' : '-';
  const transferTime = formatTransferTime(item.timestamp);
  const date = getRgbTransferDateKey(item.timestamp);
  const displayAmount = item.amount ? toRgbDisplayAmount(item.amount, getRgbTokenPrecision(item)) : '--';
  const signedDisplayAmount = displayAmount === '--' ? displayAmount : `${sign}${displayAmount}`;

  return (
    <Column fullX gap="zero">
      {showDate && date ? (
        <Text text={date} color="textDim" size="sm" style={{ paddingTop: 12, paddingBottom: 4 }} />
      ) : null}
      <Row
        fullX
        justifyBetween
        itemsCenter
        onClick={onClick}
        style={{
          borderBottomWidth: 1,
          borderColor: colors.border2,
          paddingTop: 12,
          paddingBottom: 12,
          cursor: onClick ? 'pointer' : undefined
        }}>
        <Row itemsCenter gap="md" style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
          {showDirectionIcon ? (
            <Icon icon={getTransferIcon(item.type)} size={32} />
          ) : (
            <RGBAssetIcon
              iconInfo={getRgbTokenIconInfo(item, resolvedAssetLabel)}
              ticker={resolvedAssetLabel}
              name={getRgbAssetName(item)}
              size={32}
            />
          )}
          <Column gap="xs" style={{ minWidth: 0, overflow: 'hidden' }}>
            <Row style={{ minWidth: 0, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <Text text={item.burn ? t('rgb_burn') : getTransferTitle(item.type, t)} style={{ flexShrink: 0, lineHeight: '20px' }} />
              {item.batch ? <Text text={t('rgb_batch_transfer')} color="textDim" size="xs" /> : null}
              {showStatus ? (
                <Row
                  style={{
                    backgroundColor: pending ? 'rgba(244, 182, 44, 0.15)' : 'rgba(238, 52, 76, 0.15)',
                    borderRadius: 4,
                    minWidth: 0,
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                    minHeight: 24
                  }}
                  px="sm"
                  py="xs">
                  <Text
                    text={getStatusLabel(item.status, t, item.type)}
                    size="xs"
                    wrap
                    style={{ color: pending ? 'rgba(244, 182, 44, 0.85)' : '#EE344C', lineHeight: '16px' }}
                  />
                </Row>
              ) : null}
            </Row>
            {showAssetLabel && (secondaryAssetLabel || transferTime) ? (
              <Row itemsCenter gap="xs" style={{ minWidth: 0, overflow: 'hidden' }}>
                {secondaryAssetLabel ? (
                  <Text
                    text={secondaryAssetLabel}
                    size="sm"
                    ellipsis
                    style={{ minWidth: 0, color: 'rgba(255,255,255,0.75)' }}
                  />
                ) : null}
                {transferTime ? (
                  <Text text={secondaryAssetLabel ? `· ${transferTime}` : transferTime} preset="sub" style={{ flexShrink: 0 }} />
                ) : null}
              </Row>
            ) : transferTime ? (
              <Text text={transferTime} preset="sub" />
            ) : null}
          </Column>
        </Row>
        {!isCanceledReceive && !hideReceiveAmount ? (
          <Row gap="xs" style={{ alignItems: 'center', flexShrink: 0, maxWidth: showAssetLabel ? '58%' : undefined, marginLeft: 12, ...(showStatus ? { alignSelf: 'flex-start', marginTop: 24, minHeight: 24 } : {}) }}>
            {showAssetLabel ? (
              <div title={signedDisplayAmount} style={{ display: 'flex', alignItems: 'center', height: 20, minWidth: 0, flexShrink: 1, overflow: 'hidden' }}>
                <HistoryAmount amount={signedDisplayAmount} color={amountColor} textStyle={{ fontSize: 14, lineHeight: '20px' }} />
              </div>
            ) : (
              <HistoryAmount amount={signedDisplayAmount} color={amountColor} textStyle={{ fontSize: 14, lineHeight: '20px' }} />
            )}
            {showAssetLabel && assetSymbol ? (
              <Text
                text={assetSymbol}
                size="sm"
                ellipsis
                disableTranslate
                style={{ display: 'flex', alignItems: 'center', height: 20, flexShrink: 0, maxWidth: 64, color: amountColor, fontSize: 14, lineHeight: '20px' }}
              />
            ) : null}
          </Row>
        ) : null}
      </Row>
    </Column>
  );
}
