import { BottomSheetHeader, Card, Column, Icon, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { useI18n } from '@unisat/wallet-state';

export function RgbReceiveSelectorModal({
  onClose,
  onViewInvoices,
  onCreateInvoice
}: {
  onClose: () => void;
  onViewInvoices: () => void;
  onCreateInvoice: () => void;
}) {
  const { t } = useI18n();

  return (
    <BottomModal onClose={onClose} bodyStyle={{ padding: 0 }}>
      <Column fullX gap="zero">
        <BottomSheetHeader title={t('receive_rgb')} onClose={onClose} />
        <Column fullX gap="sm" style={{ padding: '0 20px 24px', boxSizing: 'border-box' }}>
          <Card
            fullX
            itemsCenter
            onClick={onViewInvoices}
            data-testid="view-rgb-invoices-option"
            style={{ minHeight: 56, padding: '10px 12px', borderRadius: 10, cursor: 'pointer' }}
          >
            <Row itemsCenter gap="md" style={{ flex: 1 }}>
              <Icon icon="invoice" color="ticker_color2" size={20} />
              <Text text={t('pending_invoices')} size="sm" />
            </Row>
            <Icon icon="right" color="textDim" size={14} />
          </Card>
          <Card
            fullX
            itemsCenter
            onClick={onCreateInvoice}
            data-testid="create-rgb-invoice-option"
            style={{ minHeight: 56, padding: '10px 12px', borderRadius: 10, cursor: 'pointer' }}
          >
            <Row itemsCenter gap="md" style={{ flex: 1 }}>
              <Icon icon="rgb" color="ticker_color2" size={20} />
              <Text text={t('create_invoice')} size="sm" />
            </Row>
            <Icon icon="right" color="textDim" size={14} />
          </Card>
        </Column>
      </Column>
    </BottomModal>
  );
}
