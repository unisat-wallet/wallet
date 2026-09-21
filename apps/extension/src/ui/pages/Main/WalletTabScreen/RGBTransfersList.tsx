import { useEffect, useState } from 'react';

import { InfiniteList } from '@/ui/components';
import {
  useI18n,
  useNavigation,
  useRGBTransfersLogic,
  type RgbTransferItem
} from '@unisat/wallet-state';

import { RGBTransferDetailSheet } from '../../RGB/RGBTransferDetailSheet';
import {
  getRgbTransferDateKey,
  RGBTransferListItem
} from '../../RGB/components/RGBTransferListItem';

type RGBTransfersListProps = {
  transfers: ReturnType<typeof useRGBTransfersLogic>;
};

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
          const date = getRgbTransferDateKey(item.timestamp);
          const previousDate = itemIndex > 0 ? getRgbTransferDateKey(items[itemIndex - 1]?.timestamp) : '';
          const showDate = Boolean(date && date !== previousDate);
          return (
            <RGBTransferListItem item={item} showDate={showDate} onClick={() => setSelectedTransfer(item)} />
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
