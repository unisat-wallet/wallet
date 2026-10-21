type Translate = (key: string, values?: Record<string, string>) => string;

export const formatRgbInvoiceExpiryTime = (expirationTimestamp: number | undefined, locale: string, t: Translate) => {
  if (expirationTimestamp === undefined) return t('rgb_invoice_never_expires');

  const expiresAt = expirationTimestamp > 1_000_000_000_000 ? expirationTimestamp : expirationTimestamp * 1000;
  const remainingSeconds = Math.ceil((expiresAt - Date.now()) / 1000);
  if (remainingSeconds <= 0) return t('rgb_invoice_expired');

  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    remainingSeconds >= 86_400
      ? [Math.ceil(remainingSeconds / 86_400), 'day']
      : remainingSeconds >= 3_600
      ? [Math.ceil(remainingSeconds / 3_600), 'hour']
      : [Math.max(1, Math.ceil(remainingSeconds / 60)), 'minute'];
  const relativeTime = new Intl.RelativeTimeFormat(locale.replace('_', '-'), { numeric: 'always' }).format(value, unit);
  return t('rgb_invoice_expires', { time: relativeTime });
};
