import { useCallback, useEffect, useState } from 'react';

import { Button, Card, Column, Content, CopyableAddress, Header, Icon, Layout, Row, Text, Tooltip } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { Tabs } from '@/ui/components/Tabs';
import LoadingPage from '@/ui/components/LoadingPage';
import { LoadingOutlined } from '@ant-design/icons';
import { SignedData, ToSignData } from '@unisat/wallet-shared';
import { useI18n, useNavigation, useTools, useWallet } from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';
import { useRgbWriteLeaseGuard } from '../RGB/components/useRgbWriteLeaseGuard';

type FeePoolInspection = Awaited<ReturnType<ReturnType<typeof useWallet>['getRgbFeePoolInspection']>>;
type RgbFeeAccountInfo = Awaited<ReturnType<ReturnType<typeof useWallet>['getRgbFeeAccountInfo']>>;
type FeePoolTabKey = 'utxos' | 'withdrawals';
type FeePoolSelection =
  | { kind: 'utxo'; item: NonNullable<FeePoolInspection>['utxos'][number] }
  | { kind: 'withdrawal'; item: NonNullable<FeePoolInspection>['withdrawals'][number] };

const shortValue = (value: string) => (value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value);

const feeUtxoCardStyle = {
  minHeight: 72,
  padding: '10px 12px',
  borderRadius: 8,
  boxSizing: 'border-box' as const,
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.12)',
  cursor: 'pointer'
};

