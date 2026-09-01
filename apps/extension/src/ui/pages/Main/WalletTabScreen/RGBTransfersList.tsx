import { useEffect, useState } from 'react';

import { Column, InfiniteList, Row, Text, RGBAssetIcon } from '@/ui/components';
import { getRgbAssetName } from '@/ui/components/RGBAssetIcon';
import { colors } from '@/ui/theme/colors';
import { shortAddress } from '@/ui/utils';
import {
  getRgbTokenIconInfo,
  getRgbTokenPrecision,
  toRgbDisplayAmount,
  useI18n,
  useNavigation,
  useRGBTransfersLogic,
  type RgbTransferItem
} from '@unisat/wallet-state';

import { RGBTransferDetailSheet } from '../../RGB/RGBTransferDetailSheet';

type RGBTransfersListProps = {
  transfers: ReturnType<typeof useRGBTransfersLogic>;
};

function getTransferAssetLabel(item?: RgbTransferItem) {
  return item?.name || item?.ticker || 'RGB';
}

function formatTime(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp > 1000000000000 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function transferDateKey(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp > 1000000000000 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function getCounterpartyLine(item: RgbTransferItem, t: (key: string) => string) {
  if (
    item.type === 'receive' &&
    ['canceled', 'cancelled'].includes(item.status.toLowerCase())
  ) {
    return '';
  }
  if (item.type === 'receive') {
    const address = item.from?.trim();
    return `${t('from')} ${address ? shortAddress(address) : '--'}`;
  }
  if (item.type === 'send') {
    const address = item.to?.trim();
    return `${t('to')} ${address ? shortAddress(address) : '--'}`;
  }
  return formatTime(item.timestamp) || shortAddress(item.txid || '', 10) || '--';
}

function getTransferTitle(type: RgbTransferItem['type'], t: (key: string) => string) {
  if (type === 'send') return t('send');
  if (type === 'receive') return t('receive');
  return t('issue');
}

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

function isPending(status: string) {
  return !['settled', 'confirmed', 'rejected', 'failed', 'canceled', 'cancelled'].includes(status.toLowerCase());
}

export function RGBTransfersList({ transfers }: RGBTransfersListProps) {
  const { t } = useI18n();
  const nav = useNavigation();
  const { items, total, loading, hasMore, onRefresh, onLoadMore } = transfers;
  const [selectedTransfer, setSelectedTransfer] = useState<RgbTransferItem | undefined>();
  const [dismissedTransferIds, setDismissedTransferIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (selectedTransfer) return;
    const transfer = items.find(
      (item) =>
        item.type === 'receive' &&
        item.status.toLowerCase() === 'pending_accept' &&
        !dismissedTransferIds.has(item.transferId || item.id)
    );
    if (transfer) setSelectedTransfer(transfer);
  }, [dismissedTransferIds, items, selectedTransfer]);

  const closeTransferDetail = () => {
    if (selectedTransfer?.status.toLowerCase() === 'pending_accept') {
      const transferId = selectedTransfer.transferId || selectedTransfer.id;
      setDismissedTransferIds((current) => new Set(current).add(transferId));
    }
    setSelectedTransfer(undefined);
  };

  return (
    <>
      <InfiniteList
        data={items}
        total={total}
        keyExtractor={(item) => item.id}
        hasMore={hasMore}
        loading={loading}
        onRefresh={onRefresh}
        onLoadMore={onLoadMore}
        emptyText={t('empty')}
        emptyPreset="assets"
        rowGap={0}
        renderItem={({ item }) => {
          const itemIndex = items.indexOf(item);
          const date = transferDateKey(item.timestamp);
          const previousDate = itemIndex > 0 ? transferDateKey(items[itemIndex - 1]?.timestamp) : '';
          const showDate = Boolean(date && date !== previousDate);
          const pending = isPending(item.status);
          const assetLabel = getTransferAssetLabel(item);
          const isReceive = item.type === 'receive';
          const isCanceledReceive =
            isReceive && ['canceled', 'cancelled'].includes(item.status.toLowerCase());
          const amountColor = isReceive ? 'rgba(124, 219, 152, 0.85)' : 'rgba(255, 255, 255, 0.85)';
          const sign = item.type === 'issue' ? '' : isReceive ? '+' : '-';
          const counterpartyLine = getCounterpartyLine(item, t);
          return (
            <Column fullX gap="zero">
              {showDate ? <Text text={date} color="textDim" size="sm" style={{ paddingTop: 12, paddingBottom: 4 }} /> : null}
              <Row
                fullX
                justifyBetween
                itemsCenter
                onClick={() => setSelectedTransfer(item)}
                style={{
                  borderBottomWidth: 1,
                  borderColor: colors.border2,
                  paddingTop: 12,
                  paddingBottom: 12
                }}>
                <Row itemsCenter gap="md">
                  <RGBAssetIcon
                    iconInfo={getRgbTokenIconInfo(item, assetLabel)}
                    ticker={assetLabel}
                    name={getRgbAssetName(item)}
                    size={32}
                  />
                  <Column gap="xs">
                    <Row itemsCenter>
                      <Text text={getTransferTitle(item.type, t)} />
                      {pending || ['canceled', 'cancelled', 'rejected'].includes(item.status.toLowerCase()) ? (
                        <Row
                          style={{
                            backgroundColor: pending ? 'rgba(244, 182, 44, 0.15)' : 'rgba(238, 52, 76, 0.15)',
                            borderRadius: 4
                          }}
                          px="sm"
                          py="xs">
                          <Text
                            text={getStatusLabel(item.status, t, item.type)}
                            size="xs"
                            style={{
                              color: pending ? 'rgba(244, 182, 44, 0.85)' : '#EE344C'
                            }}
                          />
                        </Row>
                      ) : null}
                    </Row>
                    {counterpartyLine ? <Text text={counterpartyLine} preset="sub" /> : null}
                  </Column>
                </Row>
                {!isCanceledReceive ? (
                  <Column itemsEnd gap="zero">
                    <Row gap="sm" itemsCenter justifyEnd>
                      {sign ? <Text text={sign} style={{ fontSize: 14, lineHeight: '20px', color: amountColor }} /> : null}
                      <Text
                        text={item.amount ? toRgbDisplayAmount(item.amount, getRgbTokenPrecision(item)) : '--'}
                        style={{ fontSize: 14, lineHeight: '20px', color: amountColor }}
                      />
                      <Text text={assetLabel} style={{ fontSize: 14, lineHeight: '20px', color: amountColor }} />
                    </Row>
                  </Column>
                ) : null}
              </Row>
            </Column>
          );
        }}
      />

      {selectedTransfer ? (
        <RGBTransferDetailSheet
          transfer={selectedTransfer}
          transferId={selectedTransfer.transferId || selectedTransfer.id}
          onClose={closeTransferDetail}
          onCanceled={() => {
            void transfers.onRefresh();
          }}
          onClickExploreTx={
            selectedTransfer.txid
              ? () => {
                  if (selectedTransfer.txid) nav.navToExplorerTx(selectedTransfer.txid);
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}
