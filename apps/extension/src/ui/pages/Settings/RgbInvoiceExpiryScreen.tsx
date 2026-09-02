import { useEffect, useState } from 'react';

import { Card, Column, Content, Header, Icon, Layout, Loading, Row, Text } from '@/ui/components';
import { useI18n, useNavigation, useTools, useWallet } from '@unisat/wallet-state';

const options = [
  { seconds: 60 * 60, label: 'rgb_invoice_expiry_1h' },
  { seconds: 24 * 60 * 60, label: 'rgb_invoice_expiry_24h' },
  { seconds: 7 * 24 * 60 * 60, label: 'rgb_invoice_expiry_7d' },
  { seconds: 0, label: 'rgb_invoice_expiry_never' }
];

export default function RgbInvoiceExpiryScreen() {
  const wallet = useWallet();
  const nav = useNavigation();
  const tools = useTools();
  const { t } = useI18n();
  const [selected, setSelected] = useState(24 * 60 * 60);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    wallet
      .getRgbInvoiceExpirySeconds()
      .then(setSelected)
      .catch((error) => tools.toastError(error instanceof Error ? error.message : String(error)));
  }, [tools, wallet]);

  const select = async (seconds: number) => {
    if (saving || seconds === selected) return;
    setSaving(true);
    try {
      await wallet.setRgbInvoiceExpirySeconds(seconds);
      setSelected(seconds);
      tools.toastSuccess(t('success'));
      nav.goBack();
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <Header onBack={() => nav.goBack()} title={t('rgb_default_invoice_expiry')} />
      <Content>
        <Card style={{ width: '100%', borderRadius: 10, padding: 0, overflow: 'hidden' }}>
          <Column fullX gap="zero">
            {options.map((option, index) => {
              const checked = option.seconds === selected;
              return (
                <Column key={option.seconds} fullX gap="zero">
                  {index > 0 ? <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }} /> : null}
                  <Row
                    fullX
                    itemsCenter
                    justifyBetween
                    onClick={() => void select(option.seconds)}
                    style={{ minHeight: 52, padding: '0 16px', boxSizing: 'border-box' }}>
                    <Text text={t(option.label)} color={checked ? 'white' : 'textDim'} size="sm" />
                    {checked && !saving ? <Icon icon="checked" color="gold" size={20} /> : null}
                    {checked && saving ? <Loading /> : null}
                  </Row>
                </Column>
              );
            })}
          </Column>
        </Card>
      </Content>
    </Layout>
  );
}
