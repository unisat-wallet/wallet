import BigNumber from 'bignumber.js';

export function isConfiguredRgbUsdt(assetId: string, configuredAssetId?: string) {
  const normalize = (value: string) => value.trim().replace(/^rgb:/i, '');
  const configured = normalize(configuredAssetId || '');
  return !!configured && configured !== '-' && !!assetId && normalize(assetId) === configured;
}

export function isOfficialRgbUsdt(
  assetId: string,
  configuredAssetId?: string,
  policy?: { official?: boolean; ticker?: string; displayName?: string }
) {
  if (isConfiguredRgbUsdt(assetId, configuredAssetId)) return true;
  if (policy?.official !== true) return false;
  return [policy.ticker, policy.displayName].some((value) => value?.trim().toUpperCase() === 'USDT');
}

export function formatRgbUsdtValue(amount: string) {
  const value = new BigNumber(amount);
  if (!value.isFinite() || value.isNegative()) return '$-';
  if (value.isGreaterThan(0) && value.isLessThan(0.01)) return '$<0.01';
  return `$${value.toFixed(2)}`;
}
