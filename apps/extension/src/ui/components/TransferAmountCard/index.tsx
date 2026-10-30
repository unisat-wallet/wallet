import { BigNumber } from 'bignumber.js';
import { CSSProperties, ReactNode } from 'react';

import { colors } from '@/ui/theme/colors';
import { fontSizes } from '@/ui/theme/font';
import { useI18n } from '@unisat/wallet-state';

import { Column } from '../Column';
import { Icon } from '../Icon';
import { Row } from '../Row';
import { Text } from '../Text';
import { Tooltip } from '../Tooltip';

const amountCardStyle: CSSProperties = {
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(255,255,255,0.06)',
  padding: '0 16px 12px',
  boxSizing: 'border-box'
};

export const sendInputContainerStyle: CSSProperties = {
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(255,255,255,0.06)',
  boxSizing: 'border-box'
};

const amountInputSectionStyle: CSSProperties = {
  height: 76,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%'
};

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  height: 54,
  background: 'transparent',
  border: 'none',
  color: '#fff',
  padding: 0,
  outline: 'none',
  fontSize: 20
};

const maxButtonStyle: CSSProperties = {
  height: 28,
  minWidth: 56,
  borderRadius: 8,
  border: '1px solid rgba(244, 182, 44, 0.45)',
  color: 'rgba(244, 182, 44, 0.85)',
  background: 'transparent',
  fontSize: 14,
  cursor: 'pointer',
  justifyContent: 'center',
  textAlign: 'center'
};

const amountActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0
};

const clearButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  minWidth: 28,
  border: 'none',
  borderRadius: 14,
  background: 'rgba(255,255,255,0.08)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0
};

const unlockButtonStyle: CSSProperties = {
  height: 24,
  minWidth: 56,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid rgba(244, 182, 44, 0.45)',
  color: 'rgba(244, 182, 44, 0.85)',
  background: 'transparent',
  fontSize: 12,
  cursor: 'pointer'
};

const dividerStyle: CSSProperties = {
  height: 1,
  background: 'rgba(255,255,255,0.12)',
  width: '100%'
};

const fieldHeaderStyle: CSSProperties = {
  minHeight: 26,
  alignItems: 'center'
};

function isValidAmountInput(value: string, options: { disableDecimal?: boolean; decimalPlaces?: number; runesDecimal?: number }) {
  if (value === '') return true;

  if (options.disableDecimal) {
    return /^[1-9]\d*$/.test(value);
  }

  const decimalPlaces = options.decimalPlaces ?? options.runesDecimal;
  if (decimalPlaces !== undefined) {
    const regex = new RegExp(`^(0(\\.\\d{0,${decimalPlaces}})?|[1-9]\\d*\\.?\\d{0,${decimalPlaces}})$`);
    return regex.test(value);
  }

  return /^(0(\.\d{0,8})?|[1-9]\d*\.?\d{0,8})$/.test(value);
}

function normalizeAmountValue(value: string) {
  return value.replace(/,/g, '').trim();
}

function formatAmountValue(value: string) {
  const normalizedValue = normalizeAmountValue(value);
  if (normalizedValue === '') return '';

  const amount = new BigNumber(normalizedValue);
  if (!amount.isFinite()) return value;

  const [integerPart, decimalPart] = normalizedValue.split('.');
  const integerPartWithCommas = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (normalizedValue.includes('.')) {
    return `${integerPartWithCommas}.${decimalPart ?? ''}`;
  }

  return integerPartWithCommas;
}

function isAmountGreaterThanAvailable(value: string, availableAmount: string) {
  if (value === '') return false;

  const inputAmount = new BigNumber(normalizeAmountValue(value));
  const maxAmount = new BigNumber(normalizeAmountValue(availableAmount));

  if (!inputAmount.isFinite() || !maxAmount.isFinite()) {
    return false;
  }

  return inputAmount.gt(maxAmount);
}

export type TransferAmountCardProps = {
  amount: string;
  onAmountChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  showMax?: boolean;
  onMaxClick?: () => void;
  availableAmount: string;
  unit: string;
  amountMuted?: boolean;
  decimalPlaces?: number;
  runesDecimal?: number;
  disableDecimal?: boolean;
  inputTestId?: string;
  error?: string;
  footer?: ReactNode;
  availableExtra?: ReactNode;
};

export type TransferAmountUnavailableRowProps = {
  amount: string;
  unit: string;
  tipText: string;
  showUnlock?: boolean;
  onUnlock?: () => void;
};

