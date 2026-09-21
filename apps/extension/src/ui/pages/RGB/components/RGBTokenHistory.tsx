import { useState } from 'react';

import { Column, InfiniteList, Text } from '@/ui/components';
import { Empty } from '@/ui/components/Empty';
import type { RgbActivityItem, RgbTransferItem } from '@unisat/wallet-state';
import { useI18n, useNavigation } from '@unisat/wallet-state';

import { RGBTransferDetailSheet } from '../RGBTransferDetailSheet';
import { getRgbTransferDateKey, RGBTransferListItem } from './RGBTransferListItem';

function toTransferItem(
  item: RgbActivityItem,
  fallbackTicker: string,
  fallbackName: string,
  fallbackPrecision?: number
): RgbTransferItem {
  const type = item.type === 'send' || item.type === 'receive' ? item.type : 'issue';
  return {
    id: item.id || item.txid,
    assetId: item.assetId,
    ticker: item.ticker || fallbackTicker,
    name: item.name || fallbackName,
    precision: item.precision ?? fallbackPrecision,
    type,
    status: item.status,
    amount: item.amount,
    txid: item.txid,
    timestamp: item.timestamp
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
  showAssetTicker?: boolean;
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
    showAssetTicker = false,
    showDirectionIcon = false
  } = props;
  const tokenName = displayName || ticker;

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
          data={activityItems}
          total={activityTotal}
          keyExtractor={(item, index) => item.id || item.txid || index.toString()}
          renderItem={({ item }) => {
            const itemIndex = activityItems.indexOf(item);
            const date = getRgbTransferDateKey(item.timestamp);
            const previousDate =
              itemIndex > 0 ? getRgbTransferDateKey(activityItems[itemIndex - 1]?.timestamp) : '';
            const transfer = toTransferItem(item, ticker, tokenName, precision);
            const assetLabel = showAssetTicker
              ? item.ticker || item.name || item.assetId?.slice(0, 8) || ticker
              : ticker;
            return (
              <RGBTransferListItem
                item={transfer}
                assetLabel={assetLabel}
                showDate={Boolean(date && date !== previousDate)}
                showDirectionIcon={showDirectionIcon}
                onClick={() => setSelectedTransfer(transfer)}
              />
            );
          }}
          onLoadMore={onLoadMoreActivity || (() => undefined)}
          onRefresh={onRefreshActivity || (() => undefined)}
          hasMore={activityHasMore}
          loading={activityLoading}
          rowGap={0}
        />
      </Column>

      {selectedTransfer ? (
        <RGBTransferDetailSheet
          transfer={selectedTransfer}
          transferId={selectedTransfer.id}
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
