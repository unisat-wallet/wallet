import { useEffect, useState } from 'react';

import { Column, Icon, InfiniteList, Row, Text } from '@/ui/components';
import type { IconTypes } from '@/ui/components/Icon';
import { colors } from '@/ui/theme/colors';
import { shortAddress } from '@/ui/utils';
import {
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

function getTransferIcon(type: RgbTransferItem['type']): IconTypes {
  if (type === 'send') return 'history_send';
  if (type === 'receive') return 'history_receive';
  return 'history_inscribe';
}

function getTransferAssetLabel(item?: RgbTransferItem) {
  return item?.ticker || item?.name || 'RGB';
}

function formatTime(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp > 1000000000000 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function getCounterpartyLine(item: RgbTransferItem, t: (key: string) => string) {
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
          const pending = isPending(item.status);
          return (
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
              <Row itemsCenter>
                <Icon icon={getTransferIcon(item.type)} size={32} />
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
                  <Text text={getCounterpartyLine(item, t)} preset="sub" />
                  {formatTime(item.timestamp) ? (
                    <Text
                      text={formatTime(item.timestamp)}
                      size="xs"
                      color="textDim"
                      style={{ fontSize: 11 }}
                    />
                  ) : null}
                </Column>
              </Row>
              <Column itemsEnd gap="zero">
                <Text
                  text={[
                    item.amount ? toRgbDisplayAmount(item.amount, getRgbTokenPrecision(item)) : '--',
                    getTransferAssetLabel(item)
                  ].join(' ')}
                />
              </Column>
            </Row>
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
