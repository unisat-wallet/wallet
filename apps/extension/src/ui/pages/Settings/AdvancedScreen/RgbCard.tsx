import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

import { Column, Icon, Row, Text } from '@/ui/components';
import { fontSizes } from '@/ui/theme/font';
import { useI18n, useSupportedAssets, useWallet } from '@unisat/wallet-state';

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
  const wallet = useWallet();
  const supportedAssets = useSupportedAssets();
  const [invoiceExpiry, setInvoiceExpiry] = useState(24 * 60 * 60);

  useEffect(() => {
    wallet.getRgbInvoiceExpirySeconds().then(setInvoiceExpiry).catch(() => undefined);
  }, [wallet]);

  const invoiceExpiryLabel =
    invoiceExpiry === 0
      ? t('rgb_invoice_expiry_never')
      : invoiceExpiry === 60 * 60
      ? t('rgb_invoice_expiry_1h')
      : invoiceExpiry === 7 * 24 * 60 * 60
      ? t('rgb_invoice_expiry_7d')
      : t('rgb_invoice_expiry_24h');

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
            <Text text={t('rgb_fee_pool_title')} color="white" size="sm" />
            <Text text={t('rgb_fee_pool_description')} color="textDim" size="xs" />
          </Column>
        </Row>
        <Icon icon="right" size={fontSizes.lg} color="textDim" />
      </Row>

      <Row full itemsCenter justifyBetween style={rgbActionStyle} onClick={() => navigate('/settings/rgb-invoice-expiry')}>
        <Row gap="md" itemsCenter style={{ minWidth: 0 }}>
          <Icon icon="invoice" color="gold" size={20} />
          <Column gap="xs" style={{ minWidth: 0 }}>
            <Text text={t('rgb_default_invoice_expiry')} color="white" size="sm" />
            <Text text={t('rgb_invoice_expiry_description')} color="textDim" size="xs" />
          </Column>
        </Row>
        <Row itemsCenter gap="xs">
          <Text text={invoiceExpiryLabel} color="textDim" size="xs" />
          <Icon icon="right" size={fontSizes.lg} color="textDim" />
        </Row>
      </Row>
    </Column>
  );
}
