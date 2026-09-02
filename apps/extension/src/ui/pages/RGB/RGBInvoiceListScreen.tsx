import { useCallback, useEffect, useState } from 'react';

import { Column, Content, Header, Icon, Layout, Row, Text } from '@/ui/components';
import {
  formatRgbPendingTime,
  isRgbPendingInvoiceAwaitingAcceptance,
  isRgbPendingInvoiceAwaitingConfirmation,
  type RgbPendingReceiveInvoice,
  useI18n,
  useNavigation,
  useTools,
  useWallet
} from '@unisat/wallet-state';

const invoiceCardStyle = {
  minHeight: 72,
  padding: '12px',
  borderRadius: 8,
  boxSizing: 'border-box' as const,
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.12)'
};

export default function RGBInvoiceListScreen() {
  const wallet = useWallet();
  const nav = useNavigation();
  const tools = useTools();
  const { t } = useI18n();
  const { assetId } = nav.getRouteState<'RGBInvoiceListScreen'>();
  const [invoices, setInvoices] = useState<RgbPendingReceiveInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const result = await wallet.getRgbPendingReceiveInvoices();
      const list = (result.list || []).filter(item => item.invoice && (!assetId || !item.assetId || item.assetId === assetId));
      setInvoices(list as RgbPendingReceiveInvoice[]);
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [assetId, tools, wallet]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  return (
    <Layout>
      <Header onBack={() => nav.goBack()} title={t('pending_invoices')} />
      <Content>
        {invoices.map((invoice, index) => {
          const awaitingAcceptance = isRgbPendingInvoiceAwaitingAcceptance(invoice);
          const awaitingConfirmation = isRgbPendingInvoiceAwaitingConfirmation(invoice);
          const timeText = formatRgbPendingTime(invoice.createdAt || invoice.expirationTimestamp);
          return (
            <Row
              key={invoice.recipientId || invoice.invoice || String(index)}
              itemsCenter
              justifyBetween
              gap="md"
              style={invoiceCardStyle}
              onClick={() => {
                if (awaitingAcceptance && invoice.recipientId) {
                  nav.navigate('RGBTransferDetailScreen', {
                    transferId: invoice.recipientId,
                    initialTransfer: {
                      id: `local-receive:${invoice.recipientId}`,
                      transferId: invoice.recipientId,
                      ...(invoice.assetId ? { assetId: invoice.assetId } : {}),
                      type: 'receive',
                      ...(invoice.amount === undefined ? {} : { amount: String(invoice.amount) }),
                      timestamp: invoice.createdAt || Date.now(),
                      status: 'pending_accept',
                      local: true
                    }
                  });
                  return;
                }
                nav.navigate('RGBInvoiceDetailScreen', {
                  recipientId: invoice.recipientId,
                  invoice: invoice.invoice
                });
              }}>
              <Row itemsCenter gap="md" style={{ minWidth: 0, flex: 1 }}>
                <Icon icon="invoice" color="gold" size={24} />
                <Column gap="xs" style={{ minWidth: 0 }}>
                  <Text text={t('receiving_invoice')} color="white" size="sm" />
                  {timeText ? <Text text={timeText} color="textDim" size="xs" /> : null}
                  {awaitingAcceptance ? <Text text={t('rgb_status_pending_accept')} color="gold" size="xs" /> : null}
                  {awaitingConfirmation ? <Text text={t('transaction_unconfirmed')} color="gold" size="xs" /> : null}
                </Column>
              </Row>
              <Icon icon="right" color="textDim" size={14} />
            </Row>
          );
        })}
        {!loading && !invoices.length ? <Text text={t('no_pending_blind_invoices')} color="textDim" textCenter size="sm" /> : null}
        {loading ? <Text text={t('loading')} color="textDim" textCenter size="sm" /> : null}
        {!loading ? (
          <Text text={t('refresh')} color="gold" textCenter size="sm" onClick={() => void loadInvoices()} />
        ) : null}
      </Content>
    </Layout>
  );
}
