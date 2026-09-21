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

function getTransferId(transfer: RgbTransferItem) {
  return transfer.transferId || transfer.id;
}

function isPendingReceive(transfer: RgbTransferItem) {
  return transfer.type === 'receive' && transfer.status.toLowerCase() === 'pending_accept';
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
      (item) => isPendingReceive(item) && !dismissedTransferIds.has(getTransferId(item))
    );
    if (transfer) setSelectedTransfer(transfer);
  }, [dismissedTransferIds, items, selectedTransfer]);

  const closeTransferDetail = () => {
    if (selectedTransfer && isPendingReceive(selectedTransfer)) {
      const transferId = getTransferId(selectedTransfer);
      setDismissedTransferIds((current) => new Set(current).add(transferId));
    }
    setSelectedTransfer(undefined);
  };

  const advanceToNextPendingReceive = () => {
    const handledTransferId = selectedTransfer ? getTransferId(selectedTransfer) : '';
    const excludedIds = new Set(dismissedTransferIds);
    if (handledTransferId) excludedIds.add(handledTransferId);
    setDismissedTransferIds(excludedIds);

    // Use the current list immediately so the next invoice opens without
    // waiting for the refresh triggered below. The effect remains as a
    // fallback when the next invoice arrives in the refreshed first page.
    const nextTransfer = items.find(
      (item) => isPendingReceive(item) && !excludedIds.has(getTransferId(item))
    );
    setSelectedTransfer(nextTransfer);
    void transfers.onRefresh({ showLoading: false });
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
          onCanceled={advanceToNextPendingReceive}
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
