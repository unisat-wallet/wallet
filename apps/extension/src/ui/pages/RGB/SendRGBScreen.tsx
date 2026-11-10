import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BottomSheetHeader,
  Button,
  Card,
  Checkbox,
  Column,
  Content,
  Header,
  Icon,
  Image,
  Layout,
  RGBAssetIcon,
  Row,
  Text,
  TransferAmountCard,
  TransferAmountSection
} from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { FeeRateBar } from '@/ui/components/FeeRateBar';
import { Line } from '@/ui/components/Line';
import { Popover } from '@/ui/components/Popover';
import { Spin } from '@/ui/components/Spin';
import { sendInputContainerStyle } from '@/ui/components/TransferAmountCard';
import { spacing } from '@/ui/theme/spacing';
import { showLongNumber } from '@/ui/utils';
import { SendRGBScreenStep, useSendRGBScreenLogic } from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';
import { RGBFeePoolInfoModal } from './components/RGBFeePoolInfoModal';
import { useRgbWriteLeaseGuard } from './components/useRgbWriteLeaseGuard';
import { RGB_BURN_NETWORKS } from './rgbBurnNetworks';

const INVOICE_LINE_HEIGHT = 22;
const INVOICE_MIN_HEIGHT = INVOICE_LINE_HEIGHT * 3;
const RGB_ACCENT_GOLD = '#F4B62C';

const burnNetworkSelectorStyle = {
  width: '100%',
  height: 64,
  minHeight: 64,
  padding: '0 16px',
  boxSizing: 'border-box' as const,
  borderRadius: 10,
  background: '#161616',
  border: '1px solid #2d2d2d',
  cursor: 'pointer'
};

const invoiceBoxStyle = {
  ...sendInputContainerStyle,
  padding: '12px 16px'
};

const invoiceFieldStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  display: 'block' as const,
  resize: 'none' as const,
  overflow: 'hidden' as const,
  minHeight: INVOICE_MIN_HEIGHT,
  background: 'transparent',
  border: 'none',
  color: '#fff',
  padding: 0,
  margin: 0,
  outline: 'none',
  lineHeight: `${INVOICE_LINE_HEIGHT}px`,
  fontSize: 14,
  overflowWrap: 'anywhere' as const,
  wordBreak: 'break-all' as const
};