const feeUtxoSequenceStyle = {
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

const accountInfoCardStyle = {
  borderRadius: 10,
  padding: 0,
  overflow: 'hidden',
  boxSizing: 'border-box' as const
};

const accountInfoRowStyle = {
  minHeight: 52,
  padding: '0 16px',
  boxSizing: 'border-box' as const
};

const statusPillStyle = (available: boolean, pending: boolean, locked: boolean) => ({
  height: 20,
  padding: '0 6px',
  borderRadius: 3,
  display: 'inline-flex',
  alignItems: 'center',
  boxSizing: 'border-box' as const,
  background: locked
    ? 'rgba(255,255,255,0.10)'
    : pending
      ? 'rgba(244,182,44,0.18)'
      : available
        ? 'rgba(123,224,152,0.16)'
        : 'rgba(255,255,255,0.10)'
});

export default function RgbFeePoolInspectionScreen() {
  const wallet = useWallet();
  const nav = useNavigation();
  const tools = useTools();
  const { t } = useI18n();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const [inspection, setInspection] = useState<FeePoolInspection>();
  const [feeAccountInfo, setFeeAccountInfo] = useState<RgbFeeAccountInfo>();
  const [refreshing, setRefreshing] = useState(true);
  const [withdrawPreparing, setWithdrawPreparing] = useState(false);
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [withdrawToSignData, setWithdrawToSignData] = useState<ToSignData>();
  const [activeTab, setActiveTab] = useState<FeePoolTabKey>('utxos');
  const [selection, setSelection] = useState<FeePoolSelection>();

  const refresh = useCallback(
    async (showSuccess = false) => {
      setRefreshing(true);
      try {
        const result = await wallet.getRgbFeePoolInspection();
        setInspection(result);
        setFeeAccountInfo({ address: result.address, derivationPath: result.derivationPath });
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

  useEffect(() => {
    let active = true;
    void wallet.getRgbFeeAccountInfo().then((result) => {
      if (active) setFeeAccountInfo(result);
    }).catch(() => {
      // The inspection request reports actionable errors; this fast local read is best-effort.
    });
    return () => {
      active = false;
    };
  }, [wallet]);

  const beginWithdraw = async () => {
    if (withdrawPreparing) return;
    setWithdrawPreparing(true);
    try {
      const result = await wallet.createRgbFeePoolWithdrawBegin();
      setWithdrawToSignData(result.toSignData);
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setWithdrawPreparing(false);
    }
  };

  const completeWithdraw = async (signedDatas: SignedData[]) => {
    const signedPsbt = signedDatas[0]?.psbtHex;
    if (!signedPsbt) {
      tools.toastError(t('rgb_psbt_signing_missing_result'));
      return;
    }
    setWithdrawSubmitting(true);
    try {
      const result = await wallet.createRgbFeePoolWithdrawEnd({ signedPsbt });
      setWithdrawToSignData(undefined);
      nav.navigate('TxSuccessScreen', { txid: result.txid });
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
      setWithdrawToSignData(undefined);
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  if (withdrawSubmitting) {
    return <LoadingPage />;
  }

  if (withdrawToSignData) {
    return (
      <>
        <SignPsbt
          header={<Header onBack={() => setWithdrawToSignData(undefined)} />}
          params={{ data: { toSignDatas: [withdrawToSignData] } }}
          handleCancel={() => setWithdrawToSignData(undefined)}
          handleConfirm={(signedDatas) => void requestWrite(() => void completeWithdraw(signedDatas))}
        />
        {writeLeaseModal}
      </>
    );
  }

  const canWithdraw = inspection?.utxos.some((utxo) => utxo.available && !utxo.pending);

  return (
    <Layout>
      <Header onBack={() => window.history.go(-1)} title={t('rgb_fee_pool_title')} />
      <Content>
        <Card style={accountInfoCardStyle}>
          <Column fullX gap="zero">
            <Row fullX itemsCenter justifyBetween gap="md" style={accountInfoRowStyle}>
              <Text text={t('address')} color="textDim" size="sm" style={{ flexShrink: 0 }} />
              {inspection || feeAccountInfo ? (
                <Tooltip title={inspection?.address || feeAccountInfo?.address} overlayStyle={{ maxWidth: 'calc(100vw - 32px)', overflowWrap: 'anywhere', boxSizing: 'border-box' }}>
                  <CopyableAddress address={inspection?.address || feeAccountInfo?.address || ''} copyPosition="after" color="ticker_color2" />
                </Tooltip>
              ) : (
                <Text text="—" color="white" size="xs" />
              )}
            </Row>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
            <Row fullX itemsCenter justifyBetween gap="md" style={accountInfoRowStyle}>
              <Text text={t('derivation_path')} color="textDim" size="sm" style={{ flexShrink: 0 }} />
              <Text
                text={inspection?.derivationPath || feeAccountInfo?.derivationPath || '—'}
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

        {!inspection && refreshing ? (
          <Column fullX itemsCenter gap="sm" style={emptyStateCardStyle}>
            <LoadingOutlined style={{ color: '#F4B62C', fontSize: 24 }} />
            <Text text={t('loading')} color="textDim" size="sm" textCenter />
          </Column>
        ) : null}

        {inspection ? (
          <Tabs
            defaultActiveKey="utxos"
            activeKey={activeTab}
            onTabClick={(key) => setActiveTab(key as FeePoolTabKey)}
            items={[
            {
              key: 'utxos',
              label: (
                <Text
                  text={`${t('rgb_fee_pool_utxos')} (${inspection?.utxos.length || 0})`}
                  size="sm"
                  color={activeTab === 'utxos' ? 'gold' : 'textDim'}
                />
              ),
              children: (
                <Column fullX gap="sm">
                  {inspection?.utxos.map((utxo, index) => {
                    const status = utxo.locked
                      ? t('rgb_fee_pool_locked')
                      : utxo.pending
                        ? t('pending')
                        : t('available');
                    const statusColor = utxo.locked ? 'textDim' : utxo.pending ? 'gold' : 'success';
                    return (
                      <Row
                        key={`${utxo.txid}:${utxo.vout}`}
                        itemsCenter
                        gap="md"
                        style={feeUtxoCardStyle}
                        onClick={() => setSelection({ kind: 'utxo', item: utxo })}>
                        <Text text={index + 1} color="textDim" size="sm" style={feeUtxoSequenceStyle} />
                        <Column fullX gap="xs" style={{ minWidth: 0 }}>
                          <Row full justifyBetween itemsCenter gap="sm">
                            <Text
                              text={`${shortValue(utxo.txid)}:${utxo.vout}`}
                              color="white"
                              preset="bold"
                              size="sm"
                              style={{ flex: 1, minWidth: 0 }}
                            />
                            <Row itemsCenter gap="sm">
                              <div style={statusPillStyle(utxo.available, utxo.pending, utxo.locked)}>
                                <Text text={status} color={statusColor} size="xxs" />
                              </div>
                              <Icon icon="right" color="textDim" size={14} />
                            </Row>
                          </Row>
                          <Text text={`${utxo.satoshis.toLocaleString()} sats`} color="textDim" size="xs" />
                        </Column>
                      </Row>
                    );
                  })}
                  {inspection && !inspection.utxos.length ? (
                    <Column fullX itemsCenter gap="sm" style={emptyStateCardStyle}>
                      <Icon icon="emptyBox" color="textDim" size={32} />
                      <Text text={t('rgb_fee_pool_empty')} color="white" size="sm" />
                      <Text text={t('rgb_fee_pool_empty_description')} color="textDim" size="xs" textCenter wrap />
                    </Column>
                  ) : null}
                </Column>
              )
            },
            {
              key: 'withdrawals',
              label: (
                <Text
                  text={`${t('rgb_fee_pool_transfer_history')} (${inspection?.withdrawals.length || 0})`}
                  size="sm"
                  color={activeTab === 'withdrawals' ? 'gold' : 'textDim'}
                />
              ),
              children: (
                <Column fullX gap="sm">
                  {inspection?.withdrawals.map((withdrawal) => (
                    <Row
                      key={withdrawal.txid}
                      itemsCenter
                      justifyBetween
                      gap="md"
                      style={feeUtxoCardStyle}
                      onClick={() => setSelection({ kind: 'withdrawal', item: withdrawal })}>
                      <Column gap="xs" style={{ minWidth: 0 }}>
                        <Text text={t('rgb_fee_pool_transferred_to_wallet')} color="white" preset="bold" size="sm" />
                        <Text text={shortValue(withdrawal.txid)} color="textDim" size="xs" />
                        <Text text={new Date(withdrawal.createdAt).toLocaleString()} color="textDim" size="xs" />
                      </Column>
                      <Row itemsCenter gap="sm" style={{ flexShrink: 0 }}>
                        <Text text={`${withdrawal.amount.toLocaleString()} sats`} color="white" size="sm" />
                        <Icon icon="right" color="textDim" size={14} />
                      </Row>
                    </Row>
                  ))}
                  {inspection && !inspection.withdrawals.length ? (
                    <Column fullX itemsCenter gap="sm" style={emptyStateCardStyle}>
                      <Icon icon="emptyBox" color="textDim" size={32} />
                      <Text text={t('rgb_fee_pool_no_transfers')} color="textDim" size="sm" textCenter wrap />
                    </Column>
                  ) : null}
                </Column>
              )
            }
            ]}
          />
        ) : null}
      </Content>
      {activeTab === 'utxos' ? (
        <Row style={{ padding: '0 16px 16px' }}>
          <Button
            text={withdrawPreparing ? t('loading') : t('rgb_fee_pool_transfer_to_wallet')}
            preset="default"
            disabled={!canWithdraw || withdrawPreparing}
            onClick={() => void requestWrite(() => void beginWithdraw())}
            LeftAccessory={withdrawPreparing ? <LoadingOutlined /> : undefined}
            style={{ flex: 1 }}
          />
          <Button
            text={t('refresh')}
            preset="primary"
            disabled={refreshing}
            onClick={() => void refresh(true)}
            style={{ flex: 1 }}
          />
        </Row>
      ) : (
        <Text
          text={t('rgb_fee_pool_local_history_notice')}
          color="textDim"
          size="xs"
          textCenter
          wrap
          style={{ padding: '8px 28px 16px' }}
        />
      )}
      {writeLeaseModal}
      {selection ? (
        <BottomModal onClose={() => setSelection(undefined)}>
          <Column gap="lg">
            <Text
              text={selection.kind === 'utxo' ? 'UTXO' : t('rgb_fee_pool_transferred_to_wallet')}
              color="white"
              size="lg"
              textCenter
              disableTranslate={selection.kind === 'utxo'}
            />
            <Column
              gap="md"
              fullX
              style={{ padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.06)' }}>
              <Row justifyBetween itemsCenter fullX gap="md">
                <Text text={t('transaction_id')} color="textDim" size="sm" />
                <CopyableAddress
                  address={selection.item.txid}
                  copyPosition="after"
                  len={8}
                  color="ticker_color2"
                />
              </Row>
              {selection.kind === 'utxo' ? (
                <Row justifyBetween itemsCenter fullX gap="md">
                  <Text text="Vout" color="textDim" size="sm" disableTranslate />
                  <Text text={selection.item.vout} color="white" size="sm" disableTranslate />
                </Row>
              ) : null}
              <Row justifyBetween itemsCenter fullX gap="md">
                <Text text={t('amount')} color="textDim" size="sm" />
                <Text
                  text={`${(selection.kind === 'utxo'
                    ? selection.item.satoshis
                    : selection.item.amount).toLocaleString()} sats`}
                  color="white"
                  size="sm"
                  disableTranslate
                />
              </Row>
              {selection.kind === 'utxo' ? (
                <Row justifyBetween itemsCenter fullX gap="md">
                  <Text text={t('status')} color="textDim" size="sm" />
                  <Text
                    text={selection.item.locked
                      ? t('rgb_fee_pool_locked')
                      : selection.item.pending
                        ? t('pending')
                        : t('available')}
                    color="white"
                    size="sm"
                  />
                </Row>
              ) : (
                <Row justifyBetween itemsCenter fullX gap="md">
                  <Text text={t('date')} color="textDim" size="sm" />
                  <Text text={new Date(selection.item.createdAt).toLocaleString()} color="white" size="sm" />
                </Row>
              )}
            </Column>
            <Button
              preset="primary"
              text={t('view_on_uniscan')}
              onClick={() => {
                const txid = selection.item.txid;
                setSelection(undefined);
                nav.navToExplorerTx(txid);
              }}
            />
          </Column>
        </BottomModal>
      ) : null}
    </Layout>
  );
}
