import { useCallback, useEffect, useState } from 'react';

import {
  BottomSheetHeader,
  Button,
  Column,
  Content,
  Footer,
  Header,
  Icon,
  Layout,
  ReceiveQRCodeCard,
  Row,
  Text
} from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { colors } from '@/ui/theme/colors';
import {
  isCancelableRgbPendingInvoice,
  useI18n,
  useNavigation,
  useTools,
  useWallet,
  type RgbPendingReceiveInvoice
} from '@unisat/wallet-state';

const confirmMaskStyle = {
  position: 'fixed' as const,
  inset: 0,
  zIndex: 30,
  background: 'rgba(0,0,0,0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 16px',
  boxSizing: 'border-box' as const
};

const confirmModalStyle = {
  width: '100%',
  borderRadius: 14,
  padding: '28px 16px 24px',
  background: '#171B21',
  boxSizing: 'border-box' as const,
  position: 'relative' as const
};

export default function RGBInvoiceDetailScreen() {
  const wallet = useWallet();
  const nav = useNavigation();
  const tools = useTools();
  const { t } = useI18n();
  const { recipientId, invoice: routeInvoice } = nav.getRouteState<'RGBInvoiceDetailScreen'>();
  const [invoice, setInvoice] = useState<RgbPendingReceiveInvoice>();
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState(false);
  const [releaseConfirmVisible, setReleaseConfirmVisible] = useState(false);
  const [actionMenuVisible, setActionMenuVisible] = useState(false);

  const loadInvoice = useCallback(async () => {
    setLoading(true);
    try {
      const result = await wallet.getRgbPendingReceiveInvoices();
      const item = (result.list || []).find(
        (candidate) =>
          (recipientId && candidate.recipientId === recipientId) || (routeInvoice && candidate.invoice === routeInvoice)
      );
      setInvoice(item as RgbPendingReceiveInvoice | undefined);
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [recipientId, routeInvoice, tools, wallet]);

  useEffect(() => {
    void loadInvoice();
  }, [loadInvoice]);

  const release = async () => {
    if (!invoice || !isCancelableRgbPendingInvoice(invoice) || releasing) return;
    const batchTransferIdx = invoice.batchTransferIdx;
    if (typeof batchTransferIdx !== 'number') return;
    setReleasing(true);
    try {
      const result = await wallet.cancelRgbReceiveInvoice({ batchTransferIdx, skipSync: false });
      if (result.changed) {
        nav.goBack();
        return;
      }
      await loadInvoice();
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setReleasing(false);
    }
  };

  const invoiceText = invoice?.invoice || routeInvoice || '';

  return (
    <Layout>
      <Header
        onBack={() => nav.goBack()}
        title={t('receiving_invoice')}
        RightComponent={
          isCancelableRgbPendingInvoice(invoice) ? (
            <Icon icon="more" color="textDim" size={20} onClick={() => setActionMenuVisible(true)} />
          ) : null
        }
      />
      <Content>
        {invoiceText ? (
          <ReceiveQRCodeCard
            title={t('receiving_invoice')}
            value={invoiceText}
            valueLabel={t('receiving_invoice')}
            accentColor="#F4B62C"
          />
        ) : null}
        {!loading && !invoiceText ? (
          <Text text={t('no_pending_blind_invoices')} color="textDim" textCenter size="sm" />
        ) : null}
        {loading && !invoiceText ? <Text text={t('loading')} color="textDim" textCenter size="sm" /> : null}
      </Content>
      <Footer>
        <Row fullX gap="md">
          <Button
            text={t('close')}
            preset="default"
            onClick={() => nav.goBack()}
            full
            style={{ background: 'transparent' }}
            textStyle={{ color: colors.white, fontWeight: 'normal' }}
          />
        </Row>
      </Footer>
      {actionMenuVisible ? (
        <BottomModal onClose={() => setActionMenuVisible(false)} bodyStyle={{ padding: 0 }}>
          <Column fullX gap="zero">
            <BottomSheetHeader title={t('more')} onClose={() => setActionMenuVisible(false)} />
            <Row
              fullX
              itemsCenter
              gap="md"
              onClick={() => {
                setActionMenuVisible(false);
                setReleaseConfirmVisible(true);
              }}
              style={{ padding: '0 20px 24px', boxSizing: 'border-box' }}>
              <Text text={t('release_invoice')} size="sm" />
            </Row>
          </Column>
        </BottomModal>
      ) : null}
      {releaseConfirmVisible ? (
        <div style={confirmMaskStyle}>
          <Column gap="zero" style={confirmModalStyle}>
            <Icon
              icon="close"
              color="white_muted2"
              size={12}
              onClick={() => setReleaseConfirmVisible(false)}
              containerStyle={{ position: 'absolute', top: 30, right: 22 }}
            />
            <Text text={t('release_invoice_confirm_title')} color="white" size="md" textCenter />
            <Text
              text={t('release_invoice_confirm_description')}
              color="white_muted2"
              size="sm"
              wrap
              style={{ marginTop: 16 }}
            />
            <Row gap="md" fullX style={{ marginTop: 24 }}>
              <Button
                text={releasing ? t('releasing_invoice') : t('release_invoice')}
                preset="default"
                disabled={releasing}
                onClick={() => {
                  setReleaseConfirmVisible(false);
                  void release();
                }}
                full
                style={{ height: 48, background: 'transparent', border: '1px solid rgba(255,255,255,0.42)' }}
                textStyle={{ color: colors.white, fontWeight: 'normal' }}
              />
              <Button
                text={t('keep_invoice')}
                preset="primary"
                disabled={releasing}
                onClick={() => setReleaseConfirmVisible(false)}
                full
                style={{ height: 48 }}
                textStyle={{ color: colors.black, fontWeight: 'normal' }}
              />
            </Row>
          </Column>
        </div>
      ) : null}
    </Layout>
  );
}
