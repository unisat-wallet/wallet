import { Column, Text } from '@/ui/components';
import { IS_DEVELOPMENT } from '@/ui/utils';
import { useI18n, type DecodedRgbInvoice } from '@unisat/wallet-state';

const decodedInfoStyle = {
  backgroundColor: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10
};

function DecodedInvoiceRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;

  return (
    <Column gap="xs">
      <Text text={label} size="xs" color="white_muted" />
      <Text text={value} size="xs" color="white" wrap />
    </Column>
  );
}

type RGBDecodedInvoiceInfoProps = {
  invoice: string;
  decodedInvoice: DecodedRgbInvoice;
  ticker: string;
  assetId: string;
  invoiceAmount?: string;
  invoiceAssetId?: string;
  invoiceAssetMismatch: boolean;
  invoiceInvalid: boolean;
};

export function RGBDecodedInvoiceInfo({
  invoice,
  decodedInvoice,
  ticker,
  assetId,
  invoiceAmount,
  invoiceAssetId,
  invoiceAssetMismatch,
  invoiceInvalid
}: RGBDecodedInvoiceInfoProps) {
  const { t } = useI18n();

  if (!IS_DEVELOPMENT || !invoice.trim()) return null;

  return (
    <Column gap="sm" px="md" py="md" style={decodedInfoStyle}>
      <Text text={t('decoded_invoice')} preset="regular" />
      {invoiceInvalid ? <Text text={t('invalid_rgb_invoice')} size="xs" color="danger" wrap /> : null}
      {invoiceAssetMismatch ? (
        <Text text={t('invoice_asset_mismatch')} size="xs" color="danger" wrap />
      ) : null}
      <DecodedInvoiceRow label={t('type')} value={decodedInvoice.invoiceType} />
      <DecodedInvoiceRow label={t('network')} value={decodedInvoice.network} />
      <DecodedInvoiceRow label={t('amount')} value={invoiceAmount ? `${invoiceAmount} ${ticker}` : t('any_amount')} />
      <DecodedInvoiceRow label={t('asset_id')} value={invoiceAssetId || assetId} />
      <DecodedInvoiceRow label={t('recipient')} value={decodedInvoice.recipientId} />
      <DecodedInvoiceRow label={t('assignment')} value={decodedInvoice.assignmentName || decodedInvoice.assignmentKind} />
      <DecodedInvoiceRow label={t('endpoint')} value={decodedInvoice.transportEndpoints.join(', ')} />
    </Column>
  );
}
