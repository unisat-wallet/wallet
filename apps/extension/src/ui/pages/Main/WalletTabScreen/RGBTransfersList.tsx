import { useState } from 'react';

import { InfiniteList } from '@/ui/components';
import { useI18n, useNavigation, useRGBTransfersLogic, type RgbTransferItem } from '@unisat/wallet-state';

import { RGBTransferDetailSheet } from '../../RGB/RGBTransferDetailSheet';
import { getRgbTransferDateKey, RGBTransferListItem } from '../../RGB/components/RGBTransferListItem';

type RGBTransfersListProps = {
  transfers: ReturnType<typeof useRGBTransfersLogic>;
};

const RGB_TRANSFERS_PAGE_SIZE = 10;

function getTransferId(transfer: RgbTransferItem) {
  return transfer.transferId || transfer.id;
}

export function RGBTransfersList({ transfers }: RGBTransfersListProps) {
  const { t } = useI18n();
  const nav = useNavigation();
  const { items, total, loading, hasMore, onRefresh, onLoadMore } = transfers;
  const [selectedTransfer, setSelectedTransfer] = useState<RgbTransferItem | undefined>();
  const [acceptedTransferIds, setAcceptedTransferIds] = useState<Set<string>>(() => new Set());
  const latestSelectedTransfer = selectedTransfer
    ? items.find((item) => getTransferId(item) === getTransferId(selectedTransfer)) || selectedTransfer
    : undefined;

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
        pageSize={RGB_TRANSFERS_PAGE_SIZE}
        preservePageOnTotalChange
        renderItem={({ item }) => {
          const displayItem: RgbTransferItem =
            acceptedTransferIds.has(getTransferId(item)) &&
            item.type === 'receive' &&
            item.status.toLowerCase() === 'pending_accept'
              ? { ...item, status: 'waiting_receive' }
              : item;
          const itemIndex = items.indexOf(item);
          const date = getRgbTransferDateKey(item.timestamp);
          const previousDate = itemIndex > 0 ? getRgbTransferDateKey(items[itemIndex - 1]?.timestamp) : '';
          const showDate = Boolean(date && (itemIndex % RGB_TRANSFERS_PAGE_SIZE === 0 || date !== previousDate));
          return (
            <RGBTransferListItem
              item={displayItem}
              showAssetLabel
              showDate={showDate}
              showDirectionIcon
              onClick={() => setSelectedTransfer(displayItem)}
            />
          );
        }}
      />

      {latestSelectedTransfer ? (
        <RGBTransferDetailSheet
          transfer={latestSelectedTransfer}
          transferId={latestSelectedTransfer.transferId || latestSelectedTransfer.id}
          onClose={() => setSelectedTransfer(undefined)}
          onAccepted={() => {
            const transferId = getTransferId(latestSelectedTransfer);
            setAcceptedTransferIds((current) => new Set(current).add(transferId));
          }}
          onCanceled={() => void transfers.onRefresh({ showLoading: false })}
          onClickExploreTx={
            latestSelectedTransfer.txid
              ? () => {
                  if (latestSelectedTransfer.txid) nav.navToExplorerTx(latestSelectedTransfer.txid);
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}
