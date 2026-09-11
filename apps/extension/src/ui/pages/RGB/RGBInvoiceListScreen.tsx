import { useCallback, useEffect, useState } from 'react';

import { Button, Column, Content, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { getRgbAssetName, RGBAssetIcon } from '@/ui/components/RGBAssetIcon';
import {
  ANY_RGB_ASSET,
  ANY_RGB_ASSET_ID,
  formatRgbPendingAmount,
  getRgbAssetId,
  getRgbTokenIconInfo,
  getRgbTokenPrecision,
  getRgbTokenTicker,
  isRgbPendingInvoiceAwaitingAcceptance,
  isRgbPendingInvoiceAwaitingSenderBroadcast,
  isRgbPendingInvoiceAwaitingSenderConfirmation,
  type RgbPendingReceiveInvoice,
  useI18n,
  useNavigation,
  useRGBListLogic,
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

const copyButtonStyle = {
  width: 32,
  height: 32,
  minWidth: 32,
  borderRadius: 4,
  background: 'rgba(255,255,255,0.1)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer'
};

const amountTagStyle = {
  maxWidth: '100%',
  minHeight: 20,
  padding: '2px 6px',
  borderRadius: 3,
  background: 'rgba(255,255,255,0.12)',
  display: 'inline-flex',
  alignItems: 'center',
  boxSizing: 'border-box' as const
};

const recipientTypeTagStyle = (type: 'blind' | 'witness') => ({
  minHeight: 20,
  padding: '2px 6px',
  borderRadius: 3,
  background: type === 'witness' ? 'rgba(113, 108, 255, 0.2)' : 'rgba(255,255,255,0.12)',
  border: `1px solid ${type === 'witness' ? 'rgba(145, 140, 255, 0.5)' : 'rgba(255,255,255,0.16)'}`,
  display: 'inline-flex',
  alignItems: 'center',
  boxSizing: 'border-box' as const
});

const invoiceRecipientType = (invoice: RgbPendingReceiveInvoice): 'blind' | 'witness' =>
  invoice.kind === 'ReceiveWitness' || invoice.transferKind === 'ReceiveWitness' ? 'witness' : 'blind';

const emptyStateCardStyle = {
  padding: '32px 16px',
  borderRadius: 8,
  boxSizing: 'border-box' as const,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)'
};

const formatExpiryTime = (
  expirationTimestamp: number | undefined,
  locale: string,
  t: (key: string, values?: Record<string, string>) => string
) => {
  if (!expirationTimestamp) return t('rgb_invoice_never_expires');
  const expiresAt = expirationTimestamp > 1_000_000_000_000 ? expirationTimestamp : expirationTimestamp * 1000;
  const remainingSeconds = Math.ceil((expiresAt - Date.now()) / 1000);
  if (remainingSeconds <= 0) return t('rgb_invoice_expired');

  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    remainingSeconds >= 86_400
      ? [Math.ceil(remainingSeconds / 86_400), 'day']
      : remainingSeconds >= 3_600
      ? [Math.ceil(remainingSeconds / 3_600), 'hour']
      : [Math.max(1, Math.ceil(remainingSeconds / 60)), 'minute'];
  const relativeTime = new Intl.RelativeTimeFormat(locale.replace('_', '-'), { numeric: 'always' }).format(value, unit);
  return t('rgb_invoice_expires', { time: relativeTime });
};

export default function RGBInvoiceListScreen() {
  const wallet = useWallet();
  const nav = useNavigation();
  const tools = useTools();
  const { t, locale } = useI18n();
  const { assetId } = nav.getRouteState<'RGBInvoiceListScreen'>();
  const { items: rgbItems = [] } = useRGBListLogic();
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
          const awaitingSenderBroadcast = isRgbPendingInvoiceAwaitingSenderBroadcast(invoice);
          const awaitingSenderConfirmation = isRgbPendingInvoiceAwaitingSenderConfirmation(invoice);
          const invoiceInUse = awaitingAcceptance || awaitingSenderBroadcast || awaitingSenderConfirmation;
          const expiryText = formatExpiryTime(invoice.expirationTimestamp, locale, t);
          const invoiceAsset = invoice.assetId
            ? rgbItems.find(item => getRgbAssetId(item) === invoice.assetId) || { assetId: invoice.assetId }
            : ANY_RGB_ASSET;
          const isAnyRgbAsset = !invoice.assetId || getRgbAssetId(invoiceAsset) === ANY_RGB_ASSET_ID;
          const ticker = isAnyRgbAsset ? t('any_rgb_asset') : getRgbTokenTicker(invoiceAsset);
          const name = isAnyRgbAsset ? t('any_rgb_asset') : getRgbAssetName(invoiceAsset) || ticker;
          const precision = getRgbTokenPrecision({ ...invoiceAsset, tokenInfo: invoice });
          const fixedAmount = formatRgbPendingAmount(invoice.amount, ticker, '', precision);
          const amountLabel = fixedAmount ? `${t('fixed_amount')}: ${fixedAmount}` : t('any_amount');
          const recipientType = invoiceRecipientType(invoice);
          return (
            <Row
              key={invoice.recipientId || invoice.invoice || String(index)}
              itemsCenter
              justifyBetween
              gap="md"
              style={invoiceCardStyle}
              onClick={() => {
                if (invoiceInUse && invoice.recipientId) {
                  nav.navigate('RGBTransferDetailScreen', {
                    transferId: invoice.recipientId,
                    initialTransfer: {
                      id: `local-receive:${invoice.recipientId}`,
                      transferId: invoice.recipientId,
                      ...(invoice.assetId ? { assetId: invoice.assetId } : {}),
                      type: 'receive',
                      ...(invoice.amount === undefined ? {} : { amount: String(invoice.amount) }),
                      timestamp: invoice.createdAt || Date.now(),
                      status: awaitingAcceptance ? 'pending_accept' : awaitingSenderConfirmation ? 'confirming' : 'waiting_receive',
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
                <RGBAssetIcon
                  iconInfo={getRgbTokenIconInfo(invoiceAsset, ticker)}
                  ticker={ticker}
                  name={name}
                  size={32}
                  isAnyRgbAsset={isAnyRgbAsset}
                />
                <Column gap="xs" style={{ minWidth: 0 }}>
                  <Row itemsCenter gap="sm" style={{ minWidth: 0, flexWrap: 'wrap' }}>
                    <Text text={name} color="white" size="sm" ellipsis style={{ maxWidth: 130 }} />
                    <div style={amountTagStyle}>
                      <Text text={amountLabel} color="textDim" size="xxs" />
                    </div>
                    <div style={recipientTypeTagStyle(recipientType)}>
                      <Text
                        text={recipientType === 'witness' ? 'Witness' : 'Blind'}
                        color={recipientType === 'witness' ? 'gold' : 'textDim'}
                        size="xxs"
                      />
                    </div>
                  </Row>
                  <Text text={expiryText} color="textDim" size="xs" />
                  {awaitingAcceptance ? <Text text={t('rgb_status_pending_accept')} color="gold" size="xs" /> : null}
                  {awaitingSenderBroadcast ? <Text text={t('rgb_status_waiting_receive')} color="gold" size="xs" /> : null}
                  {awaitingSenderConfirmation ? <Text text={t('rgb_status_confirming')} color="gold" size="xs" /> : null}
                </Column>
              </Row>
              <div
                style={{ ...copyButtonStyle, opacity: invoiceInUse ? 0.45 : 1 }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (invoiceInUse) return;
                  tools.copyToClipboard(invoice.invoice);
                  tools.toastSuccess(t('copied'));
                }}>
                <Icon icon="copy" color="white_muted" size={14} />
              </div>
            </Row>
          );
        })}
        {!loading && !invoices.length ? (
          <Column fullX itemsCenter gap="sm" style={emptyStateCardStyle}>
            <Icon icon="emptyBox" color="textDim" size={32} />
            <Text text={t('no_pending_blind_invoices')} color="white" size="sm" />
          </Column>
        ) : null}
        {loading ? <Text text={t('loading')} color="textDim" textCenter size="sm" /> : null}
      </Content>
      {invoices.length ? (
        <Footer>
          <Button full text={t('refresh')} preset="primary" disabled={loading} onClick={() => void loadInvoices()} />
        </Footer>
      ) : null}
    </Layout>
  );
}
