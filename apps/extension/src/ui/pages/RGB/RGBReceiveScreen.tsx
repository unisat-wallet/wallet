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
import { getRgbAssetName } from '@/ui/components/RGBAssetIcon';
import { BottomModal } from '@/ui/components/BottomModal';
import { RunesTicker } from '@/ui/components/RunesTicker';
import { colors } from '@/ui/theme/colors';
import { typography } from '@/ui/theme/typography';
import { shortAddress } from '@/ui/utils';
import {
  ANY_RGB_ASSET,
  ANY_RGB_ASSET_ID,
  getRgbAssetId,
  getRgbTokenIconInfo,
  getRgbTokenPrecision,
  getRgbTokenTicker,
  isCancelableRgbPendingInvoice,
  isRgbPendingInvoiceAwaitingAcceptance,
  isRgbPendingInvoiceAwaitingConfirmation,
  isRgbPendingInvoiceAwaitingSenderBroadcast,
  isRgbPendingInvoiceAwaitingSenderConfirmation,
  toRgbDisplayAmount,
  useI18n,
  useRGBReceiveScreenLogic,
  type RGBReceiveMode
} from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';
import { useRgbWriteLeaseGuard } from './components/useRgbWriteLeaseGuard';
import { formatRgbInvoiceExpiryTime } from './rgbInvoicePresentation';

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

const pendingSummaryPlaceholderStyle = {
  ...pendingSummaryStyle,
  cursor: 'default'
};

const pendingSummarySkeletonStyle = {
  height: 14,
  borderRadius: 4,
  background: 'rgba(255,255,255,0.08)'
};

const pendingInvoiceCardStyle = {
  minHeight: 64,
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

const emptyStateCardStyle = {
  padding: '32px 16px',
  borderRadius: 8,
  boxSizing: 'border-box' as const,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)'
};

const amountPillStyle = {
  height: 20,
  padding: '0 4px',
  borderRadius: 3,
  background: 'rgba(255,255,255,0.12)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box' as const,
  flexShrink: 0,
  width: 'fit-content'
};

