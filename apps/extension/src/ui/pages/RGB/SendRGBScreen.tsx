import { useCallback, useEffect, useRef } from 'react';

import {
  Button,
  Column,
  Content,
  Header,
  Layout,
  RGBAssetIcon,
  Row,
  Text,
  TransferAmountCard,
  TransferAmountSection
} from '@/ui/components';
import { FeeRateBar } from '@/ui/components/FeeRateBar';
import { sendInputContainerStyle } from '@/ui/components/TransferAmountCard';
import { spacing } from '@/ui/theme/spacing';
import { showLongNumber } from '@/ui/utils';
import { SendRGBScreenStep, useSendRGBScreenLogic } from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';

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
  const {
    step,
    t,
    ticker,
    name,
    spendable,
    iconInfo,
    invoice,
    onInvoiceChange,
    onAmountChange,
    onClickMaxAmount,
    requiresAmount,
    invoiceReadyForAmount,
    invoiceValidationMessage,
    displayAmount,
    amountPlaceholder,
    amountMuted,
    amountInvalidVisible,
    blockingSendMessage,
    error,
    disabled,
    onClickBack,
    onClickNext,
    signPsbtParams,
    onSignPsbtHandleBack,
    onSignPsbtHandleCancel,
    onSignPsbtHandleConfirm
  } = useSendRGBScreenLogic();

  const invoiceRef = useRef<HTMLTextAreaElement>(null);
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
        header={<Header onBack={onSignPsbtHandleBack} />}
        params={signPsbtParams}
        handleCancel={onSignPsbtHandleCancel}
        handleConfirm={onSignPsbtHandleConfirm}
      />
    );
  }

  return (
    <Layout>
      <Header onBack={onClickBack} title={`${t('send')} ${name}`} />
      <Content>
        <Column style={{ paddingTop: 12, gap: spacing.extraLarge }}>
          <Row justifyCenter>
            <RGBAssetIcon iconInfo={iconInfo} ticker={ticker} name={name} size={68} />
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
                inputTestId="send-rgb-amount-input"
              />
              {amountInvalidVisible ? <Text text={t('enter_amount_greater_than_0')} size="xs" color="danger" /> : null}
              {blockingSendMessage ? <Text text={blockingSendMessage} size="xs" color="danger" wrap /> : null}
            </TransferAmountSection>
          ) : null}

          <Column gap="sm">
            <FeeRateBar />
          </Column>

          {error ? <Text text={error} color="error" wrap /> : null}

          <Button
            disabled={disabled}
            preset="primary"
            text={t('next')}
            onClick={onClickNext}
            data-testid="send-rgb-next-button"
          />
        </Column>
      </Content>
    </Layout>
  );
}