export default function SendRGBScreen() {
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const {
    step,
    t,
    assetId,
    burn,
    burnReason,
    setBurnReason,
    burnMode,
    setBurnMode,
    burnDestinationChainId,
    setBurnDestinationChainId,
    ticker,
    name,
    assetPrecision,
    spendable,
    iconInfo,
    invoice,
    onInvoiceChange,
    onAmountChange,
    donation,
    setDonation,
    onClickMaxAmount,
    requiresAmount,
    invoiceReadyForAmount,
    invoiceValidationMessage,
    proxyApprovalEndpoints,
    proxyApprovalAccepted,
    setProxyApprovalAccepted,
    displayAmount,
    amountPlaceholder,
    amountMuted,
    amountInvalidVisible,
    amountValidationMessage,
    blockingSendMessage,
    error,
    feePoolRequirement,
    dismissFeePoolRequirement,
    disabled,
    onClickBack,
    onClickNext,
    signRequestVersion,
    signPsbtParams,
    onSignPsbtHandleBack,
    onSignPsbtHandleCancel,
    onSignPsbtHandleConfirm
  } = useSendRGBScreenLogic();

  const invoiceRef = useRef<HTMLTextAreaElement>(null);
  const [showDonationPopover, setShowDonationPopover] = useState(false);
  const [understandDonation, setUnderstandDonation] = useState(false);
  const [showBurnPopover, setShowBurnPopover] = useState(false);
  const [burnModeSelectorOpen, setBurnModeSelectorOpen] = useState(false);
  const [burnNetworkSelectorOpen, setBurnNetworkSelectorOpen] = useState(false);
  const [understandBurn, setUnderstandBurn] = useState(false);
  const selectedBurnNetwork = RGB_BURN_NETWORKS.find((network) => network.id === burnDestinationChainId);
  const closeDonationPopover = () => {
    setShowDonationPopover(false);
    setUnderstandDonation(false);
  };
  const closeBurnPopover = () => {
    setShowBurnPopover(false);
    setUnderstandBurn(false);
  };
  const syncInvoiceHeight = useCallback(() => {
    const el = invoiceRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(INVOICE_MIN_HEIGHT, el.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    syncInvoiceHeight();
  }, [invoice, syncInvoiceHeight]);

  if (step === SendRGBScreenStep.SIGN_TX) {
    return (
      <SignPsbt
        key={`rgb-sign-${signRequestVersion}`}
        header={<Header onBack={onSignPsbtHandleBack} />}
        params={signPsbtParams}
        handleCancel={onSignPsbtHandleCancel}
        handleConfirm={onSignPsbtHandleConfirm}
      />
    );
  }

  if (step === SendRGBScreenStep.FEE_POOL_COMPLETED) {
    return (
      <Layout>
        <Content preset="middle" bg="background">
          <Column gap="md" itemsCenter>
            <Spin size="large" />
            <Text text={t('rgb_preparing_transfer')} color="white_muted2" size="sm" textCenter />
          </Column>
        </Content>
      </Layout>
    );
  }

  return (
    <Layout>
      <Header onBack={onClickBack} title={`${burn ? t('rgb_burn') : t('send')} ${name}`} />
      <Content>
        <Column style={{ paddingTop: 12, gap: spacing.extraLarge }}>
          <Row justifyCenter>
            <RGBAssetIcon assetId={assetId} iconInfo={iconInfo} ticker={ticker} name={name} size={68} />
          </Row>

          {!burn ? (
            <Column gap="md">
              <Row>
                <Text text={t('rgb_invoice')} />
              </Row>
              <div style={invoiceBoxStyle}>
                <textarea
                  ref={invoiceRef}
                  value={invoice}
                  onChange={(e) => {
                    onInvoiceChange(e.target.value);
                    requestAnimationFrame(syncInvoiceHeight);
                  }}
                  placeholder={t('paste_rgb_invoice')}
                  autoFocus
                  rows={3}
                  spellCheck={false}
                  autoCorrect="off"
                  autoComplete="off"
                  style={invoiceFieldStyle}
                  data-testid="send-rgb-invoice-input"
                />
              </div>
              {invoiceValidationMessage ? <Text text={invoiceValidationMessage} size="xs" color="danger" wrap /> : null}
              {proxyApprovalEndpoints.length > 0 ? (
                <Card style={{ display: 'block', padding: 12, background: 'rgba(235, 185, 76, 0.12)' }}>
                  <Column gap="sm">
                    <Row itemsCenter gap="sm">
                      <Icon icon="warning" color="gold" size={18} />
                      <Text text="Third-party RGB proxy" preset="sub" color="gold" />
                    </Row>
                    <Text
                      text="This invoice uses a proxy that is not on UniSat's trusted list. The wallet extension will connect to this endpoint directly."
                      size="xs"
                      color="textDim"
                      wrap
                    />
                    {proxyApprovalEndpoints.map((endpoint) => (
                      <Text key={endpoint} text={endpoint} size="xs" style={{ wordBreak: 'break-all' }} />
                    ))}
                    <Checkbox
                      checked={proxyApprovalAccepted}
                      onChange={(event) => setProxyApprovalAccepted(event.target.checked)}
                      style={{ alignItems: 'flex-start', marginTop: 4 }}>
                      <Text
                        text="I authorize this wallet to use the proxy endpoint shown above for this RGB payment."
                        size="xs"
                        color="textDim"
                        wrap
                      />
                    </Checkbox>
                  </Column>
                </Card>
              ) : null}
            </Column>
          ) : null}

          {invoiceReadyForAmount ? (
            <TransferAmountSection title={burn ? t('rgb_burn_amount') : undefined}>
              <TransferAmountCard
                amount={displayAmount}
                onAmountChange={onAmountChange}
                placeholder={requiresAmount ? '0' : amountPlaceholder}
                readOnly={!requiresAmount}
                showMax={requiresAmount}
                onMaxClick={onClickMaxAmount}
                availableAmount={showLongNumber(spendable)}
                unit={ticker}
                amountMuted={amountMuted}
                decimalPlaces={assetPrecision}
                inputTestId="send-rgb-amount-input"
              />
              {amountInvalidVisible ? <Text text={amountValidationMessage} size="xs" color="danger" /> : null}
              {blockingSendMessage ? <Text text={blockingSendMessage} size="xs" color="danger" wrap /> : null}
            </TransferAmountSection>
          ) : null}

          {burn ? (
            <Column gap="md">
              <Text text={t('rgb_burn_mode')} size="sm" />
              <Row
                fullX
                itemsCenter
                justifyBetween
                onClick={() => setBurnModeSelectorOpen(true)}
                style={burnNetworkSelectorStyle}
                data-testid="rgb-burn-mode-select">
                <Column gap="zero">
                  <Text
                    text={t(burnMode === 'legacy' ? 'rgb_burn_mode_legacy' : 'rgb_burn_mode_v1')}
                    size="sm"
                    color="white"
                  />
                  <Text
                    text={t(
                      burnMode === 'legacy'
                        ? 'rgb_burn_mode_legacy_description'
                        : 'rgb_burn_mode_v1_description'
                    )}
                    size="xs"
                    color="textDim"
                  />
                </Column>
                <Icon icon="right" size={20} style={{ backgroundColor: 'rgba(255, 255, 255, 0.65)' }} />
              </Row>
              <Text text={t('rgb_burn_network')} size="sm" />
              <Row
                fullX
                itemsCenter
                justifyBetween
                onClick={burnMode === 'v1' ? () => setBurnNetworkSelectorOpen(true) : undefined}
                style={{
                  ...burnNetworkSelectorStyle,
                  cursor: burnMode === 'v1' ? 'pointer' : 'default'
                }}
                data-testid="rgb-burn-network-select">
                <Row itemsCenter gap="md">
                  {selectedBurnNetwork ? (
                    <Image src={selectedBurnNetwork.icon} size={32} style={{ flexShrink: 0, objectFit: 'contain' }} />
                  ) : null}
                  <Text text={selectedBurnNetwork?.name || ''} size="sm" color="white" />
                </Row>
                {burnMode === 'v1' ? (
                  <Icon icon="right" size={20} style={{ backgroundColor: 'rgba(255, 255, 255, 0.65)' }} />
                ) : null}
              </Row>
              <Text
                text={t('rgb_burn_recipient_address')}
                size="sm"
                mt="md"
              />
              <input
                value={burnReason}
                onChange={(event) => setBurnReason(event.target.value.trim())}
                placeholder={t(
                  burnDestinationChainId === 728126428 ? 'rgb_burn_tron_placeholder' : 'rgb_burn_reason_placeholder'
                )}
                maxLength={44}
                spellCheck={false}
                style={{
                  ...invoiceBoxStyle,
                  width: '100%',
                  color: '#fff',
                  outline: 'none',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  lineHeight: `${INVOICE_LINE_HEIGHT}px`
                }}
                data-testid="rgb-burn-reason-input"
              />
              {burnReason &&
              (burnDestinationChainId === 728126428
                ? !(/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(burnReason) || /^(?:0x)?41[0-9a-f]{40}$/i.test(burnReason))
                : !/^(?:0x)?[0-9a-f]{40}$/i.test(burnReason) || /^0+$/.test(burnReason.replace(/^0x/i, ''))) ? (
                <Text
                  text={t(burnDestinationChainId === 728126428 ? 'rgb_burn_tron_invalid' : 'rgb_burn_reason_invalid')}
                  size="xs"
                  color="danger"
                  wrap
                />
              ) : null}
            </Column>
          ) : null}

          <Column gap="sm">
            <FeeRateBar />
          </Column>

          {!burn && invoiceReadyForAmount ? (
            <button
              type="button"
              aria-pressed={donation}
              data-testid="rgb-donation-send-toggle"
              onClick={() => {
                if (donation) setDonation(false);
                else setShowDonationPopover(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                width: '100%',
                minHeight: 72,
                padding: '12px 14px',
                border: `1px solid ${donation ? 'rgba(244,182,44,0.5)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 12,
                background: donation ? 'rgba(244,182,44,0.08)' : 'rgba(255,255,255,0.04)',
                color: 'inherit',
                textAlign: 'left',
                cursor: 'pointer'
              }}>
              <Column gap="xs" style={{ minWidth: 0 }}>
                <Text text={t('rgb_donation_send')} size="sm" preset="bold" />
                <Text text={t('rgb_donation_send_hint')} size="xs" color="textDim" wrap />
              </Column>
              <span
                aria-hidden="true"
                style={{
                  width: 38,
                  height: 22,
                  borderRadius: 11,
                  flexShrink: 0,
                  padding: 2,
                  boxSizing: 'border-box',
                  background: donation ? RGB_ACCENT_GOLD : 'rgba(255,255,255,0.25)',
                  transition: 'background 150ms ease'
                }}>
                <span
                  style={{
                    display: 'block',
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: '#fff',
                    transform: donation ? 'translateX(16px)' : undefined,
                    transition: 'transform 150ms ease'
                  }}
                />
              </span>
            </button>
          ) : null}

          {error ? <Text data-testid="send-rgb-error" text={error} color="error" wrap /> : null}

          <Button
            disabled={disabled}
            preset="primary"
            text={t('next')}
            onClick={() => {
              if (burn) setShowBurnPopover(true);
              else void requestWrite(onClickNext);
            }}
            data-testid="send-rgb-next-button"
          />
        </Column>
      </Content>
      {feePoolRequirement ? (
        <RGBFeePoolInfoModal requirement={feePoolRequirement} onClose={dismissFeePoolRequirement} t={t} />
      ) : null}
      {showDonationPopover ? (
        <Popover onClose={closeDonationPopover}>
          <Column gap="md" fullX>
            <Row itemsCenter gap="sm" style={{ paddingRight: 22 }}>
              <Icon icon="warning" color="warning" size={20} />
              <Text text={t('rgb_donation_send')} preset="bold" size="md" wrap />
            </Row>
            <Line />
            <Text text={t('rgb_donation_send_description')} size="sm" color="textDim" wrap />
            <Checkbox
              checked={understandDonation}
              onChange={(event) => setUnderstandDonation(event.target.checked)}
              data-testid="rgb-donation-acknowledgement"
              style={{ alignItems: 'flex-start', margin: '4px 0 12px' }}>
              <Text text={t('rgb_donation_send_ack')} size="xs" color="textDim" wrap />
            </Checkbox>
            <Row full>
              <Button text={t('cancel')} preset="default" full onClick={closeDonationPopover} />
              <Button
                text={t('rgb_donation_send_enable')}
                preset="primaryV2"
                disabled={!understandDonation}
                data-testid="rgb-donation-confirm-button"
                full
                onClick={() => {
                  setDonation(true);
                  closeDonationPopover();
                }}
              />
            </Row>
          </Column>
        </Popover>
      ) : null}
      {showBurnPopover ? (
        <Popover onClose={closeBurnPopover}>
          <Column justifyCenter itemsCenter>
            <Row itemsCenter>
              <Icon icon="alert" color="yellow" size={16} />
              <Text text={t('rgb_burn')} preset="title" />
            </Row>
            <Line />
            <Column gap="md" fullX mb="md">
              <Text
                text={t(burnMode === 'legacy' ? 'rgb_burn_description' : 'rgb_burn_destination_v1_description')}
                mt="md"
                wrap
              />
              <Row itemsCenter gap="sm">
                {selectedBurnNetwork ? <Image src={selectedBurnNetwork.icon} size={24} /> : null}
                <Text text={selectedBurnNetwork?.name || ''} size="sm" color="gold" />
              </Row>
              <Text text={burnReason} size="xs" color="gold" wrap style={{ overflowWrap: 'anywhere' }} />
              <Row justifyCenter mt="md">
                <Checkbox checked={understandBurn} onChange={(event) => setUnderstandBurn(event.target.checked)}>
                  <Text
                    text={t(burnMode === 'legacy' ? 'rgb_burn_confirm' : 'rgb_burn_destination_v1_confirm')}
                    preset="sub"
                    wrap
                  />
                </Checkbox>
              </Row>
            </Column>
            <Row full>
              <Button text={t('cancel')} preset="default" full onClick={closeBurnPopover} />
              <Button
                text={t('confirm')}
                preset="primaryV2"
                disabled={!understandBurn}
                full
                onClick={() => {
                  closeBurnPopover();
                  void requestWrite(onClickNext);
                }}
              />
            </Row>
          </Column>
        </Popover>
      ) : null}
      {burnModeSelectorOpen ? (
        <BottomModal onClose={() => setBurnModeSelectorOpen(false)} bodyStyle={{ padding: 0 }}>
          <Column fullX gap="zero">
            <BottomSheetHeader title={t('rgb_burn_mode')} onClose={() => setBurnModeSelectorOpen(false)} />
            <Column gap="lg" fullX style={{ padding: '0 20px 24px', boxSizing: 'border-box' }}>
              {(['v1', 'legacy'] as const).map((mode) => {
                const selected = mode === burnMode;
                return (
                  <Row
                    key={mode}
                    fullX
                    itemsCenter
                    justifyBetween
                    onClick={() => {
                      if (!selected) setBurnMode(mode);
                      setBurnModeSelectorOpen(false);
                    }}
                    style={{
                      ...burnNetworkSelectorStyle,
                      height: 76,
                      border: selected ? `1px solid ${RGB_ACCENT_GOLD}` : burnNetworkSelectorStyle.border,
                      background: selected ? 'rgba(244,182,44,0.08)' : burnNetworkSelectorStyle.background
                    }}>
                    <Column gap="zero">
                      <Text
                        text={t(mode === 'legacy' ? 'rgb_burn_mode_legacy' : 'rgb_burn_mode_v1')}
                        size="sm"
                        color={selected ? 'gold' : 'white'}
                      />
                      <Text
                        text={t(
                          mode === 'legacy'
                            ? 'rgb_burn_mode_legacy_description'
                            : 'rgb_burn_mode_v1_description'
                        )}
                        size="xs"
                        color="textDim"
                        wrap
                      />
                    </Column>
                    {selected ? <Icon icon="checked" color="gold" size={20} /> : null}
                  </Row>
                );
              })}
            </Column>
          </Column>
        </BottomModal>
      ) : null}
      {burnNetworkSelectorOpen ? (
        <BottomModal onClose={() => setBurnNetworkSelectorOpen(false)} bodyStyle={{ padding: 0 }}>
          <Column fullX gap="zero">
            <BottomSheetHeader title={t('rgb_burn_network')} onClose={() => setBurnNetworkSelectorOpen(false)} />
            <Column gap="lg" fullX style={{ padding: '0 20px 24px', boxSizing: 'border-box' }}>
              {RGB_BURN_NETWORKS.map((network) => {
                const selected = network.id === burnDestinationChainId;
                return (
                  <Row
                    key={network.id}
                    fullX
                    itemsCenter
                    justifyBetween
                    onClick={() => {
                      if (!selected) setBurnDestinationChainId(network.id);
                      setBurnNetworkSelectorOpen(false);
                    }}
                    style={{
                      ...burnNetworkSelectorStyle,
                      border: selected ? `1px solid ${RGB_ACCENT_GOLD}` : burnNetworkSelectorStyle.border,
                      background: selected ? 'rgba(244,182,44,0.08)' : burnNetworkSelectorStyle.background
                    }}>
                    <Row itemsCenter gap="md">
                      <Image src={network.icon} size={32} style={{ flexShrink: 0, objectFit: 'contain' }} />
                      <Text text={network.name} size="sm" color={selected ? 'gold' : 'white'} />
                    </Row>
                    {selected ? <Icon icon="checked" color="gold" size={20} /> : null}
                  </Row>
                );
              })}
            </Column>
          </Column>
        </BottomModal>
      ) : null}
      {writeLeaseModal}
    </Layout>
  );
}
