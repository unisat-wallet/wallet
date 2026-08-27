import { CSSProperties } from 'react';

import { Icon } from '../Icon';
import { Image } from '../Image';

export type RGBAssetIconInfo = {
  iconShortName?: string;
  iconUrl?: string;
};

type RGBAssetIconProps = {
  iconInfo?: RGBAssetIconInfo;
  ticker?: string;
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

function resolveRgbAssetIconUrl(iconInfo?: RGBAssetIconInfo, ticker?: string) {
  if (iconInfo?.iconUrl) return iconInfo.iconUrl;
  if ((ticker || '').toUpperCase() === 'USDT') return USDT_LOGO;
  return '';
}

export function RGBAssetIcon({ iconInfo, ticker, size = 24, isAnyRgbAsset, style }: RGBAssetIconProps) {
  const iconUrl = resolveRgbAssetIconUrl(iconInfo, ticker);
  const showImage = !isAnyRgbAsset && !!iconUrl;
  const isUsdtLogo = iconUrl === USDT_LOGO;

  return (
    <div
      style={{
        ...assetIconStyle,
        width: size,
        height: size,
        fontSize: size <= 24 ? 10 : 12,
        background: showImage ? 'transparent' : assetIconStyle.background,
        overflow: isUsdtLogo ? 'visible' : 'hidden',
        ...style
      }}>
      {isAnyRgbAsset ? (
        <Icon icon="rgb" size={18} />
      ) : showImage ? (
        <Image
          src={iconUrl}
          size={size}
          style={isUsdtLogo ? undefined : { borderRadius: '50%' }}
          fallbackSrc="./images/icons/artifacts/unknown.png"
        />
      ) : (
        iconInfo?.iconShortName || 'RGB'
      )}
    </div>
  );
}