const amountPillTextStyle = {
  fontSize: 12,
  lineHeight: '16px',
  color: colors.white_muted,
  fontFamily: typography.primary.regular,
  letterSpacing: 'normal',
  whiteSpace: 'nowrap' as const
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
  const { t, locale } = useI18n();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
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
    canSetFixedAmount,
    assetSelectorOpen,
    setAssetSelectorOpen,
    mode,
    setMode,
    recipientType,
    setRecipientType,
    amount,
    onAmountChange,
    normalizedAmount,
    isFixedMode,
    isAmountValid,
    amountInvalidVisible,
    loading,
    loadingText,
    invoice,
    selectedPendingInvoice,
    error,
    setError,
    cancelLoading,
    pendingLoading,
    pendingInvoices,
    insufficientBtcForInvoice,
    needsRgbUtxoFunding,
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
  const assetDisplayName = assetId ? getRgbAssetName(selectedRgbItem) || assetTicker : t('any_rgb_asset');

  const getRgbPendingAmountTagText = (amount?: number | string, precision = 0) => {
    if (amount === undefined || amount === null || amount === '' || String(amount) === '0') {
      return t('any_amount');
    }
    return toRgbDisplayAmount(amount, precision);
  };

  const renderAssetIcon = (item: unknown, size = 24) => {
    const isAnyRgbAsset = getRgbAssetId(item) === ANY_RGB_ASSET_ID;
    const ticker = getRgbTokenTicker(item);
    const iconInfo = getRgbTokenIconInfo(item, ticker);

    return (
      <RGBAssetIcon
        iconInfo={iconInfo}
        ticker={ticker}
        name={getRgbAssetName(item)}
        size={size}
        isAnyRgbAsset={isAnyRgbAsset}
      />
    );
  };

  const renderLockedAssetHeader = () => {
    if (!isAssetLocked) return null;

    return (
      <div
        style={{
          ...assetSelectorStyle,
          height: 'auto',
          minHeight: 48,
          padding: '10px 16px',
          cursor: 'default'
        }}>
        <Row gap="md" itemsCenter style={{ flex: 1, minWidth: 0 }}>
          {renderAssetIcon(selectedRgbItem, 28)}
          <Column gap="xs" style={{ minWidth: 0, flex: 1 }}>
            <RunesTicker tick={assetDisplayName} truncate preset="sm" />
            <Text text={`(ticker: ${assetTicker})`} size="xs" color="textDim" ellipsis />
          </Column>
        </Row>
      </div>
    );
  };

  const renderAssetSelector = () => {
    return (
      <Column gap="sm">
        <div
          style={{
            ...assetSelectorStyle,
            height: 'auto',
            minHeight: 48,
            padding: '10px 16px'
          }}
          onClick={() => setAssetSelectorOpen(true)}>
          <Row gap="md" itemsCenter style={{ flex: 1, minWidth: 0 }}>
            {renderAssetIcon(selectedRgbItem, 28)}
            <Column gap="xs" style={{ minWidth: 0, flex: 1 }}>
              <Text text={assetDisplayName} color="white" size="sm" ellipsis />
              {assetId ? (
                <Text
                  text={shortAddress(assetId, 10)}
                  size="xs"
                  ellipsis
                  style={{ color: 'rgba(255, 255, 255, 0.45)' }}
                />
              ) : null}
            </Column>
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

          <Column gap="md" mt="sm" mb="lg" fullX style={{ maxHeight: '50vh', overflowY: 'auto' }}>
            {[ANY_RGB_ASSET, ...rgbItems].map((item) => {
              const itemAssetId = getRgbAssetId(item);
              const isAnyRgbAsset = itemAssetId === ANY_RGB_ASSET_ID;
              const displayName = isAnyRgbAsset ? t('any_rgb_asset') : getRgbAssetName(item) || getRgbTokenTicker(item);
              const selected = itemAssetId === (assetId || ANY_RGB_ASSET_ID);
              return (
                <Row
                  key={itemAssetId || displayName}
                  itemsCenter
                  justifyBetween
                  gap="md"
                  style={{
                    minHeight: 48,
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: selected ? 'rgba(244,182,44,0.12)' : 'transparent',
                    cursor: 'pointer'
                  }}
                  onClick={() => onSelectAsset(item)}
                >
                  <Row gap="md" itemsCenter style={{ flex: 1, minWidth: 0 }}>
                    {renderAssetIcon(item, 28)}
                    <Column gap="xs" style={{ minWidth: 0, flex: 1 }}>
                      <RunesTicker tick={displayName} truncate preset="sm" />
                      {!isAnyRgbAsset && itemAssetId ? (
                        <Text
                          text={shortAddress(itemAssetId, 10)}
                          size="xs"
                          ellipsis
                          style={{ color: 'rgba(255, 255, 255, 0.45)' }}
                        />
                      ) : null}
                    </Column>
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
      <RGBAssetIcon
        iconInfo={getRgbTokenIconInfo(invoiceAsset, ticker)}
        ticker={ticker}
        name={getRgbAssetName(invoiceAsset)}
        size={size}
        isAnyRgbAsset={isAnyRgbAsset}
      />
    );
  };

  const renderAssetNameWithAmountTag = (
    assetName: string,
    amountText: string,
    options?: { centered?: boolean }
  ) => {
    return (
      <Row
        gap="md"
        itemsCenter
        justifyCenter={options?.centered}
        style={{ minWidth: 0, flexWrap: 'wrap' }}
      >
        <Text text={assetName} color="white" size="sm" wrap textCenter={options?.centered} />
        <div style={amountPillStyle}>
          <span style={amountPillTextStyle}>{amountText}</span>
        </div>
      </Row>
    );
  };

  const getPendingInvoicePrecision = (item: {
    assetId?: string | null;
    amount?: number | string;
  }) => {
    const invoiceAsset = getPendingInvoiceAsset(item);
    const selectedAssetMetadata =
      getRgbAssetId(selectedRgbItem) === item.assetId ? selectedRgbItem : undefined;
    return getRgbTokenPrecision({ ...invoiceAsset, tokenInfo: item, assetInfo: selectedAssetMetadata });
  };

  const renderPendingInvoiceTitle = (item: { assetId?: string | null; amount?: number | string }) => {
    const invoiceAsset = getPendingInvoiceAsset(item);
    const isAnyRgbAsset = !item.assetId;
    const ticker = isAnyRgbAsset ? t('any_rgb_asset') : getRgbTokenTicker(invoiceAsset);
    const displayName = isAnyRgbAsset ? t('any_rgb_asset') : getRgbAssetName(invoiceAsset) || ticker;
    return renderAssetNameWithAmountTag(
      displayName,
      getRgbPendingAmountTagText(item.amount, getPendingInvoicePrecision(item))
    );
  };

  const renderInvoiceTitle = () => {
    if (selectedPendingInvoice) {
      const invoiceAsset = getPendingInvoiceAsset(selectedPendingInvoice);
      const isAnyRgbAsset = !selectedPendingInvoice.assetId;
      const ticker = isAnyRgbAsset ? t('any_rgb_asset') : getRgbTokenTicker(invoiceAsset);
      const displayName = isAnyRgbAsset ? t('any_rgb_asset') : getRgbAssetName(invoiceAsset) || ticker;

      return renderAssetNameWithAmountTag(
        displayName,
        getRgbPendingAmountTagText(
          selectedPendingInvoice.amount,
          getPendingInvoicePrecision(selectedPendingInvoice)
        ),
        { centered: true }
      );
    }

    const invoiceAmount = isFixedMode && amount.trim() ? amount.trim() : t('any_amount');
    return renderAssetNameWithAmountTag(assetDisplayName, invoiceAmount, { centered: true });
  };

  const renderPendingPlaceholder = () => {
    return (
      <div style={pendingSummaryPlaceholderStyle} aria-hidden>
        <div style={{ ...pendingSummarySkeletonStyle, width: 140 }} />
        <div style={{ ...pendingSummarySkeletonStyle, width: 72 }} />
      </div>
    );
  };

  const renderPendingSection = () => {
    if (pendingLoading) {
      return renderPendingPlaceholder();
    }

    if (pendingInvoices.length > 0) {
      return renderPendingSummary();
    }

    return null;
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
        <Icon icon="right" color="gold" size={14} />
      </div>
    );
  };

  const renderPendingInvoiceListItem = (item: (typeof pendingInvoices)[number], index: number) => {
    const awaitingAcceptance = isRgbPendingInvoiceAwaitingAcceptance(item);
    const awaitingConfirmation = isRgbPendingInvoiceAwaitingConfirmation(item);
    const awaitingSenderBroadcast = isRgbPendingInvoiceAwaitingSenderBroadcast(item);
    const awaitingSenderConfirmation = isRgbPendingInvoiceAwaitingSenderConfirmation(item);
    const invoiceInUse = awaitingAcceptance || awaitingSenderBroadcast || awaitingSenderConfirmation;
    const expiryText = formatRgbInvoiceExpiryTime(item.expirationTimestamp, locale, t);

    return (
      <Row
        key={item.recipientId || item.invoice || String(index)}
        itemsCenter
        justifyBetween
        style={pendingInvoiceCardStyle}
        onClick={() => onSelectPendingInvoice(item)}>
        <Row gap="md" itemsCenter style={{ minWidth: 0, flex: 1, paddingRight: 12 }}>
          {renderPendingInvoiceIcon(item)}
          <Column gap="xs" style={{ minWidth: 0 }}>
            {renderPendingInvoiceTitle(item)}
            <Text text={expiryText} color="white_muted" size="xs" />
            {awaitingAcceptance ? <Text text={t('rgb_status_pending_accept')} color="gold" size="xs" /> : null}
            {awaitingSenderBroadcast ? <Text text={t('rgb_status_waiting_receive')} color="gold" size="xs" /> : null}
            {awaitingSenderConfirmation ? <Text text={t('rgb_status_confirming')} color="gold" size="xs" /> : null}
            {awaitingConfirmation ? <Text text={t('transaction_unconfirmed')} color="gold" size="xs" /> : null}
          </Column>
        </Row>
        <div
          style={{ ...pendingCopyButtonStyle, opacity: invoiceInUse ? 0.45 : 1 }}
          onClick={(event) => {
            event.stopPropagation();
            if (!invoiceInUse) onCopyPendingInvoice(item);
          }}>
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
                void requestWrite(() => void onCancelPendingInvoice());
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
            {pendingInvoices.length ? (
              pendingInvoices.map(renderPendingInvoiceListItem)
            ) : (
              <Column fullX itemsCenter gap="sm" style={emptyStateCardStyle}>
                {pendingLoading ? <Text text={t('loading_pending_invoices')} color="textDim" size="sm" textCenter /> : null}
                {!pendingLoading ? <Icon icon="emptyBox" color="textDim" size={32} /> : null}
                {!pendingLoading ? <Text text={t('no_pending_blind_invoices')} color="white" size="sm" textCenter /> : null}
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
              title={renderInvoiceTitle()}
              description={
                t('use_this_invoice_to_receive', { ticker: assetDisplayName })
              }
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
        {writeLeaseModal}
      </Layout>
    );
  }

  return (
    <Layout>
      <Header onBack={onClickBack} title={t('receive')} />
      <Content>
        <Column gap="lg">
          {renderPendingSection()}

          <Row gap="sm">
            <Button
              text="Blind"
              preset={recipientType === 'blind' ? 'primary' : 'default'}
              onClick={() => setRecipientType('blind')}
              style={{ flex: 1 }}
            />
            <Button
              text="Witness"
              preset={recipientType === 'witness' ? 'primary' : 'default'}
              onClick={() => setRecipientType('witness')}
              style={{ flex: 1 }}
            />
          </Row>

          {recipientType === 'witness' ? (
            <Text
              text="Witness invoices reuse your RGB funding address and include a small BTC output."
              size="xs"
              color="white_muted"
              wrap
            />
          ) : null}

          {isAssetLocked ? renderLockedAssetHeader() : renderAssetSelector()}

          <Column gap="lg">
            {renderModeCard('any', t('any_amount'), t('accept_any_rgb_amount'))}
            {canSetFixedAmount
              ? renderModeCard(
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
                    <Text text={assetDisplayTicker} size="sm" color="white_muted" style={{ flexShrink: 0 }} />
                  </Row>
                )
              : null}
          </Column>

          {recipientType === 'blind' && needsRgbUtxoFunding ? (
            <Text
              text={t('rgb_utxo_recommended_balance')}
              wrap
              style={{
                color: 'rgba(235,185,76,0.85)',
                fontSize: 12,
                fontWeight: 500,
                lineHeight: 'normal',
                marginTop: 4
              }}
            />
          ) : null}

          {error ? <Text text={error} size="xs" color="danger" wrap /> : null}
          {amountInvalidVisible ? (
            <Text text={t('enter_amount_greater_than_0')} size="xs" color="danger" />
          ) : null}
        </Column>
      </Content>
      <Footer>
        <Column gap="md">
          <Button
            text={loading ? loadingText || t('creating') : t('create_invoice')}
            preset="primary"
            disabled={loading || !isAmountValid || (recipientType === 'blind' && insufficientBtcForInvoice)}
            onClick={() => void requestWrite(onCreateInvoice)}
          />
        </Column>
      </Footer>
      {!isAssetLocked ? renderAssetSelectorSheet() : null}
      {writeLeaseModal}
    </Layout>
  );
}
