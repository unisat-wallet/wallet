import { useEffect, useState } from 'react';

import { BottomSheetHeader, Card, Column, Icon, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { isInvoiceForAsset, useChainType, useCurrentAccount, useCurrentKeyring, useI18n, useWallet } from '@unisat/wallet-state';

function SelectorChevron() {
  return <Icon icon="right" size={20} style={{ backgroundColor: 'rgba(255, 255, 255, 0.65)' }} />;
}

export function RgbReceiveSelectorModal({
  onClose,
  onViewInvoices,
  onCreateInvoice,
  assetId
}: {
  onClose: () => void;
  onViewInvoices: () => void;
  onCreateInvoice: () => void;
  assetId?: string;
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
        if (active) setInvoiceCount(list.filter((invoice) => Boolean(invoice.invoice) && isInvoiceForAsset(invoice, assetId)).length);
      })
      .catch(() => {
        // Keep the list reachable when the count could not be loaded.
        if (active) setInvoiceCount(null);
      });
    return () => {
      active = false;
    };
  }, [wallet, account.key, keyring?.key, chainType, assetId]);

  return (
    <BottomModal onClose={onClose} bodyStyle={{ padding: 0 }}>
      <Column fullX gap="zero">
        <BottomSheetHeader title={t('receive_rgb')} onClose={onClose} />
        <Column fullX gap="lg" style={{ padding: '0 20px 24px', boxSizing: 'border-box' }}>
          <Card
            fullX
            itemsCenter
            onClick={invoicesDisabled ? undefined : onViewInvoices}
            data-testid="view-rgb-invoices-option"
            style={{
              minHeight: 64,
              height: 64,
              padding: '10px 12px',
              borderRadius: 10,
              cursor: invoicesDisabled ? 'default' : 'pointer',
              opacity: invoicesDisabled ? 0.45 : 1,
              boxSizing: 'border-box'
            }}
          >
            <Row itemsCenter gap="md" style={{ flex: 1, minWidth: 0 }}>
              <Icon icon="invoice" color="ticker_color2" size={20} />
              <Column gap="zero" style={{ flex: 1, minWidth: 0 }}>
                <Text text={t('rgb_invoices')} size="sm" />
                <Text text={t('share_existing_rgb_invoice')} size="xs" color="textDim" style={{ marginTop: 2 }} />
              </Column>
            </Row>
            {typeof invoiceCount === 'number' ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 20,
                  height: 20,
                  padding: '0 6px',
                  borderRadius: 999,
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  boxSizing: 'border-box',
                  flexShrink: 0
                }}
              >
                <Text text={String(invoiceCount)} size="xs" style={{ lineHeight: '20px' }} />
              </div>
            ) : null}
            <SelectorChevron />
          </Card>
          <Card
            fullX
            itemsCenter
            onClick={onCreateInvoice}
            data-testid="create-rgb-invoice-option"
            style={{
              minHeight: 64,
              height: 64,
              padding: '10px 12px',
              borderRadius: 10,
              cursor: 'pointer',
              boxSizing: 'border-box'
            }}
          >
            <Row itemsCenter gap="md" style={{ flex: 1, minWidth: 0 }}>
              <Icon icon="plus" size={20} containerStyle={{ opacity: 0.85, flexShrink: 0 }} />
              <Column gap="zero" style={{ flex: 1, minWidth: 0 }}>
                <Text text={t('create_rgb_invoice')} size="sm" />
                <Text text={t('create_new_rgb_invoice_to_share')} size="xs" color="textDim" style={{ marginTop: 2 }} />
              </Column>
            </Row>
            <SelectorChevron />
          </Card>
        </Column>
      </Column>
    </BottomModal>
  );
}
