import { Column, Icon, Row, Text } from '@/ui/components';
import { colors } from '@/ui/theme/colors';
import { useI18n } from '@unisat/wallet-state';

export interface AssetCardProps {
  type: 'Inscription' | 'BRC20' | 'Alkanes' | 'Runes' | 'CAT20' | 'CAT721';
  count: number;
  title?: string;
  subtitle?: string;
  size?: 'small' | 'medium' | 'large';
  onClick?: () => void;
}

type AssetType = AssetCardProps['type'];

const ASSET_TYPE_CONFIG: Record<AssetType, { title: string; color: string }> = {
  Inscription: { title: 'inscription', color: 'rgba(61, 185, 59, 0.1)' },
  BRC20: { title: 'brc20', color: 'rgba(244, 182, 44, 0.1)' },
  Alkanes: { title: 'alkanes', color: 'rgba(62, 126, 224, 0.1)' },
  Runes: { title: 'runes', color: 'rgba(243, 145, 100, 0.1)' },
  CAT20: { title: 'cat20', color: 'rgba(255, 0, 0, 0.05)' },
  CAT721: { title: 'cat721', color: 'rgba(255, 0, 0, 0.05)' }
};

export default function AssetCard({ type, count, onClick }: AssetCardProps) {
  const { title, color } = ASSET_TYPE_CONFIG[type];
  const { t } = useI18n();

  return (
    <Column
      itemsCenter
      justifyCenter
      gap="sm"
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: color,
        minHeight: 75,
        width: 160,
        borderRadius: 12
      }}
      onClick={onClick}>
      <Text text={t(title)} preset="regular" />

      <Row justifyCenter itemsCenter>
        <Text text={count.toString()} color={'white'} />
        <Icon icon="right" size={12} color="white" />
      </Row>
    </Column>
  );
}
