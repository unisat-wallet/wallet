import { ReactNode, useState } from 'react';

import {
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
import { colors } from '@/ui/theme/colors';
import {
  ANY_RGB_ASSET,
  ANY_RGB_ASSET_ID,
  formatRgbPendingAmount,
  formatRgbPendingTime,
  getRgbAssetId,
  getRgbTokenIconInfo,
  getRgbTokenTicker,
  isCancelableRgbPendingInvoice,
  useI18n,
  useRGBReceiveScreenLogic,
  type RGBReceiveMode
} from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';

const GOLD = '#F4B62C';

const amountInputContainerStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  height: 48,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 10,
  padding: '0 12px'
};

const amountInputFieldStyle = {
  flex: '1 1 0',
  minWidth: 0,
  width: '100%',
  height: '100%',
  background: 'transparent',
  border: 'none',
  color: '#fff',
  padding: 0,
  fontSize: 14,
  outline: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
};

const modeCardStyle = (selected: boolean) => ({
  width: '100%',
  boxSizing: 'border-box' as const,
  minHeight: 72,
  padding: selected ? '14px' : '14px 16px',
  background: selected ? 'rgba(244,182,44,0.05)' : 'rgba(255,255,255,0.08)',
  border: selected ? `1px solid ${GOLD}` : '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  cursor: 'pointer'
});

const radioStyle = (selected: boolean) => ({
  width: 18,
  height: 18,
  minWidth: 18,
  borderRadius: '50%',
  border: selected ? `2px solid ${GOLD}` : '2px solid rgba(255,255,255,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box' as const
});

const assetSelectorStyle = {
  width: '100%',
  height: 48,
  borderRadius: 12,
  padding: '0 16px',
  boxSizing: 'border-box' as const,
  background: 'rgba(255,255,255,0.08)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  cursor: 'pointer'
};

const pendingSummaryStyle = {
  width: '100%',
  minHeight: 48,
  borderRadius: 10,
  padding: '0 18px',
  boxSizing: 'border-box' as const,
  background: 'rgba(244,182,44,0.13)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  cursor: 'pointer'
};

const pendingInvoiceCardStyle = {
  minHeight: 60,
  padding: '0 12px 0 12px',
  borderRadius: 8,
  boxSizing: 'border-box' as const,
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.12)',
  cursor: 'pointer'
};

