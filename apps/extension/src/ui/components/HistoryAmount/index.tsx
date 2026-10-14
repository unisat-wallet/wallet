import { fontSizes } from '@/ui/theme/font';
import { showLongNumber } from '@/ui/utils';

import { Text } from '../Text';
import { Tooltip } from '../Tooltip';

const HISTORY_AMOUNT_MAX_LENGTH = 14;
const HISTORY_AMOUNT_MAX_DECIMALS = 4;

function getHistoryAmountDisplay(amount: string) {
  if (amount === '--') return { display: amount, fullText: amount, isTruncated: false };

  const fullText = showLongNumber(amount, -1);
  const normalized = fullText.replace(/,/g, '');

  if (fullText.length <= HISTORY_AMOUNT_MAX_LENGTH) {
    return { display: fullText, fullText, isTruncated: false };
  }

  if (normalized.includes('.')) {
    const [integerPart, decimalPart] = normalized.split('.');
    const integerDisplay = fullText.split('.')[0] ?? integerPart;

    if (decimalPart.length > HISTORY_AMOUNT_MAX_DECIMALS) {
      return {
        display: `${integerDisplay}.${decimalPart.slice(0, HISTORY_AMOUNT_MAX_DECIMALS)}...`,
        fullText,
        isTruncated: true
      };
    }
  }

  return {
    display: `${fullText.slice(0, HISTORY_AMOUNT_MAX_LENGTH)}...`,
    fullText,
    isTruncated: true
  };
}

export function HistoryAmount({ amount, color, textStyle }: { amount: string; color?: string; textStyle?: CSSProperties }) {
  const { display, fullText, isTruncated } = getHistoryAmountDisplay(amount);
  const amountText = (
    <Text text={display} ellipsis disableTranslate style={{ maxWidth: 140, textAlign: 'right', color, ...textStyle }} />
  );

  if (!isTruncated) return amountText;

  const tooltip = (
    <Tooltip title={fullText} overlayStyle={{ fontSize: fontSizes.xs }}>
      {amountText}
    </Tooltip>
  );
  // A flex wrapper avoids the inline-block tooltip's extra baseline space.
  return textStyle ? <div style={{ display: 'flex', alignItems: 'center' }}>{tooltip}</div> : tooltip;
}
import type { CSSProperties } from 'react';
