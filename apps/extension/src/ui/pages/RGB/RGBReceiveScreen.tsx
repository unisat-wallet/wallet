import { ReactNode, useRef, useState } from 'react';

import {
  BottomSheetHeader,
  Button,
  Column,
  Content,
  Footer,
  Header,
  Icon,
  Image,
  Layout,
  ReceiveQRCodeCard,
  RGBAssetIcon,
  Row,
  Text
} from '@/ui/components';
import { getRgbAssetName } from '@/ui/components/RGBAssetIcon';
import { BottomModal } from '@/ui/components/BottomModal';
import { TabBar } from '@/ui/components/TabBar';
import { typography } from '@/ui/theme/typography';
import { shortAddress } from '@/ui/utils';
import { PlusCircleOutlined } from '@ant-design/icons';
import {
  ANY_RGB_ASSET,
  ANY_RGB_ASSET_ID,
  decodeRgbInvoice,
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
  useNavigation,
  useRGBReceiveScreenLogic,
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

const amountSectionCardStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: '14px 16px 16px',
  borderRadius: 10,
  background: '#161616',
  border: '1px solid #2d2d2d'
};

const amountOptionDividerStyle = {
  width: '100%',
  height: 1,
  margin: '12px 0',
  background: 'rgba(255, 255, 255, 0.15)'
};

const labelValueGapStyle = { gap: 6 };

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
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer'
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
  color: 'rgba(255, 255, 255, 0.85)',
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
  { seconds: 7 * 24 * 60 * 60, label: 'rgb_invoice_expiry_7d' }
] as const;

type InvoiceCreationStep = 'select_asset' | 'configure_invoice';

const selectorRowStyle = {
  height: 64,
  minHeight: 64,
  padding: '0 16px',
  boxSizing: 'border-box' as const,
  borderRadius: 10,
  background: '#161616',
  border: '1px solid #2d2d2d',
  cursor: 'pointer'
};

const expiryOptionStyle = (selected: boolean) => ({
  flex: '1 1 calc(50% - 6px)',
  minWidth: 0,
  height: 48,
  borderRadius: 8,
  boxSizing: 'border-box' as const,
  border: `1px solid ${selected ? GOLD : 'rgba(255,255,255,0.15)'}`,
  background: selected ? 'rgba(244,182,44,0.1)' : 'rgba(255,255,255,0.08)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer'
});

const selectorOptionStyle = (selected: boolean) => ({
  ...selectorRowStyle,
  border: selected ? `1px solid ${GOLD}` : selectorRowStyle.border,
  background: selected ? 'rgba(244,182,44,0.08)' : selectorRowStyle.background
});