const pendingCopyButtonStyle = {
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

const amountPillStyle = {
  height: 20,
  padding: '0 10px',
  borderRadius: 3,
  background: 'rgba(255,255,255,0.12)',
  display: 'flex',
  alignItems: 'center',
  boxSizing: 'border-box' as const
};

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

export default function RGBReceiveScreen() {
  const { t } = useI18n();
  const [releaseConfirmVisible, setReleaseConfirmVisible] = useState(false);
  const {
    step,
    rgbItems,
    rgbLoading,
    isAssetLocked,
    selectedRgbItem,
    assetId,
    assetTicker,
    assetPrecision,
    assetSelectorOpen,
    setAssetSelectorOpen,
    mode,
    setMode,
    amount,
    onAmountChange,
    normalizedAmount,
    isFixedMode,
    isAmountValid,
    loading,
    loadingText,
    invoice,
    invoiceLabel,
    selectedPendingInvoice,
    error,
    setError,
    cancelLoading,
    pendingLoading,
    pendingInvoices,
    loadPendingInvoices,
    onOpenPendingInvoices,
    onClosePendingInvoices,
    onCopyPendingInvoice,
    onCreateInvoice,
    resetRgbUtxoSignStep,
    signRgbUtxoParams,
    onSignRgbUtxoHandleConfirm,
    onSelectPendingInvoice,
    onCancelPendingInvoice,
    onSelectAsset,
    onBackToCreate,
    onCloseInvoice,
    onClickBack
  } = useRGBReceiveScreenLogic();
  const assetDisplayTicker = assetId ? assetTicker : t('any_rgb_asset');

  const renderAssetIcon = (item: unknown, size = 24) => {
    const isAnyRgbAsset = getRgbAssetId(item) === ANY_RGB_ASSET_ID;
    const ticker = getRgbTokenTicker(item);
    const iconInfo = getRgbTokenIconInfo(item, ticker);

    return <RGBAssetIcon iconInfo={iconInfo} size={size} isAnyRgbAsset={isAnyRgbAsset} />;
  };

  const renderAssetSelector = () => {
    return (
      <Column gap="sm">
        <div style={assetSelectorStyle} onClick={() => setAssetSelectorOpen(true)}>
          <Row gap="md" itemsCenter>
            {renderAssetIcon(selectedRgbItem)}
            <Text text={assetDisplayTicker} color="white" size="sm" />
          </Row>
          <Icon icon="down" size={14} />
        </div>
      </Column>
    );
  };

  const renderAssetSelectorSheet = () => {
    if (!assetSelectorOpen) return null;

    return (
      <BottomModal onClose={() => setAssetSelectorOpen(false)}>
        <Column justifyCenter itemsCenter>
          <Row justifyBetween itemsCenter style={{ height: 20 }} fullX>
            <Text text={t('select_asset')} textCenter size="md" />
            <Row onClick={() => setAssetSelectorOpen(false)}>
              <Icon icon="close" size={12} />
            </Row>
          </Row>

          <Row fullX style={{ borderTopWidth: 1, borderColor: colors.border }} mt="md" />

          <Column gap="sm" mt="sm" mb="lg" fullX style={{ maxHeight: '50vh', overflowY: 'auto' }}>
            {[ANY_RGB_ASSET, ...rgbItems].map((item) => {
              const itemAssetId = getRgbAssetId(item);
              const ticker = itemAssetId === ANY_RGB_ASSET_ID ? t('any_rgb_asset') : getRgbTokenTicker(item);
              const selected = itemAssetId === (assetId || ANY_RGB_ASSET_ID);
              return (
                <Row
                  key={itemAssetId || ticker}
                  itemsCenter
                  justifyBetween
                  style={{
                    minHeight: 48,
                    padding: '0 12px',
                    borderRadius: 10,
                    background: selected ? 'rgba(244,182,44,0.12)' : 'transparent',
                    cursor: 'pointer'
                  }}
                  onClick={() => onSelectAsset(item)}
                >
                  <Row gap="md" itemsCenter>
                    {renderAssetIcon(item, 24)}
                    <Text text={ticker} color="white" size="sm" />
                  </Row>
                  {selected ? <Icon icon="checked" color="gold" size={20} /> : null}
                </Row>
              );
            })}
            {!rgbItems.length && rgbLoading ? <Text text={t('loading_assets')} color="white_muted" textCenter /> : null}
          </Column>
        </Column>
      </BottomModal>
    );
  };

  const renderModeCard = (value: RGBReceiveMode, title: string, description: string, children?: ReactNode) => {
    const selected = mode === value;
    const isExpanded = selected && !!children;
    return (
      <Column
        gap="md"
        style={{
          ...modeCardStyle(selected),
          justifyContent: isExpanded ? 'flex-start' : 'center'
        }}
        onClick={() => {
          setMode(value);
          setError('');
        }}
      >
        <Row gap="lg" itemsCenter>
          <div style={radioStyle(selected)}>
            {selected ? <div style={{ width: 10, height: 10, borderRadius: '50%', background: GOLD }} /> : null}
          </div>
          <Column gap="sm" style={{ minWidth: 0 }}>
            <Text text={title} color="white" />
            <Text text={description} size="xs" color="white_muted" />
          </Column>
        </Row>
        {selected && children ? <div onClick={(e) => e.stopPropagation()}>{children}</div> : null}
      </Column>
    );
  };

  const getPendingInvoiceAsset = (item: { assetId?: string | null }) => {
    if (!item.assetId) {
      return ANY_RGB_ASSET;
    }

    return rgbItems.find((rgbItem) => getRgbAssetId(rgbItem) === item.assetId) || selectedRgbItem;
  };

  const renderPendingInvoiceIcon = (item: { assetId?: string | null }, size = 32) => {
    const invoiceAsset = getPendingInvoiceAsset(item);
    const isAnyRgbAsset = !item.assetId || getRgbAssetId(invoiceAsset) === ANY_RGB_ASSET_ID;
    const ticker = getRgbTokenTicker(invoiceAsset);
    return (
      <RGBAssetIcon iconInfo={getRgbTokenIconInfo(invoiceAsset, ticker)} size={size} isAnyRgbAsset={isAnyRgbAsset} />
    );
  };

  const renderPendingInvoiceTitle = (item: { assetId?: string | null; amount?: number | string }) => {
    const invoiceAsset = getPendingInvoiceAsset(item);
    const isAnyRgbAsset = !item.assetId;
    const ticker = isAnyRgbAsset ? t('any_rgb_asset') : getRgbTokenTicker(invoiceAsset);
    const formattedAmount = formatRgbPendingAmount(item.amount, ticker);

    return (
      <Row gap="sm" itemsCenter style={{ minWidth: 0 }}>
        <Text text={formattedAmount || ticker} color="white" size="md" wrap />
        {!formattedAmount ? (
          <div style={amountPillStyle}>
            <Text text={t('any_amount')} color="white_muted" size="xs" />
          </div>
        ) : null}
      </Row>
    );
  };

  const renderPendingSummary = () => {
    return (
      <div
        style={pendingSummaryStyle}
        onClick={() => {
          onOpenPendingInvoices();
        }}
      >
        <Row gap="sm" itemsCenter>
          <Icon icon="invoice" color="white" size={22} />
          <Text text={`${t('pending_invoices')} (${pendingInvoices.length})`} color="white" />
        </Row>
        <Row gap="sm" itemsCenter>
          <Text text={t('view_all')} size="sm" style={{ color: GOLD }} />
          <Icon icon="right" color="gold" size={14} />
        </Row>
      </div>
    );
  };

  const renderPendingInvoiceListItem = (item: (typeof pendingInvoices)[number], index: number) => {
    const itemKey = item.recipientId || item.invoice || String(index);
    const timeText = formatRgbPendingTime(item.createdAt || item.expirationTimestamp);

    return (
      <Row
        key={itemKey}
        itemsCenter
        justifyBetween
        style={pendingInvoiceCardStyle}
        onClick={() => onSelectPendingInvoice(item)}
      >
        <Row gap="md" itemsCenter style={{ minWidth: 0, flex: 1, paddingRight: 12 }}>
          {renderPendingInvoiceIcon(item)}
          <Column gap="xs" style={{ minWidth: 0 }}>
            {renderPendingInvoiceTitle(item)}
            {timeText ? <Text text={timeText} color="white_muted" size="xs" /> : null}
          </Column>
        </Row>

        <div
          style={pendingCopyButtonStyle}
          onClick={(e) => {
            e.stopPropagation();
            onCopyPendingInvoice(item);
          }}
        >
          <Icon icon="copy" color="white_muted" size={14} />
        </div>
      </Row>
    );
  };

  const renderReleaseInvoiceConfirmModal = () => {
    if (!releaseConfirmVisible) return null;

    return (
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
              text={t('release_invoice')}
              preset="default"
              disabled={cancelLoading}
              onClick={() => {
                setReleaseConfirmVisible(false);
                onCancelPendingInvoice();
              }}
              full
              style={{ height: 48, background: 'transparent', border: '1px solid rgba(255,255,255,0.42)' }}
              textStyle={{ color: colors.white, fontWeight: 'normal' }}
            />
            <Button
              text={t('keep_invoice')}
              preset="primary"
              disabled={cancelLoading}
              onClick={() => setReleaseConfirmVisible(false)}
              full
              style={{ height: 48 }}
              textStyle={{ color: colors.black, fontWeight: 'normal' }}
            />
          </Row>
        </Column>
      </div>
    );
  };

  if (step === 'sign_rgb_utxo') {
    return (
      <SignPsbt
        header={<Header onBack={resetRgbUtxoSignStep} />}
        params={signRgbUtxoParams}
        handleCancel={resetRgbUtxoSignStep}
        handleConfirm={onSignRgbUtxoHandleConfirm}
      />
    );
  }

  if (step === 'pending_invoices' && !invoice) {
    return (
      <Layout>
        <Header onBack={onClosePendingInvoices} title={t('pending_invoices')} />
        <Content>
          <Column gap="md">
            {pendingInvoices.length > 0 ? (
              pendingInvoices.map(renderPendingInvoiceListItem)
            ) : (
              <Column itemsCenter gap="md" style={{ paddingTop: 80 }}>
                <Text
                  text={pendingLoading ? t('loading_pending_invoices') : t('no_pending_blind_invoices')}
                  color="white_muted"
                  size="sm"
                  textCenter
                />
                {!pendingLoading ? (
                  <Text
                    text={t('refresh')}
                    size="sm"
                    style={{ color: GOLD, cursor: 'pointer' }}
                    onClick={loadPendingInvoices}
                  />
                ) : null}
              </Column>
            )}
          </Column>
        </Content>
      </Layout>
    );
  }

  if (invoice) {
    return (
      <Layout>
        <Header onBack={onBackToCreate} title={t('receive')} />
        <Content>
          <Column gap="lg">
            <ReceiveQRCodeCard
              title={`${assetDisplayTicker} ${t('rgb_invoice')} · ${invoiceLabel}`}
              description={t('use_this_invoice_to_receive', { ticker: assetDisplayTicker })}
              value={invoice}
              valueLabel={t('receiving_invoice')}
              qrCenter={
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: '#24AF7A',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 14,
                    lineHeight: '30px',
                    textAlign: 'center'
                  }}
                >
                  T
                </div>
              }
              accentColor={GOLD}
            />

            <Row justifyBetween>
              {isCancelableRgbPendingInvoice(selectedPendingInvoice) ? (
                <Button
                  text={cancelLoading ? t('releasing_invoice') : t('release_invoice')}
                  preset="default"
                  disabled={cancelLoading}
                  onClick={() => setReleaseConfirmVisible(true)}
                  full
                  style={{ background: 'transparent', border: '1px solid rgba(244, 182, 44, 0.45)' }}
                  textStyle={{ color: 'rgba(244, 182, 44, 0.85)', fontWeight: 'normal' }}
                />
              ) : null}

              <Button
                text={t('close')}
                preset="default"
                onClick={onCloseInvoice}
                full
                style={{ background: 'transparent' }}
                textStyle={{ color: colors.white, fontWeight: 'normal' }}
              />
            </Row>

            {error ? <Text text={error} size="xs" color="danger" wrap /> : null}
          </Column>
        </Content>
        {renderReleaseInvoiceConfirmModal()}
      </Layout>
    );
  }

  return (
    <Layout>
      <Header onBack={onClickBack} title={t('receive')} />
      <Content>
        <Column gap="lg">
          {pendingInvoices.length > 0 ? renderPendingSummary() : null}

          {!isAssetLocked ? renderAssetSelector() : null}

          <Column gap="lg">
            {renderModeCard('any', t('any_amount'), t('accept_any_rgb_amount'))}
            {renderModeCard(
              'fixed',
              t('fixed_amount'),
              t('set_exact_rgb_amount'),
              <Row itemsCenter gap="lg" style={amountInputContainerStyle}>
                <input
                  value={amount}
                  onChange={(e) => {
                    onAmountChange(e.target.value);
                    setError('');
                  }}
                  inputMode={assetPrecision > 0 ? 'decimal' : 'numeric'}
                  placeholder={assetPrecision > 0 ? `0.${'0'.repeat(Math.min(assetPrecision, 8))}` : '0'}
                  style={amountInputFieldStyle}
                />
                <Text text={assetTicker} size="sm" color="white_muted" style={{ flexShrink: 0 }} />
              </Row>
            )}
          </Column>

          {error ? <Text text={error} size="xs" color="danger" wrap /> : null}
          {isFixedMode && normalizedAmount && !isAmountValid ? (
            <Text text={t('enter_amount_greater_than_0')} size="xs" color="danger" />
          ) : null}
        </Column>
      </Content>
      <Footer>
        <Column gap="md">
          <Button
            text={loading ? loadingText || t('creating') : t('create_invoice')}
            preset="primary"
            disabled={loading || !isAmountValid}
            onClick={onCreateInvoice}
          />
        </Column>
      </Footer>
      {!isAssetLocked ? renderAssetSelectorSheet() : null}
    </Layout>
  );
}
