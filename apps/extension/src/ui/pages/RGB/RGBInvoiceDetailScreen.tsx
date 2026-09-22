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
  RGBAssetIcon,
  Row,
  Text
} from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { getRgbAssetName } from '@/ui/components/RGBAssetIcon';
import { colors } from '@/ui/theme/colors';
import {
  ANY_RGB_ASSET,
  ANY_RGB_ASSET_ID,
  formatRgbPendingAmountTag,
  getRgbAssetId,
  getRgbTokenIconInfo,
  getRgbTokenPrecision,
  getRgbTokenTicker,
  isCancelableRgbPendingInvoice,
  isDeletableRgbWitnessInvoice,
  isRgbPendingInvoiceAwaitingSenderBroadcast,
  isRgbPendingInvoiceAwaitingSenderConfirmation,
  useI18n,
  useNavigation,
  useRGBListLogic,
  useTools,
  useWallet,
  type RgbPendingReceiveInvoice
} from '@unisat/wallet-state';

import { useRgbWriteLeaseGuard } from './components/useRgbWriteLeaseGuard';

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

const recipientTypeTagStyle = {
  minHeight: 20,
  padding: '2px 6px',
  borderRadius: 3,
  background: 'rgba(255,255,255,0.12)',
  border: '1px solid rgba(255,255,255,0.16)',
  display: 'inline-flex',
  alignItems: 'center',
  boxSizing: 'border-box' as const
};

