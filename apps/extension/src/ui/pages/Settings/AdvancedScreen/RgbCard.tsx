import { useNavigate } from 'react-router-dom';

import { Card, Column, Icon, Row, Text } from '@/ui/components';
import { fontSizes } from '@/ui/theme/font';
import { useI18n, useSupportedAssets } from '@unisat/wallet-state';

const rgbHeaderIconStyle = {
  width: 36,
  height: 36,
  minWidth: 36,
  borderRadius: 10,
  background: 'rgba(244,182,44,0.16)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

const rgbActionStyle = {
  width: '100%',
  minHeight: 56,
  padding: '10px 12px',
  boxSizing: 'border-box' as const,
  borderRadius: 10,
  background: 'rgba(255,255,255,0.055)',
  border: '1px solid rgba(255,255,255,0.08)',
  cursor: 'pointer'
};

const rgbActionIconStyle = {
  width: 32,
  height: 32,
  minWidth: 32,
  borderRadius: 8,
  background: 'rgba(255,255,255,0.09)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

/** RGB operations have their own UTXO reservations and diagnostics. */
export function RgbCard() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const supportedAssets = useSupportedAssets();

  if (!supportedAssets.assets.rgb) return null;

  return (
    <Card style={{ borderRadius: 12, padding: 16 }}>
      <Column fullX gap="md">
        <Row gap="md" itemsCenter>
          <div style={rgbHeaderIconStyle}>
            <Icon icon="rgb" color="gold" size={20} />
          </div>
          <Text text={t('rgb_advanced')} color="white" preset="bold" size="sm" />
        </Row>

        <Row full itemsCenter justifyBetween style={rgbActionStyle} onClick={() => navigate('/settings/rgb-utxos')}>
          <Row gap="md" itemsCenter style={{ minWidth: 0 }}>
            <div style={rgbActionIconStyle}>
              <Icon icon="utxo" color="white_muted" size={18} />
            </div>
            <Column gap="xs" style={{ minWidth: 0 }}>
              <Text text={t('rgb_utxo_status')} color="white" size="sm" />
              <Text text={t('rgb_advanced_desc')} color="textDim" size="xs" />
            </Column>
          </Row>
          <Icon icon="right" size={fontSizes.lg} color="textDim" />
        </Row>

        <Row full itemsCenter justifyBetween style={rgbActionStyle} onClick={() => navigate('/settings/rgb-fee-pool')}>
          <Row gap="md" itemsCenter style={{ minWidth: 0 }}>
            <div style={rgbActionIconStyle}>
              <Icon icon="btc" color="white_muted" size={18} />
            </div>
            <Column gap="xs" style={{ minWidth: 0 }}>
              <Text text={t('rgb_fee_pool_title')} color="white" size="sm" />
              <Text text={t('rgb_fee_pool_reusable_funds')} color="textDim" size="xs" />
            </Column>
          </Row>
          <Icon icon="right" size={fontSizes.lg} color="textDim" />
        </Row>
      </Column>
    </Card>
  );
}
