export function isSameRgbAssetId(left?: string, right?: string) {
  const normalize = (value?: string) => value?.trim().replace(/^rgb:/i, '')
  return !!left && !!right && normalize(left) === normalize(right)
}

export function normalizeConfiguredRgbUsdt<
  T extends {
    assetId?: string
    name?: string
    ticker?: string
    tokenInfo?: unknown
    assetInfo?: unknown
    rgbInfo?: unknown
  },
>(asset: T, configuredAssetId?: string): T {
  if (!isSameRgbAssetId(asset.assetId, configuredAssetId) || configuredAssetId?.trim() === '-') {
    return asset
  }

  const normalized = { ...asset, name: 'USDT', ticker: 'USDT' } as T &
    Record<'tokenInfo' | 'assetInfo' | 'rgbInfo', unknown>
  for (const key of ['tokenInfo', 'assetInfo', 'rgbInfo'] as const) {
    const metadata = normalized[key]
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      normalized[key] = {
        ...(metadata as Record<string, unknown>),
        name: 'USDT',
        ticker: 'USDT',
      }
    }
  }
  return normalized
}
