import { useCallback, useEffect, useState } from 'react';

import { Button, Card, Column, Content, Header, Icon, Layout, Row, Text } from '@/ui/components';
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

const feeIconStyle = {
  width: 36,
  height: 36,
  minWidth: 36,
  borderRadius: 8,
  background: 'rgba(255,255,255,0.10)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

const accountInfoCardStyle = {
  borderRadius: 10,
  padding: '14px 16px',
  boxSizing: 'border-box' as const
};

const statusPillStyle = (available: boolean, pending: boolean) => ({
  height: 20,
  padding: '0 6px',
  borderRadius: 3,
  display: 'inline-flex',
  alignItems: 'center',
  boxSizing: 'border-box' as const,
  background: pending ? 'rgba(244,182,44,0.18)' : available ? 'rgba(123,224,152,0.16)' : 'rgba(255,255,255,0.10)'
});

export default function RgbFeePoolInspectionScreen() {
  const wallet = useWallet();
  const nav = useNavigation();
  const tools = useTools();
  const { t } = useI18n();
  const [inspection, setInspection] = useState<FeePoolInspection>();
  const [refreshing, setRefreshing] = useState(false);
  const [withdrawToSignData, setWithdrawToSignData] = useState<ToSignData>();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await wallet.getRgbFeePoolInspection();
      setInspection(result);
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }, [tools, wallet]);

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
      tools.toastSuccess(result.txid);
      await refresh();
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

  return (
    <Layout>
      <Header onBack={() => window.history.go(-1)} title={t('rgb_fee_pool_title')} />
      <Content>
        <Card style={accountInfoCardStyle}>
          <Column fullX gap="md">
            <Text text={t('rgb_fee_pool_title')} preset="bold" size="sm" />
            <Column fullX gap="xs">
              <Text text={t('address')} color="textDim" size="xs" />
              <Row
                fullX
                itemsCenter
                gap="sm"
                style={{ cursor: inspection ? 'pointer' : 'default', minWidth: 0 }}
                onClick={() => inspection && nav.navToExplorerAddress(inspection.address)}>
                <Text
                  text={inspection?.address || '—'}
                  selectText
                  color="white"
                  size="xs"
                  ellipsis
                  style={{ flex: 1, minWidth: 0 }}
                />
                {inspection ? <Icon icon="right" color="textDim" size={14} /> : null}
              </Row>
            </Column>
            <Column fullX gap="xs">
              <Text text={t('derivation_path')} color="textDim" size="xs" />
              <Text
                text={inspection?.derivationPath || '—'}
                selectText
                color="white"
                size="xs"
                ellipsis
                style={{ minWidth: 0 }}
              />
            </Column>
          </Column>
        </Card>

        {inspection?.utxos.map((utxo) => {
          const status = utxo.pending ? t('pending') : utxo.available ? t('available') : t('unavailable');
          const statusColor = utxo.pending ? 'gold' : utxo.available ? 'success' : 'textDim';
          return (
            <Row
              key={`${utxo.txid}:${utxo.vout}`}
              itemsCenter
              gap="md"
              style={feeUtxoCardStyle}
              onClick={() => nav.navToExplorerTx(utxo.txid)}>
              <div style={feeIconStyle}>
                <Icon icon="btc" color={utxo.pending ? 'gold' : 'white_muted'} size={20} />
              </div>
              <Column fullX gap="xs" style={{ minWidth: 0 }}>
                <Row full justifyBetween itemsCenter gap="sm">
                  <Text text={`Fee UTXO #${utxo.vout}`} color="white" preset="bold" size="sm" />
                  <Row itemsCenter gap="sm">
                    <div style={statusPillStyle(utxo.available, utxo.pending)}>
                      <Text text={status} color={statusColor} size="xxs" />
                    </div>
                    <Icon icon="right" color="textDim" size={14} />
                  </Row>
                </Row>
                <Text text={`${shortValue(utxo.txid)}:${utxo.vout}`} selectText color="textDim" size="xs" />
                <Text text={`${utxo.satoshis.toLocaleString()} sats`} color="textDim" size="xs" />
              </Column>
            </Row>
          );
        })}

        {inspection && !inspection.utxos.length ? (
          <Text text={t('no_data')} color="textDim" textCenter size="sm" />
        ) : null}
      </Content>
      <Row style={{ padding: '0 16px 16px' }}>
        <Button
          text={t('rgb_fee_pool_withdraw')}
          preset="default"
          disabled={!inspection?.utxos.some((utxo) => !utxo.pending && !utxo.locked)}
          onClick={beginWithdraw}
          style={{ flex: 1 }}
        />
        <Button text={t('refresh')} preset="primary" disabled={refreshing} onClick={refresh} style={{ flex: 1 }} />
      </Row>
    </Layout>
  );
}
