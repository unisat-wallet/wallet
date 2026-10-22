import type { AddressHistorySummaryItem } from '@unisat/wallet-shared';

export { getHistoryAssetChanges, type HistoryAssetChange } from '@unisat/wallet-shared';

export function getHistoryTitle(
  item: Pick<AddressHistorySummaryItem, 'direction' | 'display'>,
  isReceive: boolean,
  translate: (key: string) => string
) {
  if (item.display?.title) return item.display.title;
  if (item.direction === 'self') return translate('self_transfer');
  if (item.direction === 'mixed') return translate('mixed');
  return translate(isReceive ? 'receive' : 'send');
}

export function getHistoryDate(timestamp: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}
