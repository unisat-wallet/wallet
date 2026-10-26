export function isSameRgbAssetId(left?: string, right?: string) {
  const normalize = (value?: string) => value?.trim().replace(/^rgb:/i, '')
  return !!left && !!right && normalize(left) === normalize(right)
}

export function normalizeConfiguredRgbUsdt<
  T extends { assetId?: string; name?: string; ticker?: string },
>(asset: T, configuredAssetId?: string): T {
  if (!isSameRgbAssetId(asset.assetId, configuredAssetId) || configuredAssetId?.trim() === '-') {
    return asset
  }
  return { ...asset, name: 'USDT', ticker: 'USDT' }
}
