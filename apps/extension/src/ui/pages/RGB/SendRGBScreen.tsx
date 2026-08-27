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
import { spacing } from '@/ui/theme/spacing';
import { showLongNumber } from '@/ui/utils';
import { SendRGBScreenStep, useSendRGBScreenLogic } from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';
import { RGBDecodedInvoiceInfo } from './components/RGBDecodedInvoiceInfo';

const textareaStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  resize: 'vertical' as const,
  height: 100,
  minHeight: 100,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 9,
  color: '#fff',
  padding: '12px 12px',
  outline: 'none',
  lineHeight: '21px',
  fontSize: 14
};

export default function SendRGBScreen() {
  const {
    step,
    t,
    ticker,
    spendable,
    iconInfo,
    assetId,
    invoice,
    onInvoiceChange,
    onAmountChange,
    onClickMaxAmount,
    requiresAmount,
    decodedInvoice,
    displayInvoiceAmount,
    invoiceAssetId,
    invoiceAssetMismatch,
    invoiceInvalid,
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
      <Header onBack={onClickBack} title={`${t('send')} ${ticker}`} />
      <Content>
        <Column style={{ paddingTop: 12, gap: spacing.extraLarge }}>
          <Row justifyCenter>
            <RGBAssetIcon iconInfo={iconInfo} ticker={ticker} size={68} />
          </Row>

          <Column gap="md">
            <Row>
              <Text text={t('rgb_invoice')} />
            </Row>
            <textarea
              value={invoice}
              onChange={(e) => {
                onInvoiceChange(e.target.value);
              }}
              placeholder={t('paste_rgb_invoice')}
              autoFocus
              rows={5}
              style={textareaStyle}
              data-testid="send-rgb-invoice-input"
            />
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

          <RGBDecodedInvoiceInfo
            invoice={invoice}
            decodedInvoice={decodedInvoice}
            ticker={ticker}
            assetId={assetId}
            invoiceAmount={displayInvoiceAmount}
            invoiceAssetId={invoiceAssetId}
            invoiceAssetMismatch={invoiceAssetMismatch}
            invoiceInvalid={invoiceInvalid}
          />

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
