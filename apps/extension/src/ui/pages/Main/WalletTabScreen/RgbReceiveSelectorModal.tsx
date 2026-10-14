import { useEffect, useState } from 'react';

import { BottomSheetHeader, Card, Column, Icon, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { useChainType, useCurrentAccount, useCurrentKeyring, useI18n, useWallet } from '@unisat/wallet-state';

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
  const wallet = useWallet();
  const account = useCurrentAccount();
  const keyring = useCurrentKeyring();
  const chainType = useChainType();
  const [invoiceCount, setInvoiceCount] = useState<number | null>();
  const invoicesDisabled = invoiceCount === undefined || invoiceCount === 0;

  useEffect(() => {
    let active = true;
    setInvoiceCount(undefined);
    void wallet
      .getRgbPendingReceiveInvoices({ skipSync: true })
      .then(({ list }) => {
        if (active) setInvoiceCount(list.filter((invoice) => Boolean(invoice.invoice)).length);
      })
      .catch(() => {
        // Keep the list reachable when the count could not be loaded.
        if (active) setInvoiceCount(null);
      });
    return () => {
      active = false;
    };
  }, [wallet, account.key, keyring?.key, chainType]);

  return (
    <BottomModal onClose={onClose} bodyStyle={{ padding: 0 }}>
      <Column fullX gap="zero">
        <BottomSheetHeader title={t('receive_rgb')} onClose={onClose} />
        <Column fullX gap="sm" style={{ padding: '0 20px 24px', boxSizing: 'border-box' }}>
          <Card
            fullX
            itemsCenter
            onClick={invoicesDisabled ? undefined : onViewInvoices}
            data-testid="view-rgb-invoices-option"
            style={{
              minHeight: 56,
              padding: '10px 12px',
              borderRadius: 10,
              cursor: invoicesDisabled ? 'default' : 'pointer',
              opacity: invoicesDisabled ? 0.45 : 1
            }}
          >
            <Row itemsCenter gap="md" style={{ flex: 1 }}>
              <Icon icon="invoice" color="ticker_color2" size={20} />
              <Text
                text={typeof invoiceCount === 'number' ? `${t('pending_invoices')}(${invoiceCount})` : t('pending_invoices')}
                size="sm"
              />
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
