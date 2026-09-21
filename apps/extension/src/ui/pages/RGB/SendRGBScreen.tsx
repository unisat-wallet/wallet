import { useCallback, useEffect, useRef } from 'react';

import {
  Button,
  Card,
  Column,
  Content,
  Footer,
  Header,
  Icon,
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

const feePoolSuccessMarkStyle = {
  width: 72,
  height: 72,
  borderRadius: '50%',
  background: 'rgba(123,224,152,0.16)',
  border: '1px solid rgba(123,224,152,0.32)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box' as const
};

const feePoolSummaryStyle = {
  padding: 16,
  borderRadius: 14,
  background: 'linear-gradient(145deg, rgba(244,182,44,0.16), rgba(255,255,255,0.06))',
  border: '1px solid rgba(244,182,44,0.24)'
};

const feePoolInfoIconStyle = {
  width: 32,
  height: 32,
  minWidth: 32,
  borderRadius: 8,
  background: 'rgba(255,255,255,0.09)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

export default function SendRGBScreen() {
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
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
    amountValidationMessage,
    blockingSendMessage,
    error,
    feePoolRequirement,
    feePoolTopUp,
    dismissFeePoolRequirement,
    disabled,
    onClickBack,
    onClickNext,
    signRequestVersion,
    signPsbtParams,
    onSignPsbtHandleBack,
    onSignPsbtHandleCancel,
    onSignPsbtHandleConfirm,
    onContinueAfterFeePoolTopUp
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
        key={`rgb-sign-${signRequestVersion}`}
        header={<Header onBack={onSignPsbtHandleBack} />}
        params={signPsbtParams}
        handleCancel={onSignPsbtHandleCancel}
        handleConfirm={onSignPsbtHandleConfirm}
      />
    );
  }

  if (step === SendRGBScreenStep.FEE_POOL_COMPLETED) {
    const topUpCount = feePoolTopUp?.count || 0;
    const topUpAmount = feePoolTopUp?.amount || 0;
    return (
      <Layout>
        <Header onBack={onClickBack} title={t('rgb_fee_pool_title')} />
        <Content style={{ padding: '32px 16px 16px' }}>
          <Column gap="xl" fullX>
            <Column gap="md" itemsCenter style={{ padding: '8px 12px 0' }}>
              <div style={feePoolSuccessMarkStyle}>
                <Icon icon="success" color="success" size={34} />
              </div>
              <Text text={t('rgb_fee_pool_ready_title')} color="white" size="lg" textCenter />
              <Text text={t('rgb_fee_pool_ready_description')} color="white_muted2" size="sm" textCenter wrap />
            </Column>

            <Card style={feePoolSummaryStyle}>
              <Column fullX gap="md">
                <Row full justifyBetween itemsCenter>
                  <Row gap="sm" itemsCenter>
                    <div style={feePoolInfoIconStyle}>
                      <Icon icon="btc" color="gold" size={18} />
                    </div>
                    <Text text={t('rgb_fee_pool_reusable_funds')} color="white" preset="bold" size="sm" />
                  </Row>
                  <Text text={t('success')} color="success" size="xs" />
                </Row>
                {topUpCount > 0 && topUpAmount > 0 ? (
                  <Row full justifyBetween itemsEnd>
                    <Column gap="xs">
                      <Text text={`${topUpCount} UTXO${topUpCount === 1 ? '' : 's'}`} color="white" size="xl" />
                      <Text text={t('rgb_fee_pool_add_at_least')} color="textDim" size="xs" />
                    </Column>
                    <Text text={`${topUpAmount.toLocaleString()} sats`} color="gold" preset="bold" size="sm" />
                  </Row>
                ) : null}
              </Column>
            </Card>

            <Row gap="md" itemsCenter style={{ padding: '0 8px' }}>
              <div style={feePoolInfoIconStyle}>
                <Icon icon="moreInfo" color="textDim" size={18} />
              </div>
              <Text text={t('rgb_fee_pool_explanation', { count: topUpCount || 1 })} color="textDim" size="xs" wrap />
            </Row>
          </Column>
        </Content>
        <Footer>
          <Button preset="primary" text={t('rgb_fee_pool_continue')} onClick={onContinueAfterFeePoolTopUp} />
        </Footer>
      </Layout>
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
              {amountInvalidVisible ? <Text text={amountValidationMessage} size="xs" color="danger" /> : null}
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
      {writeLeaseModal}
    </Layout>
  );
}
