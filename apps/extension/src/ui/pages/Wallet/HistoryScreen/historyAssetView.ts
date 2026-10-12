export { getHistoryAssetChanges, type HistoryAssetChange } from '@unisat/wallet-shared';

export function getHistoryDate(timestamp: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}
