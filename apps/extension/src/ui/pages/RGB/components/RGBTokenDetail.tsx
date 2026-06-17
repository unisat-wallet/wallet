import { Column } from '@/ui/components';
import { Line } from '@/ui/components/Line';
import { Section } from '@/ui/components/Section';
import { showLongNumber } from '@/ui/utils';
import { useI18n } from '@unisat/wallet-state';

export function RGBTokenDetail(props: {
  assetId: string;
  name: string;
  ticker: string;
  tokenInfo?: Record<string, unknown>;
  tokenBalance?: Record<string, unknown>;
}) {
  const { t } = useI18n();
  const { assetId, name, ticker, tokenInfo, tokenBalance } = props;
  const formatValue = (value: unknown) => {
    return value === undefined || value === null || value === '' ? '--' : value.toString();
  };
  const formatNumber = (value: unknown) => {
    if (value === undefined || value === null || value === '') return '--';
    return typeof value === 'string' || typeof value === 'number' ? showLongNumber(value) : value.toString();
  };
  const settled = formatNumber(tokenBalance?.settled);
  const pending = formatNumber(tokenBalance?.pending);

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
      <Section title={t('asset_id')} value={assetId} showCopyIcon />
      <Line />
      <Section title={t('name_label')} value={name} />
      <Line />
      <Section title={t('ticker')} value={ticker} />
      <Line />
      <Section title={t('precision_rgb')} value={formatValue(tokenInfo?.precision)} />
      <Line />
      <Section title={t('issued_supply_rgb')} value={formatNumber(tokenInfo?.issuedSupply)} />
      <Line />
      <Section title={t('schema_rgb')} value={formatValue(tokenInfo?.schema)} />
      <Line />
      <Section title={t('settled')} value={settled} />
      <Line />
      <Section title={t('pending')} value={pending} />
    </Column>
  );
}
