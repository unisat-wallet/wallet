import { useCallback, useEffect, useState } from 'react';

import { Button, Card, Column, Content, CopyableAddress, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { useI18n, useNavigation, useTools, useWallet } from '@unisat/wallet-state';

type UtxoInspection = Awaited<ReturnType<ReturnType<typeof useWallet>['getRgbUtxoInspection']>>;

const shortTxid = (txid: string) => (txid.length > 18 ? `${txid.slice(0, 10)}…${txid.slice(-6)}` : txid);

const displaySyncTime = (syncedAt: number) =>
  syncedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' }).format(syncedAt) : '—';

const utxoCardStyle = {
  minHeight: 72,
  padding: '10px 12px',
  borderRadius: 8,
  boxSizing: 'border-box' as const,
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.12)',
  cursor: 'pointer'
};

const utxoCardWithDetailsStyle = {
  ...utxoCardStyle,
  borderBottomLeftRadius: 0,
  borderBottomRightRadius: 0
};

const utxoDetailsCardStyle = {
  padding: '8px 12px 10px 52px',
  borderRadius: '0 0 8px 8px',
  boxSizing: 'border-box' as const,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderTop: 0
};

const summaryRowStyle = {
  minHeight: 52,
  padding: '0 16px',
  boxSizing: 'border-box' as const
};

const accountInfoCardStyle = {
  borderRadius: 10,
  padding: 0,
  overflow: 'hidden',
  minHeight: 211,
  boxSizing: 'border-box' as const
};

const accountInfoRowStyle = {
  minHeight: 52,
  padding: '0 16px',
  boxSizing: 'border-box' as const
};

const statusPillStyle = (kind: 'invoice' | 'assets' | 'available') => ({
  height: 20,
  padding: '0 6px',
  borderRadius: 3,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box' as const,
  background:
    kind === 'invoice'
      ? 'rgba(244,182,44,0.18)'
      : kind === 'assets'
      ? 'rgba(42,178,248,0.16)'
      : 'rgba(255,255,255,0.10)'
});

const allocationPillStyle = {
  maxWidth: '100%',
  height: 20,
  padding: '0 6px',
  borderRadius: 3,
  background: 'rgba(255,255,255,0.10)',
  display: 'inline-flex',
  alignItems: 'center',
  boxSizing: 'border-box' as const
};

