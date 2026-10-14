import { ReactNode, useState } from 'react';

import {
  Button,
  Checkbox,
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
import { TabBar } from '@/ui/components/TabBar';
import { colors } from '@/ui/theme/colors';
import { typography } from '@/ui/theme/typography';
import { copyToClipboard, shortAddress } from '@/ui/utils';
import {
  ANY_RGB_ASSET,
  ANY_RGB_ASSET_ID,
  getRgbAssetId,
  getRgbTokenIconInfo,
  getRgbTokenPrecision,
  getRgbTokenTicker,
  isRgbPendingInvoiceAwaitingAcceptance,
  isRgbPendingInvoiceAwaitingConfirmation,
  isRgbPendingInvoiceAwaitingSenderBroadcast,
  isRgbPendingInvoiceAwaitingSenderConfirmation,
  toRgbDisplayAmount,
  useI18n,
  useRGBReceiveScreenLogic,
  useTools,
  type RGBReceiveMode,
  type RGBReceiveScreenStep
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

const invoiceTypeTagStyle = {
  height: 18,
  padding: '0 5px',
  borderRadius: 3,
  background: 'rgba(255,255,255,0.12)',
  border: '1px solid rgba(255,255,255,0.16)',
  display: 'inline-flex',
  alignItems: 'center',
  boxSizing: 'border-box' as const,
  flexShrink: 0
};

const invoiceExpiryOptions = [
  { seconds: 60 * 60, label: 'rgb_invoice_expiry_1h' },
  { seconds: 24 * 60 * 60, label: 'rgb_invoice_expiry_24h' },
  { seconds: 7 * 24 * 60 * 60, label: 'rgb_invoice_expiry_7d' },
  { seconds: 0, label: 'rgb_invoice_expiry_never' }
] as const;

type InvoiceCreationStep = 'select_asset' | 'configure_invoice';

export default function RGBReceiveScreen({
  initialStep = 'create_invoice'
}: {
  initialStep?: RGBReceiveScreenStep;
}) {
  const { t, locale } = useI18n();
  const tools = useTools();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const [invoiceTypeSelectorOpen, setInvoiceTypeSelectorOpen] = useState(false);
  const [invoiceExpirySelectorOpen, setInvoiceExpirySelectorOpen] = useState(false);
  const [creationStep, setCreationStep] = useState<InvoiceCreationStep>('select_asset');
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
    mode,
    setMode,
    recipientType,
    setRecipientType,
    invoiceExpirySeconds,
    setInvoiceExpirySeconds,
    rememberRecipientType,
    setRememberRecipientType,
    rememberInvoiceExpiry,
    setRememberInvoiceExpiry,
    amount,
    onAmountChange,
    isFixedMode,
    isAmountValid,
    amountInvalidVisible,
    amountExceedsMaximum,
    maximumDisplayAmount,
    loading,
    loadingText,
    invoice,
    selectedPendingInvoice,
    error,
    setError,
    pendingLoading,
    pendingInvoices,
    insufficientBtcForInvoice,
    onClosePendingInvoices,
    onCopyPendingInvoice,
    onCreateInvoice,
    resetRgbUtxoSignStep,
    signRgbUtxoParams,
    onSignRgbUtxoHandleConfirm,
    onSelectPendingInvoice,
    onSelectAsset,
    onCloseInvoice,
    onClickBack
  } = useRGBReceiveScreenLogic(initialStep);
  const assetDisplayTicker = assetId ? assetTicker : t('any_rgb_asset');
  const assetDisplayName = assetId ? getRgbAssetName(selectedRgbItem) || assetTicker : t('any_rgb_asset');
  const selectedExpiryLabel =
    invoiceExpiryOptions.find((option) => option.seconds === invoiceExpirySeconds)?.label ?? 'rgb_invoice_expiry_24h';

  const copyInvoice = async () => {
    if (!invoice) return;
    try {
      await copyToClipboard(invoice);
      tools.toastSuccess(t('copied'));
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    }
  };

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
    return (
      <div
        style={{
          ...assetSelectorStyle,
          height: 'auto',
          minHeight: 48,
          padding: '10px 16px',
          cursor: 'default'
        }}
      >
        <Row gap="md" itemsCenter style={{ flex: 1, minWidth: 0 }}>
          {renderAssetIcon(selectedRgbItem, 28)}
          <Column gap="xs" style={{ minWidth: 0, flex: 1 }}>
            <RunesTicker tick={assetDisplayName} truncate preset="sm" />
            {assetId ? <Text text={shortAddress(assetId, 10)} size="xs" color="textDim" ellipsis /> : null}
          </Column>
        </Row>
      </div>
    );
  };

  const renderAssetOptions = () => {
    return (
      <Column gap="sm" fullX>
        {(isAssetLocked ? [selectedRgbItem] : [ANY_RGB_ASSET, ...rgbItems]).map((item) => {
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
                minHeight: 56,
                padding: '8px 12px',
                borderRadius: 10,
                border: selected ? `1px solid ${GOLD}` : '1px solid rgba(255,255,255,0.1)',
                background: selected ? 'rgba(244,182,44,0.08)' : 'rgba(255,255,255,0.06)',
                cursor: isAssetLocked ? 'default' : 'pointer'
              }}
              onClick={() => onSelectAsset(item)}>
              <Row gap="md" itemsCenter style={{ flex: 1, minWidth: 0 }}>
                {renderAssetIcon(item, 32)}
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
        {!rgbItems.length && rgbLoading && !isAssetLocked ? (
          <Text text={t('loading_assets')} color="white_muted" textCenter />
        ) : null}
      </Column>
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
    options?: { centered?: boolean; truncateName?: boolean }
  ) => {
    return (
      <Row
        gap="md"
        itemsCenter
        justifyCenter={options?.centered}
        style={{ minWidth: 0, width: '100%', flexWrap: options?.truncateName ? 'nowrap' : 'wrap' }}
      >
        <Text
          text={assetName}
          color="white"
          size="sm"
          wrap={!options?.truncateName}
          ellipsis={options?.truncateName}
          textCenter={options?.centered}
          style={{ minWidth: 0, flex: options?.truncateName ? 1 : undefined }}
        />
        <div
          style={{
            ...amountPillStyle,
            ...(options?.truncateName ? { maxWidth: '45%', minWidth: 0, overflow: 'hidden' } : {})
          }}
        >
          <span
            style={{
              ...amountPillTextStyle,
              ...(options?.truncateName ? { overflow: 'hidden', textOverflow: 'ellipsis' } : {})
            }}
          >
            {amountText}
          </span>
        </div>
      </Row>
    );
  };

  const getPendingInvoicePrecision = (item: { assetId?: string | null; amount?: number | string }) => {
    const invoiceAsset = getPendingInvoiceAsset(item);
    const selectedAssetMetadata = getRgbAssetId(selectedRgbItem) === item.assetId ? selectedRgbItem : undefined;
    return getRgbTokenPrecision({ ...invoiceAsset, tokenInfo: item, assetInfo: selectedAssetMetadata });
  };

  const renderPendingInvoiceTitle = (item: { assetId?: string | null; amount?: number | string }) => {
    const invoiceAsset = getPendingInvoiceAsset(item);
    const isAnyRgbAsset = !item.assetId;
    const ticker = isAnyRgbAsset ? t('any_rgb_asset') : getRgbTokenTicker(invoiceAsset);
    const displayName = isAnyRgbAsset ? t('any_rgb_asset') : getRgbAssetName(invoiceAsset) || ticker;
    return renderAssetNameWithAmountTag(
      displayName,
      getRgbPendingAmountTagText(item.amount, getPendingInvoicePrecision(item)),
      { truncateName: true }
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
        getRgbPendingAmountTagText(selectedPendingInvoice.amount, getPendingInvoicePrecision(selectedPendingInvoice)),
        { centered: true }
      );
    }

    const invoiceAmount = isFixedMode && amount.trim() ? amount.trim() : t('any_amount');
    return renderAssetNameWithAmountTag(assetDisplayName, invoiceAmount, { centered: true });
  };

  const renderPendingInvoiceListItem = (item: (typeof pendingInvoices)[number], index: number) => {
    const awaitingAcceptance = isRgbPendingInvoiceAwaitingAcceptance(item);
    const awaitingConfirmation = isRgbPendingInvoiceAwaitingConfirmation(item);
    const awaitingSenderBroadcast = isRgbPendingInvoiceAwaitingSenderBroadcast(item);
    const awaitingSenderConfirmation = isRgbPendingInvoiceAwaitingSenderConfirmation(item);
    const invoiceInUse = awaitingAcceptance || awaitingSenderBroadcast || awaitingSenderConfirmation;
    const expiryText = formatRgbInvoiceExpiryTime(item.expirationTimestamp, locale, t);
    const invoiceType = item.kind === 'ReceiveWitness' || item.transferKind === 'ReceiveWitness' ? 'witness' : 'blind';

    return (
      <Row
        key={item.recipientId || item.invoice || String(index)}
        itemsCenter
        justifyBetween
        style={pendingInvoiceCardStyle}
        onClick={() => onSelectPendingInvoice(item)}
      >
        <Row gap="md" itemsCenter style={{ minWidth: 0, flex: 1, paddingRight: 12 }}>
          {renderPendingInvoiceIcon(item)}
          <Column gap="xs" style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
            {renderPendingInvoiceTitle(item)}
            <Row itemsCenter gap="sm" style={{ minWidth: 0 }}>
              <div style={invoiceTypeTagStyle}>
                <Text
                  text={t(invoiceType === 'witness' ? 'rgb_invoice_witness' : 'rgb_invoice_blind')}
                  color="textDim"
                  size="xxs"
                />
              </div>
              {!invoiceInUse ? (
                <Text text={expiryText} color="white_muted" size="xs" ellipsis style={{ minWidth: 0 }} />
              ) : null}
            </Row>
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
          }}
        >
          <Icon icon="copy" color="white_muted" size={14} />
        </div>
      </Row>
    );
  };

  const renderCreationProgress = (activeKey: 'asset' | 'options' | 'complete') => (
    <Row justifyCenter fullX>
      <TabBar
        preset="number-step"
        progressEnabled
        activeKey={activeKey}
        numberStepList={[t('select_asset'), t('invoice_options'), t('completed')]}
        items={[
          { key: 'asset', label: '1' },
          { key: 'options', label: '2' },
          { key: 'complete', label: '3' }
        ]}
        onTabClick={() => undefined}
      />
    </Row>
  );

  const renderInvoiceTypeSelector = () => {
    if (!invoiceTypeSelectorOpen) return null;

    return (
      <BottomModal onClose={() => setInvoiceTypeSelectorOpen(false)}>
        <Column gap="md">
          <Row justifyBetween itemsCenter style={{ height: 20 }} fullX>
            <Text text={t('invoice_type')} size="md" />
            <Row onClick={() => setInvoiceTypeSelectorOpen(false)}>
              <Icon icon="close" size={12} />
            </Row>
          </Row>
          <Row fullX style={{ borderTopWidth: 1, borderColor: colors.border }} />
          <Checkbox
            checked={rememberRecipientType}
            onChange={(event) => setRememberRecipientType(event.target.checked)}>
            <Text text={t('remember_my_choice')} size="sm" color="white_muted" />
          </Checkbox>
          <Column gap="sm" fullX>
            {(['blind', 'witness'] as const).map((type) => {
              const selected = recipientType === type;
              return (
                <Row
                  key={type}
                  fullX
                  itemsCenter
                  justifyBetween
                  onClick={() => {
                    setRecipientType(type);
                    setInvoiceTypeSelectorOpen(false);
                  }}
                  style={{
                    minHeight: 56,
                    padding: '0 16px',
                    boxSizing: 'border-box',
                    borderRadius: 10,
                    border: selected ? `1px solid ${GOLD}` : '1px solid rgba(255,255,255,0.1)',
                    background: selected ? 'rgba(244,182,44,0.08)' : 'rgba(255,255,255,0.06)',
                    cursor: 'pointer'
                  }}>
                  <Text text={t(type === 'blind' ? 'rgb_invoice_blind' : 'rgb_invoice_witness')} size="sm" />
                  {selected ? <Icon icon="checked" color="gold" size={20} /> : null}
                </Row>
              );
            })}
          </Column>
        </Column>
      </BottomModal>
    );
  };

  const renderInvoiceExpirySelector = () => {
    if (!invoiceExpirySelectorOpen) return null;

    return (
      <BottomModal onClose={() => setInvoiceExpirySelectorOpen(false)}>
        <Column gap="md">
          <Row justifyBetween itemsCenter style={{ height: 20 }} fullX>
            <Text text={t('rgb_invoice_expiry')} size="md" />
            <Row onClick={() => setInvoiceExpirySelectorOpen(false)}>
              <Icon icon="close" size={12} />
            </Row>
          </Row>
          <Row fullX style={{ borderTopWidth: 1, borderColor: colors.border }} />
          <Checkbox
            checked={rememberInvoiceExpiry}
            onChange={(event) => setRememberInvoiceExpiry(event.target.checked)}>
            <Text text={t('remember_my_choice')} size="sm" color="white_muted" />
          </Checkbox>
          <Column gap="sm" fullX>
            {invoiceExpiryOptions.map((option) => {
              const selected = invoiceExpirySeconds === option.seconds;
              return (
                <Row
                  key={option.seconds}
                  fullX
                  itemsCenter
                  justifyBetween
                  onClick={() => {
                    setInvoiceExpirySeconds(option.seconds);
                    setInvoiceExpirySelectorOpen(false);
                  }}
                  style={{
                    minHeight: 56,
                    padding: '0 16px',
                    boxSizing: 'border-box',
                    borderRadius: 10,
                    border: selected ? `1px solid ${GOLD}` : '1px solid rgba(255,255,255,0.1)',
                    background: selected ? 'rgba(244,182,44,0.08)' : 'rgba(255,255,255,0.06)',
                    cursor: 'pointer'
                  }}>
                  <Text text={t(option.label)} size="sm" />
                  {selected ? <Icon icon="checked" color="gold" size={20} /> : null}
                </Row>
              );
            })}
          </Column>
        </Column>
      </BottomModal>
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
                {pendingLoading ? (
                  <Text text={t('loading_pending_invoices')} color="textDim" size="sm" textCenter />
                ) : null}
                {!pendingLoading ? <Icon icon="emptyBox" color="textDim" size={32} /> : null}
                {!pendingLoading ? (
                  <Text text={t('no_pending_blind_invoices')} color="white" size="sm" textCenter />
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
        <Header onBack={onCloseInvoice} title={t('create_invoice')} />
        <Content style={{ minHeight: 0 }}>
          <Column gap="lg">
            {renderCreationProgress('complete')}
            <ReceiveQRCodeCard
              title={renderInvoiceTitle()}
              description={t('use_this_invoice_to_receive', { ticker: assetDisplayName })}
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
              showCopyButton={false}
            />
            {error ? <Text text={error} size="xs" color="danger" wrap /> : null}
          </Column>
        </Content>
        <Footer style={{ flexShrink: 0 }}>
          <Button text={t('copy_to_clipboard')} preset="primary" onClick={() => void copyInvoice()} full />
        </Footer>
        {writeLeaseModal}
      </Layout>
    );
  }

  if (creationStep === 'select_asset') {
    return (
      <Layout>
        <Header onBack={onClickBack} title={t('create_invoice')} />
        <Content>
          <Column gap="lg">
            {renderCreationProgress('asset')}
            {renderAssetOptions()}
          </Column>
        </Content>
        <Footer>
          <Button text={t('next')} preset="primary" onClick={() => setCreationStep('configure_invoice')} />
        </Footer>
      </Layout>
    );
  }

  return (
    <Layout>
      <Header onBack={() => setCreationStep('select_asset')} title={t('create_invoice')} />
      <Content>
        <Column gap="lg">
          {renderCreationProgress('options')}

          {renderLockedAssetHeader()}

          <Row
            fullX
            itemsCenter
            justifyBetween
            onClick={() => setInvoiceTypeSelectorOpen(true)}
            style={{
              minHeight: 56,
              padding: '0 16px',
              boxSizing: 'border-box',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              cursor: 'pointer'
            }}>
            <Column gap="xs">
              <Text text={t('invoice_type')} size="xs" color="textDim" />
              <Text
                text={t(recipientType === 'blind' ? 'rgb_invoice_blind' : 'rgb_invoice_witness')}
                size="sm"
                color="white"
              />
            </Column>
            <Text text={t('change')} size="sm" color="gold" />
          </Row>

          <Row
            fullX
            itemsCenter
            justifyBetween
            onClick={() => setInvoiceExpirySelectorOpen(true)}
            style={{
              minHeight: 56,
              padding: '0 16px',
              boxSizing: 'border-box',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              cursor: 'pointer'
            }}>
            <Column gap="xs">
              <Text text={t('rgb_invoice_expiry')} size="xs" color="textDim" />
              <Text
                text={t(selectedExpiryLabel)}
                size="sm"
                color="white"
              />
            </Column>
            <Text text={t('change')} size="sm" color="gold" />
          </Row>

          {recipientType === 'witness' ? (
            <Text text={t('rgb_witness_invoice_description')} size="xs" color="white_muted" wrap />
          ) : null}

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

          {recipientType === 'blind' && insufficientBtcForInvoice ? (
            <Text
              text={`${t('not_enough_btc_for_rgb_utxo')} ${t('rgb_utxo_recommended_balance')}`}
              wrap
              size="xs"
              color="danger"
            />
          ) : null}

          {error ? <Text text={error} size="xs" color="danger" wrap /> : null}
          {amountInvalidVisible ? (
            <Text
              text={
                amountExceedsMaximum
                  ? t('rgb_invoice_maximum_amount', { amount: maximumDisplayAmount })
                  : t('enter_amount_greater_than_0')
              }
              size="xs"
              color="danger"
              wrap
            />
          ) : null}
        </Column>
      </Content>
      <Footer>
        <Column gap="md">
          <Button
            text={loading ? loadingText || t('creating') : t('create_invoice')}
            preset="primary"
            disabled={loading || !isAmountValid}
            onClick={() => void requestWrite(onCreateInvoice)}
          />
        </Column>
      </Footer>
      {renderInvoiceTypeSelector()}
      {renderInvoiceExpirySelector()}
      {writeLeaseModal}
    </Layout>
  );
}
