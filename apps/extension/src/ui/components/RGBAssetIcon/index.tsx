import { CSSProperties } from 'react';
import { useWalletConfig } from '@unisat/wallet-state';

import { Icon } from '../Icon';
import { Image } from '../Image';

export type RGBAssetIconInfo = {
  assetId?: string;
  iconShortName?: string;
  iconUrl?: string;
};

type RGBAssetIconProps = {
  assetId?: string;
  iconInfo?: RGBAssetIconInfo;
  ticker?: string;
  name?: string;
  size?: number;
  isAnyRgbAsset?: boolean;
  style?: CSSProperties;
};

const USDT_LOGO = './images/icons/protocol/usdt-logo.svg';

const assetIconStyle = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  background: 'linear-gradient(135deg, #24AF7A, #2B7DE9)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontSize: 12,
  fontWeight: 700,
  overflow: 'hidden'
};

export function getRgbAssetName(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const candidates = [record.tokenInfo, record.assetInfo, record.rgbInfo, record];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const name = (candidate as Record<string, unknown>).name;
    if (typeof name === 'string' && name.trim()) return name;
  }
  return '';
}

export function getRgbPlaceholderLetters(name?: string, ticker?: string) {
  const source = (name || ticker || 'RGB').trim();
  return Array.from(source).slice(0, 2).join('').toUpperCase() || 'RG';
}

function resolveRgbAssetIconUrl(iconInfo?: RGBAssetIconInfo, isConfiguredUsdt?: boolean) {
  if (isConfiguredUsdt) return USDT_LOGO;
  if (iconInfo?.iconUrl) return iconInfo.iconUrl;
  return '';
}

export function RGBAssetIcon({ assetId, iconInfo, ticker, name, size = 24, isAnyRgbAsset, style }: RGBAssetIconProps) {
  const configuredUsdtAssetId = useWalletConfig().rgbUsdtAssetId?.trim() || '';
  const resolvedAssetId = assetId || iconInfo?.assetId || '';
  const isConfiguredUsdt = !!configuredUsdtAssetId && !!resolvedAssetId &&
    resolvedAssetId.replace(/^rgb:/i, '') === configuredUsdtAssetId.replace(/^rgb:/i, '');
  const iconUrl = resolveRgbAssetIconUrl(iconInfo, isConfiguredUsdt);
  const showImage = !isAnyRgbAsset && !!iconUrl;
  const isUsdtLogo = iconUrl === USDT_LOGO;
  const placeholderLetters = getRgbPlaceholderLetters(name, ticker);

  return (
    <div
      style={{
        ...assetIconStyle,
        width: size,
        height: size,
        fontSize: size <= 24 ? 10 : 12,
        background: showImage ? 'transparent' : assetIconStyle.background,
        overflow: isUsdtLogo ? 'visible' : 'hidden',
        flexShrink: 0,
        ...style
      }}>
      {isAnyRgbAsset ? (
        <Icon icon="rgb" size={size} />
      ) : showImage ? (
        <Image
          src={iconUrl}
          size={size}
          style={isUsdtLogo ? undefined : { borderRadius: '50%' }}
          fallbackSrc="./images/icons/artifacts/unknown.png"
        />
      ) : (
        placeholderLetters
      )}
    </div>
  );
}
