import type { AddressHistorySummaryItem } from '@unisat/wallet-shared';

export { getHistoryAssetChanges, type HistoryAssetChange } from '@unisat/wallet-shared';

export function getHistoryTitleKey(
  item: Pick<AddressHistorySummaryItem, 'direction' | 'operation'>,
  isReceive: boolean
) {
  if (item.operation === 'inscribe-transfer') return 'brc20_history_type_inscribe_transfer';
  if (item.direction === 'self') return 'self_transfer';
  if (item.direction === 'mixed') return 'mixed';
  return isReceive ? 'receive' : 'send';
}

export function getHistoryDate(timestamp: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}
