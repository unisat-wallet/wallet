import { useMemo, useState } from 'react';

import { Column, InfiniteList, Text } from '@/ui/components';
import { Empty } from '@/ui/components/Empty';
import type { RgbActivityItem, RgbTransferItem } from '@unisat/wallet-state';
import { useI18n, useNavigation } from '@unisat/wallet-state';

import { RGBTransferDetailSheet } from '../RGBTransferDetailSheet';
import { getRgbTransferDateKey, RGBTransferListItem } from './RGBTransferListItem';

function getActivityTimestamp(item?: RgbActivityItem) {
  if (!item) return 0;
  const createdAt = (item as RgbActivityItem & { createdAt?: number }).createdAt;
  return item.timestamp || createdAt || 0;
}

function getActivityTimestampMs(item?: RgbActivityItem) {
  const timestamp = getActivityTimestamp(item);
  return timestamp > 0 && timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function toTransferItem(
  item: RgbActivityItem,
  fallbackTicker: string,
  fallbackName: string,
  fallbackPrecision?: number
): RgbTransferItem {
  const type = item.type === 'send' || item.type === 'receive' ? item.type : 'issue';
  return {
    id: item.id || item.txid,
    transferId: item.transferId,
    local: item.local,
    burn: item.burn,
    assetId: item.assetId,
    ticker: item.ticker || fallbackTicker,
    name: item.name || fallbackName,
    precision: item.precision ?? fallbackPrecision,
    type,
    status: item.status,
    rejectionReason: item.rejectionReason,
    canReject: item.canReject,
    amount: item.amount,
    lockedAmount: item.lockedAmount,
    txid: item.txid,
    timestamp: getActivityTimestamp(item)
  };
}

export function RGBTokenHistory(props: {
  ticker: string;
  displayName?: string;
  precision?: number;
  activityItems?: RgbActivityItem[];
  activityTotal?: number;
  activityLoading?: boolean;
  activityHasMore?: boolean;
  onLoadMoreActivity?: () => void;
  onRefreshActivity?: () => void;
  showDirectionIcon?: boolean;
}) {
  const { t } = useI18n();
  const nav = useNavigation();
  const [selectedTransfer, setSelectedTransfer] = useState<RgbTransferItem>();
  const {
    ticker,
    displayName,
    precision,
    activityItems = [],
    activityTotal = activityItems.length,
    activityLoading = false,
    activityHasMore = false,
    onLoadMoreActivity,
    onRefreshActivity,
    showDirectionIcon = false
  } = props;
  const tokenName = displayName || ticker;
  const sortedActivityItems = useMemo(
    () => [...activityItems].sort((left, right) => getActivityTimestampMs(right) - getActivityTimestampMs(left)),
    [activityItems]
  );

  if (activityLoading && activityItems.length === 0) {
    return (
      <Column style={{ minHeight: 150 }} itemsCenter justifyCenter>
        <Text text={t('loading')} preset="sub" />
      </Column>
    );
  }

  if (!activityLoading && activityItems.length === 0) {
    return (
      <Column fullX itemsCenter style={{ paddingTop: 24 }}>
        <Empty text={t('empty')} preset="assets" />
      </Column>
    );
  }

  return (
    <>
      <Column fullX>
        <InfiniteList
          data={sortedActivityItems}
          total={activityTotal}
          keyExtractor={(item, index) => item.id || item.txid || index.toString()}
          renderItem={({ item }) => {
            const itemIndex = sortedActivityItems.indexOf(item);
            const date = getRgbTransferDateKey(getActivityTimestamp(item));
            const previousDate =
              itemIndex > 0
                ? getRgbTransferDateKey(getActivityTimestamp(sortedActivityItems[itemIndex - 1]))
                : '';
            const transfer = toTransferItem(item, ticker, tokenName, precision);
            return (
              <RGBTransferListItem
                item={transfer}
                assetLabel={ticker}
                showDate={Boolean(date && date !== previousDate)}
                showDirectionIcon={showDirectionIcon}
                onClick={() => {
                  if (transfer.burn) {
                    nav.navigate('RGBTransferDetailScreen', {
                      transferId: transfer.transferId || transfer.id,
                      initialTransfer: transfer
                    });
                  } else setSelectedTransfer(transfer);
                }}
              />
            );
          }}
          onLoadMore={onLoadMoreActivity || (() => undefined)}
          onRefresh={onRefreshActivity || (() => undefined)}
          hasMore={activityHasMore}
          loading={activityLoading}
          rowGap={0}
          pageSize={10}
          preservePageOnTotalChange
        />
      </Column>

      {selectedTransfer ? (
        <RGBTransferDetailSheet
          transfer={selectedTransfer}
          transferId={selectedTransfer.transferId || selectedTransfer.id}
          onClose={() => setSelectedTransfer(undefined)}
          onCanceled={() => onRefreshActivity?.()}
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
