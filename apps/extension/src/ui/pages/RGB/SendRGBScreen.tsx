import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Button,
  Checkbox,
  Column,
  Content,
  Header,
  Icon,
  Layout,
  RGBAssetIcon,
  Row,
  Text,
  TransferAmountCard,
  TransferAmountSection
} from '@/ui/components';
import { Spin } from '@/ui/components/Spin';
import { Line } from '@/ui/components/Line';
import { Popover } from '@/ui/components/Popover';
import { FeeRateBar } from '@/ui/components/FeeRateBar';
import { sendInputContainerStyle } from '@/ui/components/TransferAmountCard';
import { spacing } from '@/ui/theme/spacing';
import { showLongNumber } from '@/ui/utils';
import { SendRGBScreenStep, useSendRGBScreenLogic } from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';
import { RGBFeePoolInfoModal } from './components/RGBFeePoolInfoModal';
import { useRgbWriteLeaseGuard } from './components/useRgbWriteLeaseGuard';

const INVOICE_LINE_HEIGHT = 22;
const INVOICE_MIN_HEIGHT = INVOICE_LINE_HEIGHT * 3;

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
  const closeDonationPopover = () => {
    setShowDonationPopover(false);
    setUnderstandDonation(false);
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
      <Header onBack={onClickBack} title={`${t('send')} ${name}`} />
      <Content>
        <Column style={{ paddingTop: 12, gap: spacing.extraLarge }}>
          <Row justifyCenter>
            <RGBAssetIcon assetId={assetId} iconInfo={iconInfo} ticker={ticker} name={name} size={68} />
          </Row>

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
          </Column>

          {invoiceReadyForAmount ? (
            <TransferAmountSection>
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

          <Column gap="sm">
            <FeeRateBar />
          </Column>

          {invoiceReadyForAmount ? (
            <Checkbox
              checked={donation}
              onChange={(event) => {
                if (event.target.checked) setShowDonationPopover(true);
                else setDonation(false);
              }}>
              <Text text={t('rgb_donation_send')} size="sm" />
            </Checkbox>
          ) : null}

          {error ? <Text text={error} color="error" wrap /> : null}

          <Button
            disabled={disabled}
            preset="primary"
            text={t('next')}
            onClick={() => void requestWrite(onClickNext)}
            data-testid="send-rgb-next-button"
          />
        </Column>
      </Content>
      {feePoolRequirement ? (
        <RGBFeePoolInfoModal
          requirement={feePoolRequirement}
          onClose={dismissFeePoolRequirement}
          t={t}
        />
      ) : null}
      {showDonationPopover ? (
        <Popover onClose={closeDonationPopover}>
          <Column justifyCenter itemsCenter>
            <Row itemsCenter>
              <Icon icon="alert" color="yellow" size={16} />
              <Text text={t('rgb_donation_send')} preset="title" />
            </Row>
            <Line />
            <Column gap="md" fullX mb="md">
              <Text text={t('rgb_donation_send_description')} mt="md" wrap />
              <Row justifyCenter mt="md">
                <Checkbox checked={understandDonation} onChange={(event) => setUnderstandDonation(event.target.checked)}>
                  <Text text={t('i_understand')} preset="sub" />
                </Checkbox>
              </Row>
            </Column>
            <Row full>
              <Button text={t('cancel')} preset="default" full onClick={closeDonationPopover} />
              <Button
                text={t('confirm')}
                preset="primaryV2"
                disabled={!understandDonation}
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
      {writeLeaseModal}
    </Layout>
  );
}