export default function RgbUtxoInspectionScreen() {
  const wallet = useWallet();
  const nav = useNavigation();
  const tools = useTools();
  const { t } = useI18n();
  const [inspection, setInspection] = useState<UtxoInspection>();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (showSuccess = false) => {
    setRefreshing(true);
    try {
      setInspection(await wallet.getRgbUtxoInspection({ forceSync: true }));
      if (showSuccess) {
        tools.toastSuccess(t('success'));
      }
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }, [t, tools, wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const invoiceReservations = new Map(
    inspection?.invoiceReservations.map(item => [`${item.txid}:${item.vout}`, item]) || []
  );
  const utxos = inspection?.snapshot.utxos || [];
  const assetUtxoCount = utxos.filter((item) => item.allocations.length > 0).length;

  return (
    <Layout>
      <Header onBack={() => window.history.go(-1)} title={t('rgb_asset_address')} />
      <Content>
        <Card style={accountInfoCardStyle}>
          <Column fullX gap="zero">
            <Row fullX itemsCenter justifyBetween gap="md" style={accountInfoRowStyle}>
              <Text text={t('address')} color="textDim" size="sm" style={{ flexShrink: 0 }} />
              {inspection ? (
                <CopyableAddress address={inspection.address} copyPosition="after" color="ticker_color2" />
              ) : (
                <Text text="—" color="white" size="xs" />
              )}
            </Row>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
            <Row fullX itemsCenter justifyBetween gap="md" style={accountInfoRowStyle}>
              <Text text={t('derivation_path')} color="textDim" size="sm" style={{ flexShrink: 0 }} />
              <Text
                text={inspection?.derivationPath || '—'}
                selectText
                color="white"
                size="xs"
                ellipsis
                textEnd
                style={{ flex: 1, minWidth: 0 }}
              />
            </Row>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
            <Row fullX itemsCenter justifyBetween gap="md" style={summaryRowStyle}>
              <Text text={t('rgb_utxo_summary')} color="textDim" size="sm" />
              <Text text={displaySyncTime(inspection?.snapshot.syncedAt || 0)} color="textDim" size="xs" />
            </Row>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
            <Row fullX itemsCenter style={summaryRowStyle}>
              <Text
                text={t('rgb_utxo_summary_counts', {
                  utxos: utxos.length,
                  assets: assetUtxoCount,
                  invoices: inspection?.invoiceReservations.length || 0
                })}
                color="white"
                size="xs"
                wrap
              />
            </Row>
          </Column>
        </Card>

        {utxos.map((utxo) => {
          const key = `${utxo.outpoint.txid}:${utxo.outpoint.vout}`;
          const reservation = invoiceReservations.get(key);
          const hasAssets = utxo.allocations.length > 0;
          const usage = reservation
            ? t('rgb_utxo_invoice_reserved')
            : hasAssets
            ? t('rgb_utxo_has_assets')
            : t('rgb_utxo_available');
          const usageKind = reservation ? 'invoice' : hasAssets ? 'assets' : 'available';
          const hasDetails = Boolean(reservation || hasAssets);

          return (
            <Column key={key} fullX gap="zero">
              <Row
                itemsCenter
                gap="md"
                style={hasDetails ? utxoCardWithDetailsStyle : utxoCardStyle}
                onClick={() => nav.navToExplorerTx(utxo.outpoint.txid)}>
                <Icon icon="utxo" color={reservation ? 'gold' : 'white_muted'} size={32} />
                <Column fullX gap="xs" style={{ minWidth: 0 }}>
                  <Row full justifyBetween itemsCenter gap="sm">
                    <Text
                      text={`${shortTxid(utxo.outpoint.txid)}:${utxo.outpoint.vout}`}
                      color="white"
                      preset="bold"
                      size="sm"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <Row gap="sm" itemsCenter>
                      <div style={statusPillStyle(usageKind)}>
                        <Text text={usage} color={reservation ? 'gold' : 'textDim'} size="xxs" />
                      </div>
                      <Icon icon="right" color="textDim" size={14} />
                    </Row>
                  </Row>
                  <Text text={`${utxo.satoshis.toLocaleString()} sats`} color="textDim" size="xs" />
                </Column>
              </Row>
              {hasDetails ? (
                <Column fullX gap="sm" style={utxoDetailsCardStyle}>
                  {reservation ? (
                    <Row
                      itemsCenter
                      justifyBetween
                      gap="sm"
                      onClick={() =>
                        nav.navigate('RGBInvoiceDetailScreen', {
                          recipientId: reservation.recipientId,
                          invoice: reservation.invoice
                        })
                      }>
                      <Row itemsCenter gap="sm" style={{ minWidth: 0 }}>
                        <Icon icon="invoice" color="gold" size={18} />
                        <Column gap="xs" style={{ minWidth: 0 }}>
                          <Text text={t('rgb_utxo_invoice_reserved')} color="gold" size="xs" />
                          <Text
                            text={`${t('recipient')}: ${shortTxid(reservation.recipientId)}`}
                            color="textDim"
                            size="xs"
                          />
                        </Column>
                      </Row>
                      <Icon icon="right" color="textDim" size={14} />
                    </Row>
                  ) : null}
                  {hasAssets ? (
                    <Row gap="xs" style={{ flexWrap: 'wrap' }}>
                      {utxo.allocations.map((allocation, index) => (
                        <div key={`${allocation.assetId}:${index}`} style={allocationPillStyle}>
                          <Text
                            text={`${shortTxid(allocation.assetId)} · ${allocation.amount}`}
                            selectText
                            color="textDim"
                            size="xxs"
                          />
                        </div>
                      ))}
                    </Row>
                  ) : null}
                </Column>
              ) : null}
            </Column>
          );
        })}

      </Content>
      <Row style={{ padding: '0 16px 16px' }}>
        <Button
          text={t('refresh')}
          preset="primary"
          disabled={refreshing}
          onClick={() => void refresh(true)}
          style={{ flex: 1 }}
        />
      </Row>
    </Layout>
  );
}
