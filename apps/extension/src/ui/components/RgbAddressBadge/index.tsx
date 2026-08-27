import { CSSProperties } from 'react';

import { useI18n } from '@unisat/wallet-state';

import { Text } from '../Text';

const rgbAddressBadgeStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 18,
  padding: '2px 4px',
  borderRadius: 4,
  backgroundColor: 'rgba(37,160,121,0.15)',
  boxSizing: 'border-box',
  flexShrink: 0
};

export function RgbAddressBadge() {
  const { t } = useI18n();

  return (
    <div style={rgbAddressBadgeStyle}>
      <Text text={t('rgb')} style={{ color: '#25a079', fontSize: 12, fontWeight: 500, lineHeight: 'normal' }} />
    </div>
  );
}
