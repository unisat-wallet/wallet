import { useCallback, useEffect, useState } from 'react';

import { Button, Card, Column, Content, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
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

const utxoIconStyle = {
  width: 36,
  height: 36,
  minWidth: 36,
  borderRadius: 8,
  background: 'rgba(255,255,255,0.10)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setInspection(await wallet.getRgbUtxoInspection({ forceSync: true }));
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }, [tools, wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const invoiceReservations = new Map(
    inspection?.invoiceReservations.map((item) => [`${item.txid}:${item.vout}`, item]) || []
  );
  const utxos = inspection?.snapshot.utxos || [];
  const assetUtxoCount = utxos.filter((item) => item.allocations.length > 0).length;

  return (
    <Layout>
      <Header onBack={() => window.history.go(-1)} title={t('rgb_utxo_status')} />
      <Content>
        <Card style={{ borderRadius: 10 }}>
          <Column fullX gap="sm">
            <Row full justifyBetween>
              <Text text={t('rgb_utxo_summary')} preset="bold" size="sm" />
              <Text text={displaySyncTime(inspection?.snapshot.syncedAt || 0)} color="textDim" size="xs" />
            </Row>
            <Text
              text={t('rgb_utxo_summary_counts', {
                utxos: utxos.length,
                assets: assetUtxoCount,
                invoices: inspection?.invoiceReservations.length || 0
              })}
              color="textDim"
              size="xs"
            />
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

          return (
            <Row
              key={key}
              itemsCenter
              gap="md"
              style={utxoCardStyle}
              onClick={() => nav.navToExplorerTx(utxo.outpoint.txid)}>
              <div style={utxoIconStyle}>
                <Icon icon="utxo" color={reservation ? 'gold' : 'white_muted'} size={20} />
              </div>
              <Column fullX gap="xs" style={{ minWidth: 0 }}>
                <Row full justifyBetween itemsCenter gap="sm">
                  <Text text={`UTXO #${utxo.outpoint.vout}`} color="white" preset="bold" size="sm" />
                  <Row gap="sm" itemsCenter>
                    <div style={statusPillStyle(usageKind)}>
                      <Text text={usage} color={reservation ? 'gold' : 'textDim'} size="xxs" />
                    </div>
                    <Icon icon="right" color="textDim" size={14} />
                  </Row>
                </Row>
                <Text
                  text={`${shortTxid(utxo.outpoint.txid)}:${utxo.outpoint.vout}`}
                  selectText
                  color="textDim"
                  size="xs"
                />
                <Text
                  text={t('rgb_utxo_chain_status', {
                    status: utxo.chainStatus || 'unknown',
                    confirmations: utxo.confirmations || 0,
                    sats: utxo.satoshis
                  })}
                  color="textDim"
                  size="xs"
                />
                {reservation ? (
                  <Text
                    text={`${t('recipient')}: ${shortTxid(reservation.recipientId)}`}
                    selectText
                    color="textDim"
                    size="xs"
                  />
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
            </Row>
          );
        })}

        {inspection && !utxos.length ? <Text text={t('rgb_utxo_empty')} color="textDim" textCenter size="sm" /> : null}
      </Content>
      <Footer>
        <Button full text={t('refresh')} preset="primary" disabled={refreshing} onClick={refresh} />
      </Footer>
    </Layout>
  );
}
