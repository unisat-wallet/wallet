import { useState } from 'react';

import { InfiniteList } from '@/ui/components';
import { useI18n, useNavigation, useRGBTransfersLogic, type RgbTransferItem } from '@unisat/wallet-state';

import { RGBTransferDetailSheet } from '../../RGB/RGBTransferDetailSheet';
import { getRgbTransferDateKey, RGBTransferListItem } from '../../RGB/components/RGBTransferListItem';

type RGBTransfersListProps = {
  transfers: ReturnType<typeof useRGBTransfersLogic>;
};

function getTransferId(transfer: RgbTransferItem) {
  return transfer.transferId || transfer.id;
}

export function RGBTransfersList({ transfers }: RGBTransfersListProps) {
  const { t } = useI18n();
  const nav = useNavigation();
  const { items, total, loading, hasMore, onRefresh, onLoadMore } = transfers;
  const [selectedTransfer, setSelectedTransfer] = useState<RgbTransferItem | undefined>();
  const [acceptedTransferIds, setAcceptedTransferIds] = useState<Set<string>>(() => new Set());

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
          const displayItem: RgbTransferItem =
            acceptedTransferIds.has(getTransferId(item)) &&
            item.type === 'receive' &&
            item.status.toLowerCase() === 'pending_accept'
              ? { ...item, status: 'waiting_receive' }
              : item;
          const itemIndex = items.indexOf(item);
          const date = getRgbTransferDateKey(item.timestamp);
          const previousDate = itemIndex > 0 ? getRgbTransferDateKey(items[itemIndex - 1]?.timestamp) : '';
          const showDate = Boolean(date && date !== previousDate);
          return (
            <RGBTransferListItem
              item={displayItem}
              showDate={showDate}
              onClick={() => setSelectedTransfer(displayItem)}
            />
          );
        }}
      />

      {selectedTransfer ? (
        <RGBTransferDetailSheet
          transfer={selectedTransfer}
          transferId={selectedTransfer.transferId || selectedTransfer.id}
          onClose={() => setSelectedTransfer(undefined)}
          onAccepted={() => {
            const transferId = getTransferId(selectedTransfer);
            setAcceptedTransferIds((current) => new Set(current).add(transferId));
          }}
          onCanceled={() => void transfers.onRefresh({ showLoading: false })}
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
