import type { RgbAssetPolicy, WalletConfig } from '@unisat/wallet-shared'

export function isSameRgbAssetId(left?: string, right?: string) {
  const normalize = (value?: string) => value?.trim().replace(/^rgb:/i, '')
  return !!left && !!right && normalize(left) === normalize(right)
}

export function getRgbAssetPolicies(
  config?: Pick<WalletConfig, 'rgbAssetPolicies' | 'rgbUsdtAssetId'>
): RgbAssetPolicy[] {
  let policies = (config?.rgbAssetPolicies || [])
    .filter(policy => policy && typeof policy.assetId === 'string' && policy.assetId.trim())
    .map(policy => ({ ...policy, assetId: policy.assetId.trim() }))
  const configuredUsdtAssetId = config?.rgbUsdtAssetId?.trim()
  if (configuredUsdtAssetId && configuredUsdtAssetId !== '-') {
    policies = policies.map(policy => isSameRgbAssetId(policy.assetId, configuredUsdtAssetId)
      ? {
          displayName: 'USDT',
          ticker: 'USDT',
          official: true,
          status: 'active' as const,
          showWhenZero: true,
          sortOrder: 100,
          ...policy,
        }
      : policy)
  }
  if (
    configuredUsdtAssetId &&
    configuredUsdtAssetId !== '-' &&
    !policies.some(policy => isSameRgbAssetId(policy.assetId, configuredUsdtAssetId))
  ) {
    policies.push({
      assetId: configuredUsdtAssetId,
      displayName: 'USDT',
      ticker: 'USDT',
      official: true,
      status: 'active',
      showWhenZero: true,
      sortOrder: 100,
    })
  }
  return policies
}

export function findRgbAssetPolicy(
  assetId?: string,
  config?: Pick<WalletConfig, 'rgbAssetPolicies' | 'rgbUsdtAssetId'>
) {
  return getRgbAssetPolicies(config).find(policy => isSameRgbAssetId(policy.assetId, assetId))
}

export function normalizeConfiguredRgbAsset<
  T extends {
    assetId?: string
    name?: string
    ticker?: string
    tokenInfo?: unknown
    assetInfo?: unknown
    rgbInfo?: unknown
  },
>(asset: T, config?: Pick<WalletConfig, 'rgbAssetPolicies' | 'rgbUsdtAssetId'>): T {
  const policy = findRgbAssetPolicy(asset.assetId, config)
  if (!policy) return asset

  const normalized = {
    ...asset,
    ...(policy.displayName ? { name: policy.displayName } : {}),
    ...(policy.ticker ? { ticker: policy.ticker } : {}),
    ...(isSameRgbAssetId(asset.assetId, config?.rgbUsdtAssetId)
      ? { configuredUsdt: true }
      : {}),
    rgbAssetPolicyStatus: policy.status || 'active',
    rgbAssetPolicyOfficial: policy.official === true,
    ...(policy.notice ? { rgbAssetPolicyNotice: policy.notice } : {}),
  } as T & Record<'tokenInfo' | 'assetInfo' | 'rgbInfo', unknown>
  for (const key of ['tokenInfo', 'assetInfo', 'rgbInfo'] as const) {
    const metadata = normalized[key]
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      normalized[key] = {
        ...(metadata as Record<string, unknown>),
        ...(policy.displayName ? { name: policy.displayName } : {}),
        ...(policy.ticker ? { ticker: policy.ticker } : {}),
      }
    }
  }
  return normalized
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
