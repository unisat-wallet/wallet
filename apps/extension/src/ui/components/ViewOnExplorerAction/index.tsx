import type { CSSProperties } from 'react';

import type { Gap } from '@/ui/theme/spacing';
import { useI18n } from '@unisat/wallet-state';

import { Icon } from '../Icon';
import { Row } from '../Row';
import { Text } from '../Text';

export function ViewOnExplorerAction({
  onClick,
  mt,
  style
}: {
  onClick: (e?: any) => void;
  mt?: Gap;
  style?: CSSProperties;
}) {
  const { t } = useI18n();

  return (
    <Row
      justifyCenter
      itemsCenter
      clickable
      onClick={onClick}
      mt={mt}
      style={{
        minHeight: 40,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.05)',
        gap: 10,
        ...style
      }}>
      <Text text={t('view_on_uniscan')} size="sm" style={{ color: 'rgba(255,255,255,0.65)' }} />
      <Icon icon="right" size={12} color="textDim" />
    </Row>
  );
}
