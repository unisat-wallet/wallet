import { useCallback, useEffect, useState } from 'react';

import { Button, Card, Column, Content, CopyableAddress, Header, Icon, Layout, RGBAssetIcon, Row, Text, Tooltip } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { HistoryAmount } from '@/ui/components/HistoryAmount';
import {
  findRgbAssetPolicy,
  toRgbDisplayAmount,
  useI18n,
  useNavigation,
  useTools,
  useWallet,
  useWalletConfig
} from '@unisat/wallet-state';

type UtxoInspection = Awaited<ReturnType<ReturnType<typeof useWallet>['getRgbUtxoInspection']>>;
type InspectedUtxo = NonNullable<UtxoInspection>['snapshot']['utxos'][number];
type InspectedAllocation = InspectedUtxo['allocations'][number];

const shortTxid = (txid: string) => (txid.length > 18 ? `${txid.slice(0, 10)}…${txid.slice(-6)}` : txid);

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
  padding: '8px 12px 10px 40px',
  borderRadius: '0 0 8px 8px',
  boxSizing: 'border-box' as const,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderTop: 0
};

const accountInfoCardStyle = {
  borderRadius: 10,
  padding: 0,
  overflow: 'hidden',
  minHeight: 120,
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

const assetAllocationCardStyle = {
  minHeight: 40,
  padding: '6px 8px',
  borderRadius: 6,
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxSizing: 'border-box' as const
};

const utxoSequenceStyle = {
  width: 20,
  minWidth: 20,
  textAlign: 'center' as const
};

const emptyStateCardStyle = {
  padding: '32px 16px',
  borderRadius: 8,
  boxSizing: 'border-box' as const,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)'
};

