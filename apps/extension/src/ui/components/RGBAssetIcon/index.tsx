import { CSSProperties } from 'react';

import { Icon } from '../Icon';
import { Image } from '../Image';

export type RGBAssetIconInfo = {
  iconShortName?: string;
  iconUrl?: string;
};

type RGBAssetIconProps = {
  iconInfo?: RGBAssetIconInfo;
  size?: number;
  isAnyRgbAsset?: boolean;
  style?: CSSProperties;
};

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

export function RGBAssetIcon({ iconInfo, size = 24, isAnyRgbAsset, style }: RGBAssetIconProps) {
  return (
    <div
      style={{
        ...assetIconStyle,
        width: size,
        height: size,
        fontSize: size <= 24 ? 10 : 12,
        ...style
      }}
    >
      {isAnyRgbAsset ? (
        <Icon icon="rgb" size={18} />
      ) : iconInfo?.iconUrl ? (
        <Image
          src={iconInfo.iconUrl}
          size={size}
          style={{ borderRadius: '50%' }}
          fallbackSrc="./images/icons/artifacts/unknown.png"
        />
      ) : (
        iconInfo?.iconShortName || 'RGB'
      )}
    </div>
  );
}
