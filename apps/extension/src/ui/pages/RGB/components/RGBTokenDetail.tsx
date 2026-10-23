import { Column, Tooltip } from '@/ui/components';
import { Line } from '@/ui/components/Line';
import { Section } from '@/ui/components/Section';
import { showLongNumber } from '@/ui/utils';
import {
  getRgbTokenPrecision,
  getRgbTotalAtomicAmount,
  toRgbDisplayAmount,
  useI18n
} from '@unisat/wallet-state';

export function RGBTokenDetail(props: {
  assetId: string;
  name: string;
  ticker: string;
  tokenInfo?: Record<string, unknown>;
  tokenBalance?: Record<string, unknown>;
  reservedSendAmount?: string;
  estimatedBalance?: string;
  otherLockedAmount?: string;
}) {
  const { t } = useI18n();
  const { assetId, name, ticker, tokenInfo, tokenBalance, reservedSendAmount, estimatedBalance, otherLockedAmount } = props;
  const precision = getRgbTokenPrecision(tokenBalance) || getRgbTokenPrecision(tokenInfo);
  const formatValue = (value: unknown) => {
    return value === undefined || value === null || value === '' ? '--' : value.toString();
  };
  const formatNumber = (value: unknown) => {
    if (value === undefined || value === null || value === '') return '--';
    return typeof value === 'string' || typeof value === 'number'
      ? showLongNumber(toRgbDisplayAmount(value, precision))
      : value.toString();
  };
  const total = formatNumber(getRgbTotalAtomicAmount(tokenBalance));
  const available = formatNumber(tokenBalance?.spendable);
  const pending = formatNumber(tokenBalance?.pending ?? '0');
  const locking = formatNumber(otherLockedAmount ?? tokenBalance?.lockedAmount ?? '0');
  return (
    <Column
      gap="lg"
      px="md"
      py="md"
      style={{
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 15
      }}
    >
      <Tooltip title={assetId} block>
        <Section title={t('asset_id')} value={assetId} showCopyIcon />
      </Tooltip>
      <Line />
      <Section title={t('name_label')} value={name} maxLength={Number.POSITIVE_INFINITY} wrapValue />
      <Line />
      <Section title={t('ticker')} value={ticker} maxLength={Number.POSITIVE_INFINITY} wrapValue />
      <Line />
      <Section title={t('precision_rgb')} value={formatValue(tokenInfo?.precision)} />
      <Line />
      <Section
        title={t('issued_supply_rgb')}
        value={formatNumber(tokenInfo?.issuedSupply)}
        maxLength={Number.POSITIVE_INFINITY}
        wrapValue
      />
      <Line />
      <Section title={t('schema_rgb')} value={formatValue(tokenInfo?.schema)} />
      <Line />
      <Section title={t(reservedSendAmount !== undefined && Number(tokenBalance?.pending || 0) === 0 ? 'rgb_current_balance' : 'total_balance')} value={total} maxLength={Number.POSITIVE_INFINITY} wrapValue />
      <Line />
      <Section title={t('available_balance')} value={available} maxLength={Number.POSITIVE_INFINITY} wrapValue />
      <Line />
      <Section title={t('pending')} value={pending} maxLength={Number.POSITIVE_INFINITY} wrapValue />
      <Line />
      {reservedSendAmount !== undefined && estimatedBalance !== undefined ? (
        <>
          <Section title={t('rgb_estimated_balance_after_send')} value={formatNumber(estimatedBalance)} maxLength={Number.POSITIVE_INFINITY} wrapValue />
          {otherLockedAmount !== '0' ? <Line /> : null}
        </>
      ) : null}
      {reservedSendAmount === undefined || otherLockedAmount !== '0' ? (
        <Section title={t('rgb_amount_locking')} value={locking} maxLength={Number.POSITIVE_INFINITY} wrapValue />
      ) : null}
    </Column>
  );
}
