import { Button, Column, Content, Header, Layout, RGBAssetIcon, Row, Text } from '@/ui/components';
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

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  height: 54,
  background: 'transparent',
  border: 'none',
  color: '#fff',
  padding: 0,
  outline: 'none',
  fontSize: 20
};

const fieldHeaderStyle = {
  minHeight: 26,
  alignItems: 'center'
};

const amountCardStyle = {
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(255,255,255,0.06)',
  padding: '0 16px 12px',
  boxSizing: 'border-box' as const
};

const amountInputSectionStyle = {
  height: 76,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%'
};

const maxButtonStyle = {
  height: 28,
  minWidth: 56,
  borderRadius: 10,
  border: '1px solid rgba(244, 182, 44, 0.45)',
  color: 'rgba(244, 182, 44, 0.85)',
  background: 'transparent',
  fontSize: 14,
  cursor: 'pointer',
  justifyContent: 'center' as const,
  textAlign: 'center' as const
};

const dividerStyle = {
  height: 1,
  background: 'rgba(255,255,255,0.12)',
  width: '100%'
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
    invoiceAmount,
    invoiceAssetId,
    invoiceAssetMismatch,
    invoiceInvalid,
    invoiceReadyForAmount,
    invoiceValidationMessage,
    displayAmount,
    amountPlaceholder,
    amountMuted,
    amountInvalidVisible,
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
            <RGBAssetIcon iconInfo={iconInfo} size={68} />
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
            <Column gap="sm">
              <Row justifyBetween style={fieldHeaderStyle}>
                <Text text={t('transfer_amount')} />
              </Row>
              <Column style={amountCardStyle}>
                <div style={amountInputSectionStyle}>
                  <input
                    value={displayAmount}
                    onChange={(e) => {
                      if (requiresAmount) {
                        onAmountChange(e.target.value);
                      }
                    }}
                    placeholder={amountPlaceholder}
                    inputMode="numeric"
                    readOnly={!requiresAmount}
                    style={{
                      ...inputStyle,
                      flex: 1,
                      color: !requiresAmount || amountMuted ? 'rgba(255, 255, 255, 0.45)' : '#fff'
                    }}
                    data-testid="send-rgb-amount-input"
                  />
                  {requiresAmount ? (
                    <button type="button" style={maxButtonStyle} onClick={onClickMaxAmount}>
                      {t('max')}
                    </button>
                  ) : null}
                </div>
                <div style={dividerStyle} />
                <Row justifyBetween itemsCenter style={{ marginTop: 12 }}>
                  <Text text={t('available')} color="ticker_color2" size="xs" />
                  <Row style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Text text={showLongNumber(spendable)} color="ticker_color2" size="xs" wrap />
                    <Text text={` ${ticker}`} size="xs" style={{ color: 'rgba(255, 255, 255, 0.45)' }} disableTranslate wrap />
                  </Row>
                </Row>
              </Column>
              {amountInvalidVisible ? <Text text={t('enter_amount_greater_than_0')} size="xs" color="danger" /> : null}
            </Column>
          ) : null}

          <RGBDecodedInvoiceInfo
            invoice={invoice}
            decodedInvoice={decodedInvoice}
            ticker={ticker}
            assetId={assetId}
            invoiceAmount={invoiceAmount}
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