export default function RGBInvoiceDetailScreen() {
  const wallet = useWallet();
  const nav = useNavigation();
  const tools = useTools();
  const { t } = useI18n();
  const { items: rgbItems = [] } = useRGBListLogic();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const { recipientId, invoice: routeInvoice, initialInvoice } = nav.getRouteState<'RGBInvoiceDetailScreen'>();
  const routePendingInvoice = initialInvoice as RgbPendingReceiveInvoice | undefined;
  const [invoice, setInvoice] = useState<RgbPendingReceiveInvoice | undefined>(routePendingInvoice);
  const [loading, setLoading] = useState(!routePendingInvoice);
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
    // The create-invoice response is already a complete public invoice view.
    // Do not re-fetch it immediately, but keep it current so a claimed
    // invoice stops being shown as reusable once the sender is ready to broadcast.
    // Pause polling while removing the invoice so the QR card stays stable
    // until the durable state update finishes and navigation can complete.
    if (releasing) return undefined;
    if (!routePendingInvoice) void loadInvoice();
    const intervalId = setInterval(() => void loadInvoice(), 10_000);
    return () => clearInterval(intervalId);
  }, [loadInvoice, releasing, routePendingInvoice]);

  const removeInvoice = async () => {
    if (!invoice || (!isCancelableRgbPendingInvoice(invoice) && !isDeletableRgbWitnessInvoice(invoice)) || releasing)
      return;
    const batchTransferIdx = invoice.batchTransferIdx;
    if (typeof batchTransferIdx !== 'number') return;
    setReleasing(true);
    try {
      const result = await wallet.cancelRgbReceiveInvoice({ batchTransferIdx, skipSync: false });
      if (result.changed) {
        nav.goBack();
        return;
      }
      // A concurrent sync can remove the same invoice before the cancellation
      // result is returned. Treat an already-missing target as success instead
      // of leaving this screen in an empty state until the next poll.
      const refreshed = await wallet.getRgbPendingReceiveInvoices();
      const stillExists = (refreshed.list || []).some(
        (candidate) =>
          (recipientId && candidate.recipientId === recipientId) ||
          (routeInvoice && candidate.invoice === routeInvoice)
      );
      if (!stillExists) {
        nav.goBack();
        return;
      }
      setInvoice(
        (refreshed.list || []).find(
          (candidate) =>
            (recipientId && candidate.recipientId === recipientId) ||
            (routeInvoice && candidate.invoice === routeInvoice)
        ) as RgbPendingReceiveInvoice | undefined
      );
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setReleasing(false);
    }
  };

  const invoiceText = invoice?.invoice || (loading ? routeInvoice || '' : '');
  const awaitingSenderBroadcast = isRgbPendingInvoiceAwaitingSenderBroadcast(invoice);
  const awaitingSenderConfirmation = isRgbPendingInvoiceAwaitingSenderConfirmation(invoice);
  const invoiceInUse = awaitingSenderBroadcast || awaitingSenderConfirmation;
  const recipientType =
    invoice?.kind === 'ReceiveWitness' || invoice?.transferKind === 'ReceiveWitness' ? 'witness' : 'blind';
  const canRemoveInvoice = isCancelableRgbPendingInvoice(invoice) || isDeletableRgbWitnessInvoice(invoice);
  const isWitnessInvoice = recipientType === 'witness';
  const invoiceAsset = invoice?.assetId
    ? rgbItems.find((item) => getRgbAssetId(item) === invoice.assetId) || { assetId: invoice.assetId }
    : ANY_RGB_ASSET;
  const isAnyRgbAsset = !invoice?.assetId || getRgbAssetId(invoiceAsset) === ANY_RGB_ASSET_ID;
  const invoiceTicker = isAnyRgbAsset ? t('any_rgb_asset') : getRgbTokenTicker(invoiceAsset);
  const invoiceName = isAnyRgbAsset ? t('any_rgb_asset') : getRgbAssetName(invoiceAsset) || invoiceTicker;
  const invoicePrecision = getRgbTokenPrecision(invoiceAsset);
  const invoiceAmount = invoice
    ? formatRgbPendingAmountTag(invoice.amount, t('any_amount'), invoicePrecision)
    : t('any_amount');
  const invoiceDescription = isAnyRgbAsset
    ? t('use_this_invoice_to_receive_any_rgb_asset')
    : t('use_this_invoice_to_receive', { ticker: invoiceName });

  return (
    <Layout>
      <Header
        onBack={() => nav.goBack()}
        title={t('receiving_invoice')}
        RightComponent={
          canRemoveInvoice ? (
            <Icon icon="more" color="textDim" size={20} onClick={() => setActionMenuVisible(true)} />
          ) : null
        }
      />
      <Content>
        {invoiceText && !invoiceInUse ? (
          <ReceiveQRCodeCard
            value={invoiceText}
            title={
              invoice ? (
                <Column fullX itemsCenter gap="sm">
                  <Row itemsCenter justifyCenter gap="sm" fullX>
                    <Text
                      text={isAnyRgbAsset ? invoiceAmount : `${invoiceAmount} ${invoiceTicker}`}
                      color="gold"
                      size="md"
                      preset="bold"
                      textCenter
                    />
                    <div style={recipientTypeTagStyle}>
                      <Text
                        text={t(recipientType === 'witness' ? 'rgb_invoice_witness' : 'rgb_invoice_blind')}
                        color="textDim"
                        size="xxs"
                      />
                    </div>
                  </Row>
                  <Text text={invoiceDescription} color="white_muted2" size="xs" textCenter />
                </Column>
              ) : undefined
            }
            qrTopSpacing={0}
            qrCenter={
              invoice ? (
                <RGBAssetIcon
                  iconInfo={getRgbTokenIconInfo(invoiceAsset, invoiceTicker)}
                  ticker={invoiceTicker}
                  name={invoiceName}
                  size={30}
                  isAnyRgbAsset={isAnyRgbAsset}
                />
              ) : undefined
            }
            accentColor="#F4B62C"
          />
        ) : null}
        {invoiceInUse ? (
          <Column fullX itemsCenter gap="sm" style={{ padding: '32px 16px' }}>
            <Icon icon="history_receive" color="gold" size={32} />
            <Text
              text={awaitingSenderConfirmation ? t('rgb_status_confirming') : t('rgb_status_waiting_receive')}
              color="white"
              size="sm"
            />
          </Column>
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
              style={{ padding: '0 20px 24px', boxSizing: 'border-box' }}
            >
              <Text text={t(isWitnessInvoice ? 'delete_invoice' : 'release_invoice')} size="sm" />
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
              onClick={releasing ? undefined : () => setReleaseConfirmVisible(false)}
              containerStyle={{ position: 'absolute', top: 30, right: 22, opacity: releasing ? 0.45 : 1 }}
            />
            <Text
              text={t(isWitnessInvoice ? 'delete_witness_invoice_confirm_title' : 'release_invoice_confirm_title')}
              color="white"
              size="md"
              textCenter
            />
            <Text
              text={t(
                isWitnessInvoice ? 'delete_witness_invoice_confirm_description' : 'release_invoice_confirm_description'
              )}
              color="white_muted2"
              size="sm"
              wrap
              style={{ marginTop: 16 }}
            />
            <Row gap="md" fullX style={{ marginTop: 24 }}>
              <Button
                text={
                  releasing
                    ? t(isWitnessInvoice ? 'deleting_invoice' : 'releasing_invoice')
                    : t(isWitnessInvoice ? 'delete_invoice' : 'release_invoice')
                }
                preset={isWitnessInvoice ? 'danger' : 'default'}
                disabled={releasing}
                onClick={() => {
                  void requestWrite(() => void removeInvoice());
                }}
                full
                style={
                  isWitnessInvoice
                    ? { height: 48 }
                    : { height: 48, background: 'transparent', border: '1px solid rgba(255,255,255,0.42)' }
                }
                textStyle={isWitnessInvoice ? undefined : { color: colors.white, fontWeight: 'normal' }}
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
      {writeLeaseModal}
    </Layout>
  );
}
