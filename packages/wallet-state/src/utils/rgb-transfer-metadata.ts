import type { RgbAssetDetail, RgbTransferItem } from '../types'

/** Merge authoritative asset metadata into a transfer record. */
export function mergeRgbTransferAssetMetadata(
  transfer: RgbTransferItem,
  detail?: Pick<RgbAssetDetail, 'assetId' | 'name' | 'ticker' | 'precision'>
): RgbTransferItem {
  if (!detail) return transfer

  return {
    ...transfer,
    ...(detail.assetId ? { assetId: detail.assetId } : {}),
    ...(detail.name ? { name: detail.name } : {}),
    ...(detail.ticker ? { ticker: detail.ticker } : {}),
    ...(detail.precision === undefined ? {} : { precision: detail.precision }),
  }
}