export function TransferAmountUnavailableRow({
  amount,
  unit,
  tipText,
  showUnlock = false,
  onUnlock
}: TransferAmountUnavailableRowProps) {
  const { t } = useI18n();

  return (
    <Row justifyBetween fullX itemsCenter style={{ marginTop: 12 }}>
      <Row itemsCenter gap="md">
        <Tooltip
          title={tipText}
          placement="top"
          autoAdjustOverflow={true}
          align={{
            overflow: {
              adjustX: true,
              adjustY: true
            }
          }}
          overlayStyle={{
            fontSize: fontSizes.xs,
            maxWidth: '280px',
            wordWrap: 'break-word',
            whiteSpace: 'normal'
          }}>
          <Row itemsCenter gap="xs">
            <Text text={t('unavailable')} color="ticker_color2" size="xs" />
            <Icon icon="circle-question" color="textDim" size={12} />
          </Row>
        </Tooltip>
        {showUnlock ? (
          <button type="button" style={unlockButtonStyle} onClick={onUnlock}>
            {t('unlock')}
          </button>
        ) : null}
      </Row>
      <Row style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Text text={amount} color="ticker_color2" size="xs" wrap />
        <Text text={` ${unit}`} size="xs" style={{ color: 'rgba(255, 255, 255, 0.45)' }} disableTranslate wrap />
      </Row>
    </Row>
  );
}

export function TransferAmountSection(props: { title?: string; titleExtra?: ReactNode; children: ReactNode }) {
  const { t } = useI18n();

  return (
    <Column gap="sm">
      <Row justifyBetween style={fieldHeaderStyle}>
        <Text text={props.title || t('transfer_amount')} />
        {props.titleExtra}
      </Row>
      {props.children}
    </Column>
  );
}

export function TransferAmountCard({
  amount,
  onAmountChange,
  placeholder = '0',
  readOnly = false,
  showMax = false,
  onMaxClick,
  availableAmount,
  unit,
  amountMuted = false,
  decimalPlaces,
  runesDecimal,
  disableDecimal,
  inputTestId,
  error,
  footer,
  availableExtra
}: TransferAmountCardProps) {
  const { t } = useI18n();
  const inputColor = readOnly || amountMuted ? 'rgba(255, 255, 255, 0.45)' : '#fff';
  const amountExceeded = isAmountGreaterThanAvailable(amount, availableAmount);
  const displayAmount = formatAmountValue(amount);
  const displayAvailableAmount = formatAmountValue(availableAmount) || availableAmount;
  const resolvedAmountCardStyle = {
    ...amountCardStyle,
    borderColor: amountExceeded ? colors.danger : 'rgba(255,255,255,0.14)'
  };
  const amountError = error || (amountExceeded ? t('insufficient_balance') : '');

  return (
    <>
      <Column gap="zero" style={resolvedAmountCardStyle}>
        <div style={amountInputSectionStyle}>
          <input
            value={displayAmount}
            onChange={(e) => {
              if (readOnly) return;
              const value = normalizeAmountValue(e.target.value);
              if (isValidAmountInput(value, { disableDecimal, decimalPlaces, runesDecimal })) {
                onAmountChange(value);
              }
            }}
            placeholder={placeholder}
            inputMode={(decimalPlaces ?? runesDecimal ?? 0) > 0 ? 'decimal' : 'numeric'}
            readOnly={readOnly}
            style={{ ...inputStyle, flex: 1, color: inputColor }}
            data-testid={inputTestId}
          />
          <div style={amountActionsStyle}>
            {amount && !readOnly ? (
              <button
                type="button"
                data-testid={inputTestId ? `${inputTestId}-clear-button` : undefined}
                style={clearButtonStyle}
                onClick={() => onAmountChange('')}
                aria-label="Clear amount">
                <Icon icon="close" size={10} color="textDim" />
              </button>
            ) : null}
            {showMax ? (
              <button
                type="button"
                data-testid={inputTestId ? `${inputTestId}-max-button` : undefined}
                style={maxButtonStyle}
                onClick={onMaxClick}>
                {t('max')}
              </button>
            ) : null}
          </div>
        </div>
        <div style={dividerStyle} />
        <Row justifyBetween itemsCenter style={{ marginTop: 12 }}>
          <Text text={t('available')} color="ticker_color2" size="xs" />
          <Row style={{ flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
            <Text text={displayAvailableAmount} color="ticker_color2" size="xs" wrap />
            <Text text={` ${unit}`} size="xs" style={{ color: 'rgba(255, 255, 255, 0.45)' }} disableTranslate wrap />
            {availableExtra}
          </Row>
        </Row>
        {footer}
      </Column>
      {/* {amountError ? (
        <Row fullX style={{ marginTop: 8 }}>
          <Text text={amountError} color="error" size="xs" wrap />
        </Row>
      ) : null} */}
    </>
  );
}
