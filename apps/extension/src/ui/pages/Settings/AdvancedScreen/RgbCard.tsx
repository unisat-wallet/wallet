import { useNavigate } from 'react-router-dom';

import { Column, Icon, Row, Text } from '@/ui/components';
import { fontSizes } from '@/ui/theme/font';
import { useI18n, useSupportedAssets } from '@unisat/wallet-state';

const rgbActionStyle = {
  width: '100%',
  minHeight: 56,
  padding: '12px 16px',
  boxSizing: 'border-box' as const,
  borderRadius: 10,
  background: 'rgba(255,255,255,0.055)',
  border: '1px solid rgba(255,255,255,0.08)',
  cursor: 'pointer'
};

/** RGB operations have their own UTXO reservations and diagnostics. */
export function RgbCard() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const supportedAssets = useSupportedAssets();

  if (!supportedAssets.assets.rgb) return null;

  return (
    <Column fullX gap="md">
      <Text text={t('rgb')} color="textDim" size="xs" />

      <Row full itemsCenter justifyBetween style={rgbActionStyle} onClick={() => navigate('/settings/rgb-utxos')}>
        <Row gap="md" itemsCenter style={{ minWidth: 0 }}>
          <Icon icon="rgb" color="ticker_color2" size={20} />
          <Column gap="xs" style={{ minWidth: 0 }}>
            <Text text={t('rgb_asset_address')} color="white" size="sm" />
            <Text text={t('rgb_asset_address_description')} color="textDim" size="xs" />
          </Column>
        </Row>
        <Icon icon="right" size={fontSizes.lg} color="textDim" />
      </Row>

      <Row full itemsCenter justifyBetween style={rgbActionStyle} onClick={() => navigate('/settings/rgb-fee-pool')}>
        <Row gap="md" itemsCenter style={{ minWidth: 0 }}>
          <Icon icon="btc" color="gold" size={20} />
          <Column gap="xs" style={{ minWidth: 0 }}>
            <Text text={t('rgb_fee_address')} color="white" size="sm" />
            <Text text={t('rgb_fee_address_description')} color="textDim" size="xs" />
          </Column>
        </Row>
        <Icon icon="right" size={fontSizes.lg} color="textDim" />
      </Row>
    </Column>
  );
}