export default function RgbUtxoInspectionScreen() {
  const wallet = useWallet();
  const nav = useNavigation();
  const tools = useTools();
  const { t } = useI18n();
  const walletConfig = useWalletConfig();
  const [inspection, setInspection] = useState<UtxoInspection>();
  const [selectedUtxo, setSelectedUtxo] = useState<InspectedUtxo>();
  const [selectedAllocation, setSelectedAllocation] = useState<{
    utxo: InspectedUtxo;
    allocation: InspectedAllocation;
  }>();
  const [refreshing, setRefreshing] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const refresh = useCallback(
    async (showSuccess = false) => {
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
    },
    [t, tools, wallet]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const invoiceReservations = new Map(
    inspection?.invoiceReservations.map((item) => [`${item.txid}:${item.vout}`, item]) || []
  );
  const utxos = [...(inspection?.snapshot.utxos || [])].sort((left, right) => {
    const priority = (utxo: NonNullable<UtxoInspection>['snapshot']['utxos'][number]) => {
      if (utxo.allocations.length > 0) return 0;
      return invoiceReservations.has(`${utxo.outpoint.txid}:${utxo.outpoint.vout}`) ? 1 : 2;
    };
    const priorityDifference = priority(left) - priority(right);
    if (priorityDifference) return priorityDifference;
    return left.outpoint.txid.localeCompare(right.outpoint.txid) || left.outpoint.vout - right.outpoint.vout;
  });
  const selectedUtxoReservation = selectedUtxo
    ? invoiceReservations.get(`${selectedUtxo.outpoint.txid}:${selectedUtxo.outpoint.vout}`)
    : undefined;
  const selectedUtxoUsage = selectedUtxoReservation
    ? t('rgb_utxo_invoice_reserved')
    : selectedUtxo?.allocations.length
      ? t('rgb_utxo_has_assets')
      : t('rgb_utxo_available');
  const selectedAllocationPolicy = findRgbAssetPolicy(selectedAllocation?.allocation.assetId, walletConfig);
  const selectedAllocationMetadata = selectedAllocation
    ? inspection?.assetMetadata[selectedAllocation.allocation.assetId]
    : undefined;
  const selectedAllocationName = selectedAllocationPolicy?.displayName || selectedAllocationMetadata?.name ||
    selectedAllocationPolicy?.ticker || selectedAllocationMetadata?.ticker ||
    (selectedAllocation ? shortTxid(selectedAllocation.allocation.assetId) : '');
  const discardSelectedAllocation = async () => {
    if (!selectedAllocation) return;
    setDiscarding(true);
    try {
      await wallet.discardRgbUtxoAllocation({
        txid: selectedAllocation.utxo.outpoint.txid,
        vout: selectedAllocation.utxo.outpoint.vout,
        assetId: selectedAllocation.allocation.assetId,
        ...(selectedAllocation.allocation.opId ? { opId: selectedAllocation.allocation.opId } : {}),
        ...(selectedAllocation.allocation.assignmentIndex === undefined
          ? {}
          : { assignmentIndex: selectedAllocation.allocation.assignmentIndex })
      });
      setSelectedAllocation(undefined);
      await refresh();
      tools.toastSuccess(t('success'));
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setDiscarding(false);
    }
  };
  const repairSelectedAllocation = async () => {
    if (!selectedAllocation?.allocation.opId || selectedAllocation.allocation.assignmentIndex === undefined) return;
    setRepairing(true);
    try {
      const result = await wallet.repairRgbUtxoAllocationHistory({
        txid: selectedAllocation.utxo.outpoint.txid,
        vout: selectedAllocation.utxo.outpoint.vout,
        assetId: selectedAllocation.allocation.assetId,
        opId: selectedAllocation.allocation.opId,
        assignmentIndex: selectedAllocation.allocation.assignmentIndex
      });
      if (result.repaired) {
        setSelectedAllocation(undefined);
        await refresh();
        tools.toastSuccess(t('rgb_utxo_repair_success'));
      } else {
        setSelectedAllocation((current) => current ? {
          ...current,
          allocation: { ...current.allocation, repairFailed: true, discardable: true }
        } : current);
        await refresh();
        tools.toastError(result.reason);
      }
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setRepairing(false);
    }
  };
  return (
    <Layout>
      <Header onBack={() => window.history.go(-1)} title={t('rgb_asset_address')} />
      <Content>
        <Card style={accountInfoCardStyle}>
          <Column fullX gap="zero">
            <Row fullX itemsCenter justifyBetween gap="md" style={accountInfoRowStyle}>
              <Text text={t('address')} color="textDim" size="sm" style={{ flexShrink: 0 }} />
              {inspection ? (
                <Tooltip title={inspection.address} overlayStyle={{ maxWidth: 'calc(100vw - 32px)', overflowWrap: 'anywhere', boxSizing: 'border-box' }}>
                  <CopyableAddress address={inspection.address} copyPosition="after" color="ticker_color2" />
                </Tooltip>
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
          </Column>
        </Card>

        {utxos.map((utxo, index) => {
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
                onClick={() => setSelectedUtxo(utxo)}>
                <Text text={index + 1} color="textDim" size="sm" style={utxoSequenceStyle} />
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
                    <Column fullX gap="xs">
                      {utxo.allocations.map((allocation, index) => {
                        const asset = inspection?.assetMetadata[allocation.assetId];
                        const assetPolicy = findRgbAssetPolicy(allocation.assetId, walletConfig);
                        const ticker = assetPolicy?.ticker || asset?.ticker;
                        const name = assetPolicy?.displayName || asset?.name || ticker || shortTxid(allocation.assetId);
                        const amount = toRgbDisplayAmount(allocation.amount, asset?.precision || 0);
                        const historyMissing = allocation.historyAvailable === false ||
                          allocation.localHistoryAvailable === false;
                        return (
                          <Row
                            key={`${allocation.assetId}:${index}`}
                            fullX
                            itemsCenter
                            justifyBetween
                            gap="sm"
                            style={{
                              ...assetAllocationCardStyle,
                              ...(historyMissing || allocation.rejected
                                ? { border: '1px solid rgba(255,82,82,0.55)' }
                                : {}),
                              ...(allocation.discardable || allocation.repairable ? { cursor: 'pointer' } : {})
                            }}
                            onClick={allocation.discardable || allocation.repairable
                              ? () => {
                                  setSelectedUtxo(undefined);
                                  setSelectedAllocation({ utxo, allocation });
                                }
                              : undefined}>
                            <Row itemsCenter gap="sm" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                              <RGBAssetIcon
                                assetId={allocation.assetId}
                                ticker={ticker}
                                name={name}
                                size={20}
                              />
                              <Column gap="xs" style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                <Row itemsCenter gap="xs" style={{ minWidth: 0 }}>
                                  <Text text={name} color="white" size="xs" ellipsis style={{ minWidth: 0 }} />
                                  {assetPolicy?.status === 'deprecated' ? (
                                    <Text text={t('rgb_asset_deprecated')} color="gold" size="xxs" />
                                  ) : null}
                                </Row>
                                <CopyableAddress
                                  address={allocation.assetId}
                                  copyPosition="after"
                                  len={6}
                                  color="textDim"
                                />
                              </Column>
                            </Row>
                            <Column itemsEnd gap="xs" style={{ flexShrink: 0, marginLeft: 8 }}>
                              <HistoryAmount amount={amount} color="white" />
                              {historyMissing ? (
                                <Text text={t('rgb_utxo_history_missing')} color="red" size="xxs" />
                              ) : null}
                              {allocation.rejected ? (
                                <Text text={t('rgb_utxo_rejected_allocation')} color="red" size="xxs" />
                              ) : null}
                              {allocation.repairable && !allocation.rejected && !allocation.repairFailed ? (
                                <Text text={t('rgb_utxo_repair_history')} color="gold" size="xxs" />
                              ) : null}
                              {allocation.discardable ? (
                                <Text text={t('rgb_utxo_remove_allocation')} color="red" size="xxs" />
                              ) : null}
                            </Column>
                          </Row>
                        );
                      })}
                    </Column>
                  ) : null}
                </Column>
              ) : null}
            </Column>
          );
        })}
        {inspection && !utxos.length ? (
          <Column fullX itemsCenter gap="sm" style={emptyStateCardStyle}>
            <Icon icon="emptyBox" color="textDim" size={32} />
            <Text text={t('rgb_utxo_empty')} color="white" size="sm" />
            <Text text={t('rgb_utxo_empty_description')} color="textDim" size="xs" textCenter wrap />
          </Column>
        ) : null}
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
      {selectedUtxo ? (
        <BottomModal onClose={() => setSelectedUtxo(undefined)}>
          <Column gap="lg">
            <Text text="UTXO" color="white" size="lg" textCenter disableTranslate />
            <Column
              gap="md"
              fullX
              style={{ padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.06)' }}>
              <Row justifyBetween itemsCenter fullX gap="md">
                <Text text={t('transaction_id')} color="textDim" size="sm" />
                <CopyableAddress
                  address={selectedUtxo.outpoint.txid}
                  copyPosition="after"
                  len={8}
                  color="ticker_color2"
                />
              </Row>
              <Row justifyBetween itemsCenter fullX gap="md">
                <Text text="Vout" color="textDim" size="sm" disableTranslate />
                <Text text={selectedUtxo.outpoint.vout} color="white" size="sm" disableTranslate />
              </Row>
              <Row justifyBetween itemsCenter fullX gap="md">
                <Text text={t('amount')} color="textDim" size="sm" />
                <Text text={`${selectedUtxo.satoshis.toLocaleString()} sats`} color="white" size="sm" disableTranslate />
              </Row>
              <Row justifyBetween itemsCenter fullX gap="md">
                <Text text={t('status')} color="textDim" size="sm" />
                <Text text={selectedUtxoUsage} color="white" size="sm" />
              </Row>
            </Column>
            <Button
              preset="primary"
              text={t('view_on_uniscan')}
              onClick={() => {
                const txid = selectedUtxo.outpoint.txid;
                setSelectedUtxo(undefined);
                nav.navToExplorerTx(txid);
              }}
            />
          </Column>
        </BottomModal>
      ) : null}
      {selectedAllocation ? (
        <BottomModal onClose={() => !discarding && !repairing && setSelectedAllocation(undefined)}>
          <Column gap="lg">
            <Text
              text={t(selectedAllocation.allocation.rejected || selectedAllocation.allocation.discardable && !selectedAllocation.allocation.repairable
                ? 'rgb_utxo_remove_allocation_title'
                : 'rgb_utxo_repair_history_title')}
              color="white"
              size="lg"
              textCenter
            />
            <Text
              text={t(selectedAllocation.allocation.rejected || !selectedAllocation.allocation.repairable
                ? 'rgb_utxo_remove_allocation_description'
                : selectedAllocation.allocation.repairFailed
                  ? 'rgb_utxo_repair_failed_description'
                  : 'rgb_utxo_repair_history_description')}
              color="textDim"
              size="sm"
              textCenter
              wrap
            />
            <Column gap="sm" fullX style={{ padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.06)' }}>
              <Row itemsCenter gap="xs">
                <Text text={selectedAllocationName} color="white" size="sm" />
                {selectedAllocationPolicy?.status === 'deprecated' ? (
                  <Text text={t('rgb_asset_deprecated')} color="gold" size="xxs" />
                ) : null}
              </Row>
              <CopyableAddress
                address={selectedAllocation.allocation.assetId}
                copyPosition="after"
                len={8}
                color="ticker_color2"
              />
              <Text
                text={`${shortTxid(selectedAllocation.utxo.outpoint.txid)}:${selectedAllocation.utxo.outpoint.vout}`}
                color="textDim"
                size="xs"
                disableTranslate
              />
            </Column>
            {selectedAllocation.allocation.repairable && !selectedAllocation.allocation.rejected ? (
              <Button
                preset="primary"
                text={t(selectedAllocation.allocation.repairFailed ? 'retry' : 'rgb_utxo_repair_history')}
                disabled={repairing || discarding}
                onClick={() => void repairSelectedAllocation()}
              />
            ) : null}
            {selectedAllocation.allocation.discardable ? (
              <Button
                preset="danger"
                text={t('rgb_utxo_remove_allocation_confirm')}
                disabled={discarding || repairing}
                onClick={() => void discardSelectedAllocation()}
              />
            ) : null}
          </Column>
        </BottomModal>
      ) : null}
    </Layout>
  );
}