export default function RGBReceiveScreen({ initialStep = 'create_invoice' }: { initialStep?: RGBReceiveScreenStep }) {
  const { t, locale } = useI18n();
  const nav = useNavigation();
  const { requestWrite, writeGuardLoading, writeLeaseModal } = useRgbWriteLeaseGuard();
  const amountInputRef = useRef<HTMLInputElement>(null);
  const [invoiceExpirySelectorOpen, setInvoiceExpirySelectorOpen] = useState(false);
  const [invoiceTypeSelectorOpen, setInvoiceTypeSelectorOpen] = useState(false);
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
  const [creationStep, setCreationStep] = useState<InvoiceCreationStep>(() =>
    isAssetLocked ? 'configure_invoice' : 'select_asset'
  );
  const assetDisplayTicker = assetId ? assetTicker : t('any_rgb_asset');
  const assetDisplayName = assetId ? getRgbAssetName(selectedRgbItem) || assetTicker : t('any_rgb_asset');
  const selectedExpiryLabel =
    invoiceExpiryOptions.find((option) => option.seconds === invoiceExpirySeconds)?.label ?? 'rgb_invoice_expiry_24h';

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
          height: 56,
          minHeight: 56,
          borderRadius: 10,
          padding: '0 16px',
          background: '#161616',
          border: '1px solid #2d2d2d',
          cursor: 'default'
        }}
      >
        <Row gap="md" itemsCenter style={{ flex: 1, minWidth: 0 }}>
          {renderAssetIcon(selectedRgbItem, 28)}
          <Column gap="xs" style={{ minWidth: 0, flex: 1 }}>
            <Text text={assetDisplayName} size="sm" color="ticker_color2" ellipsis style={{ fontSize: 14 }} />
            {assetId ? <Text text={shortAddress(assetId, 10)} size="xs" color="textDim" ellipsis /> : null}
          </Column>
        </Row>
      </div>
    );
  };

  const renderAmountOption = (
    value: RGBReceiveMode,
    title: string,
    description: string,
    children?: ReactNode
  ) => {
    const selected = mode === value;
    return (
      <Column
        gap="md"
        fullX
        style={{ cursor: 'pointer' }}
        onClick={() => {
          setMode(value);
          setError('');
          if (value === 'fixed') {
            setTimeout(() => amountInputRef.current?.focus(), 0);
          }
        }}
      >
        <Row gap="lg" itemsCenter justifyBetween fullX>
          <Column style={{ minWidth: 0, flex: 1, ...labelValueGapStyle }}>
            <Text text={title} size="sm" style={{ color: selected ? '#EFC133' : '#FFFFFF' }} />
            <Text text={description} size="xs" style={{ color: '#898989' }} />
          </Column>
          {selected ? (
            <Icon icon="checked" color="gold" size={20} />
          ) : (
            <div
              style={{
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              {/* Match checked.svg circle diameter (~17px inside 20px viewBox) */}
              <div
                style={{
                  width: 17,
                  height: 17,
                  borderRadius: '50%',
                  border: '1.5px solid rgba(255, 255, 255, 0.45)',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          )}
        </Row>
        {selected && children ? <div onClick={(e) => e.stopPropagation()}>{children}</div> : null}
      </Column>
    );
  };

  const renderAssetOptions = () => {
    return (
      <Column gap="md" fullX>
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
                padding: '12px',
                borderRadius: 10,
                border: selected ? `1px solid ${GOLD}` : '1px solid rgba(255,255,255,0.1)',
                background: selected ? 'rgba(244,182,44,0.08)' : 'rgba(255,255,255,0.06)',
                cursor: isAssetLocked ? 'default' : 'pointer'
              }}
              onClick={() => onSelectAsset(item)}
            >
              <Row gap="md" itemsCenter style={{ flex: 1, minWidth: 0 }}>
                {renderAssetIcon(item, 32)}
                <Column gap="xs" style={{ minWidth: 0, flex: 1 }}>
                  <Text
                    text={displayName}
                    size="sm"
                    color={selected ? 'gold' : 'white'}
                    ellipsis
                    style={{ fontSize: 14 }}
                  />
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
          style={{ minWidth: 0, flex: options?.truncateName ? '0 1 auto' : undefined }}
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
          <Icon icon="copy" size={14} style={{ backgroundColor: 'rgba(255, 255, 255, 0.65)' }} />
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

  const renderSelectorOption = (label: string, selected: boolean, onSelect: () => void, description?: string) => (
    <Row
      fullX
      itemsCenter
      justifyBetween
      onClick={onSelect}
      style={{
        ...selectorOptionStyle(selected),
        ...(description ? { padding: '12px 16px', height: 80, minHeight: 80 } : {})
      }}>
      <Column gap="xs" style={{ minWidth: 0, flex: 1, paddingRight: 12 }}>
        <Text text={label} size="sm" color={selected ? 'gold' : 'white'} />
        {description ? (
          <Text text={description} size="xs" wrap style={{ color: 'rgba(255, 255, 255, 0.45)' }} />
        ) : null}
      </Column>
      {selected ? <Icon icon="checked" color="gold" size={20} /> : null}
    </Row>
  );

  const renderSelectorChevron = () => (
    <Icon icon="right" size={20} style={{ backgroundColor: 'rgba(255, 255, 255, 0.65)' }} />
  );

  const renderInvoiceTypeSelector = () => {
    if (!invoiceTypeSelectorOpen) return null;

    return (
      <BottomModal onClose={() => setInvoiceTypeSelectorOpen(false)} bodyStyle={{ padding: 0 }}>
        <Column fullX gap="zero">
          <BottomSheetHeader title={t('invoice_type')} onClose={() => setInvoiceTypeSelectorOpen(false)} />
          <Column gap="lg" fullX style={{ padding: '0 20px 24px', boxSizing: 'border-box' }}>
            {renderSelectorOption(
              t('rgb_invoice_blind'),
              recipientType === 'blind',
              () => {
                setRecipientType('blind');
                setInvoiceTypeSelectorOpen(false);
              },
              t('rgb_blind_invoice_description')
            )}
            {renderSelectorOption(
              t('rgb_invoice_witness'),
              recipientType === 'witness',
              () => {
                setRecipientType('witness');
                setInvoiceTypeSelectorOpen(false);
              },
              t('rgb_witness_invoice_description')
            )}
          </Column>
        </Column>
      </BottomModal>
    );
  };

  const renderInvoiceExpirySelector = () => {
    if (!invoiceExpirySelectorOpen) return null;

    return (
      <BottomModal onClose={() => setInvoiceExpirySelectorOpen(false)} bodyStyle={{ padding: 0 }}>
        <Column fullX gap="zero">
          <BottomSheetHeader title={t('rgb_invoice_expiry')} onClose={() => setInvoiceExpirySelectorOpen(false)} />
          <Row
            fullX
            style={{
              padding: '0 20px 24px',
              boxSizing: 'border-box',
              flexWrap: 'wrap',
              gap: 12
            }}>
            {invoiceExpiryOptions.map((option) => {
              const selected = invoiceExpirySeconds === option.seconds;
              return (
                <div
                  key={option.seconds}
                  style={expiryOptionStyle(selected)}
                  onClick={() => {
                    setInvoiceExpirySeconds(option.seconds);
                    setInvoiceExpirySelectorOpen(false);
                  }}>
                  <Text
                    text={t(option.label)}
                    color={selected ? 'gold' : 'white'}
                    style={{ fontSize: 13, fontWeight: 500 }}
                  />
                </div>
              );
            })}
          </Row>
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
        <Header
          onBack={onClosePendingInvoices}
          title={t('pending_invoices')}
          RightComponent={
            <Icon
              onClick={() => nav.navigate('RGBReceiveScreen', {
                initialStep: 'create_invoice',
                ...(assetId ? { assetId } : {})
              })}
              data-testid="rgb-invoice-list-create-button"
            >
              <PlusCircleOutlined />
            </Icon>
          }
        />
        <Content>
          <Column gap="md">
            {pendingInvoices.length ? (
              pendingInvoices.map(renderPendingInvoiceListItem)
            ) : (
              <Column fullX itemsCenter style={{ padding: '32px 16px', boxSizing: 'border-box', gap: 16 }}>
                {pendingLoading ? (
                  <Text text={t('loading_pending_invoices')} color="textDim" size="sm" textCenter />
                ) : null}
                {!pendingLoading ? (
                  <Image src="./images/icons/status/empty-box.svg" width={85} height={59} />
                ) : null}
                {!pendingLoading ? (
                  <Text
                    text={t('no_pending_blind_invoices')}
                    textCenter
                    style={{ fontSize: 14, color: '#FFFFFF' }}
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
    const decodedInvoice = decodeRgbInvoice(invoice);
    const invoiceExpirationTimestamp =
      selectedPendingInvoice?.expirationTimestamp ??
      (decodedInvoice.valid ? decodedInvoice.expirationTimestamp : undefined);

    return (
      <Layout>
        <Header onBack={onCloseInvoice} title={t('invoice_created')} />
        <Content>
          <Column gap="zero">
            <ReceiveQRCodeCard
              title={
                <Column fullX itemsCenter gap="sm">
                  {renderInvoiceTitle()}
                  <Text
                    text={t('use_this_invoice_to_receive', { ticker: assetDisplayName })}
                    color="white_muted2"
                    size="xs"
                    textCenter
                  />
                  <Text
                    text={formatRgbInvoiceExpiryTime(invoiceExpirationTimestamp, locale, t)}
                    color="white_muted"
                    size="xs"
                    textCenter
                  />
                </Column>
              }
              value={invoice}
              qrCenter={
                <RGBAssetIcon
                  iconInfo={getRgbTokenIconInfo(selectedRgbItem, assetTicker)}
                  ticker={assetTicker}
                  name={getRgbAssetName(selectedRgbItem)}
                  size={30}
                  isAnyRgbAsset={!assetId}
                />
              }
              accentColor={GOLD}
              qrTopSpacing={0}
            />

            <Button
              text={t('done')}
              preset="default"
              onClick={onCloseInvoice}
              style={{ marginTop: 16 }}
            />

            {error ? <Text text={error} size="xs" color="danger" wrap style={{ marginTop: 12 }} /> : null}
          </Column>
        </Content>
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
      <Header
        onBack={() => {
          if (isAssetLocked) {
            onClickBack();
            return;
          }
          setCreationStep('select_asset');
        }}
        title={t('create_invoice')}
      />
      <Content>
        <Column gap="lg">
          {renderCreationProgress('options')}

          {renderLockedAssetHeader()}

          <Column gap="sm" fullX>
            <Row
              fullX
              itemsCenter
              justifyBetween
              onClick={() => setInvoiceTypeSelectorOpen(true)}
              style={selectorRowStyle}
            >
              <Column style={labelValueGapStyle}>
                <Text text={t('invoice_type')} size="xs" color="textDim" />
                <Text
                  text={t(recipientType === 'blind' ? 'rgb_invoice_blind' : 'rgb_invoice_witness')}
                  size="sm"
                  color="white"
                />
              </Column>
              {renderSelectorChevron()}
            </Row>
          </Column>

          {canSetFixedAmount ? (
            <Column fullX gap="md" style={amountSectionCardStyle}>
              <Text text={t('amount')} size="xs" style={{ color: '#898989' }} />
              <Column fullX gap="zero">
                {renderAmountOption('any', t('any_amount'), t('accept_any_rgb_amount'))}
                <div style={amountOptionDividerStyle} />
                {renderAmountOption(
                  'fixed',
                  t('fixed_amount'),
                  t('set_exact_rgb_amount'),
                  <Row itemsCenter gap="lg" style={amountInputContainerStyle}>
                    <input
                      ref={amountInputRef}
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
                )}
              </Column>
            </Column>
          ) : (
            <Row
              fullX
              itemsCenter
              style={{ ...selectorRowStyle, height: 'auto', minHeight: 74, padding: '12px 16px', cursor: 'default' }}
            >
              <Column style={labelValueGapStyle}>
                <Text text={t('amount')} size="xs" color="textDim" />
                <Text text={t('any_amount')} size="sm" color="white" />
                <Text text={t('accept_any_rgb_amount')} size="xs" style={{ color: '#898989' }} />
              </Column>
            </Row>
          )}

          <Column gap="sm" fullX>
            <Row
              fullX
              itemsCenter
              justifyBetween
              onClick={() => setInvoiceExpirySelectorOpen(true)}
              style={selectorRowStyle}
            >
              <Column style={labelValueGapStyle}>
                <Text text={t('rgb_invoice_expiry')} size="xs" color="textDim" />
                <Text text={t(selectedExpiryLabel)} size="sm" color="white" />
              </Column>
              {renderSelectorChevron()}
            </Row>
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
            text={loading || writeGuardLoading ? loadingText || t('creating') : t('create_invoice')}
            preset="primary"
            disabled={loading || writeGuardLoading || !isAmountValid}
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
