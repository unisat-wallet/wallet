import { useCallback, useEffect, useState } from 'react';

import { Button, Card, Column, Content, CopyableAddress, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { SignedData, ToSignData } from '@unisat/wallet-shared';
import { useI18n, useNavigation, useTools, useWallet } from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';

type FeePoolInspection = Awaited<ReturnType<ReturnType<typeof useWallet>['getRgbFeePoolInspection']>>;

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
  const [inspection, setInspection] = useState<FeePoolInspection>();
  const [refreshing, setRefreshing] = useState(false);
  const [withdrawToSignData, setWithdrawToSignData] = useState<ToSignData>();

  const refresh = useCallback(async (showSuccess = false) => {
    setRefreshing(true);
    try {
      const result = await wallet.getRgbFeePoolInspection();
      setInspection(result);
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

  const beginWithdraw = async () => {
    try {
      const result = await wallet.createRgbFeePoolWithdrawBegin();
      setWithdrawToSignData(result.toSignData);
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    }
  };

  const completeWithdraw = async (signedDatas: SignedData[]) => {
    const signedPsbt = signedDatas[0]?.psbtHex;
    if (!signedPsbt) {
      tools.toastError(t('rgb_psbt_signing_missing_result'));
      return;
    }
    try {
      const result = await wallet.createRgbFeePoolWithdrawEnd({ signedPsbt });
      setWithdrawToSignData(undefined);
      nav.navigate('TxSuccessScreen', { txid: result.txid });
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
      setWithdrawToSignData(undefined);
    }
  };

  if (withdrawToSignData) {
    return (
      <SignPsbt
        header={<Header onBack={() => setWithdrawToSignData(undefined)} />}
        params={{ data: { toSignDatas: [withdrawToSignData] } }}
        handleCancel={() => setWithdrawToSignData(undefined)}
        handleConfirm={completeWithdraw}
      />
    );
  }

  const canWithdraw = inspection?.utxos.some(utxo => utxo.available && !utxo.pending);

  return (
    <Layout>
      <Header onBack={() => window.history.go(-1)} title={t('rgb_fee_address')} />
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
          </Column>
        </Card>

        {inspection?.utxos.map((utxo) => {
          const status = utxo.locked ? t('rgb_fee_pool_locked') : utxo.pending ? t('pending') : t('available');
          const statusColor = utxo.locked ? 'textDim' : utxo.pending ? 'gold' : 'success';
          return (
            <Row
              key={`${utxo.txid}:${utxo.vout}`}
              itemsCenter
              gap="md"
              style={feeUtxoCardStyle}
              onClick={() => nav.navToExplorerTx(utxo.txid)}>
              <Icon icon="btc" color={utxo.locked ? 'textDim' : utxo.pending ? 'gold' : 'success'} size={32} />
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

      </Content>
      <Row style={{ padding: '0 16px 16px' }}>
        <Button
          text={t('rgb_fee_pool_withdraw')}
          preset="default"
          disabled={!canWithdraw}
          onClick={beginWithdraw}
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
    </Layout>
  );
}
