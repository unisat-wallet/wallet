import { useCallback, useEffect, useState } from 'react';

import { Button, Column, Content, Header, InfiniteList, Layout, Row, Text } from '@/ui/components';
import LoadingPage from '@/ui/components/LoadingPage';
import RGBBalanceCard from '@/ui/components/RGBBalanceCard';
import type { SignedData, ToSignData } from '@unisat/wallet-shared';
import {
  useDeveloperMode,
  useI18n,
  useNavigation,
  useTools,
  useWallet,
  type RgbBalance
} from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';
import { useRgbWriteLeaseGuard } from '../RGB/components/useRgbWriteLeaseGuard';

type Plan = Awaited<ReturnType<ReturnType<typeof useWallet>['getRgbAssetAbandonmentPlan']>>;

const shortId = (value: string) => `${value.slice(0, 12)}…${value.slice(-8)}`;

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (Array.isArray(error)) {
    const messages = error.map(getErrorMessage).filter(Boolean);
    return messages.join('; ') || 'Unknown RGB asset abandonment error';
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    for (const key of ['message', 'msg', 'error', 'details']) {
      if (record[key] !== undefined) {
        const message = getErrorMessage(record[key]);
        if (message && !message.startsWith('Unknown RGB')) return message;
      }
    }
    try {
      return JSON.stringify(error);
    } catch {
      // Fall through to the stable user-facing fallback below.
    }
  }
  return 'Unknown RGB asset abandonment error';
}

export default function RgbAssetAbandonScreen() {
  const wallet = useWallet();
  const developerMode = useDeveloperMode();
  const tools = useTools();
  const nav = useNavigation();
  const { t } = useI18n();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const [assets, setAssets] = useState<RgbBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [plan, setPlan] = useState<Plan>();
  const [toSignData, setToSignData] = useState<ToSignData>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await wallet.getRGBList('', 1, 1000, { skipSync: true });
      setAssets(result.list as RgbBalance[]);
    } catch (error) {
      tools.toastError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [tools, wallet]);

  useEffect(() => void load(), [load]);

  const inspect = async (assetId: string) => {
    try {
      setPlan(await wallet.getRgbAssetAbandonmentPlan({ assetId }));
    } catch (error) {
      tools.toastError(getErrorMessage(error));
    }
  };

  const prepare = async () => {
    if (!plan || preparing) return;
    setPreparing(true);
    try {
      const result = await wallet.createRgbAssetAbandonBegin({ assetId: plan.assetId });
      setToSignData(result.toSignData);
      setPlan(undefined);
    } catch (error) {
      tools.toastError(getErrorMessage(error));
    } finally {
      setPreparing(false);
    }
  };

  const complete = async (signedDatas: SignedData[]) => {
    const signedPsbt = signedDatas[0]?.psbtHex;
    if (!signedPsbt) return tools.toastError(t('rgb_psbt_signing_missing_result'));
    setSubmitting(true);
    try {
      const result = await wallet.createRgbAssetAbandonEnd({ signedPsbt });
      setToSignData(undefined);
      if (result.cleanupPending) tools.toastError(t('rgb_asset_abandon_cleanup_pending'));
      nav.navigate('TxSuccessScreen', { txid: result.txid });
    } catch (error) {
      tools.toastError(getErrorMessage(error));
      setToSignData(undefined);
    } finally {
      setSubmitting(false);
    }
  };

  if (!developerMode) {
    return (
      <Layout>
        <Header onBack={() => window.history.go(-1)} title={t('rgb_asset_abandon_title')} />
        <Content><Text text={t('rgb_asset_abandon_developer_only')} color="textDim" wrap /></Content>
      </Layout>
    );
  }
  if (submitting) return <LoadingPage />;
  if (toSignData) {
    return (
      <>
        <SignPsbt
          header={<Header onBack={() => setToSignData(undefined)} />}
          params={{ data: { toSignDatas: [toSignData] } }}
          handleCancel={() => setToSignData(undefined)}
          handleConfirm={(signed) => void requestWrite(() => void complete(signed))}
        />
        {writeLeaseModal}
      </>
    );
  }

  return (
    <Layout>
      <Header onBack={() => window.history.go(-1)} title={t('rgb_asset_abandon_title')} />
      <Content>
        <Column fullX gap="md">
          <Text text={t('rgb_asset_abandon_description')} color="danger" size="sm" wrap />
          <InfiniteList
            data={assets}
            total={assets.length}
            keyExtractor={(asset) => asset.assetId}
            renderItem={({ item: asset, index }) => (
              <RGBBalanceCard
                tokenBalance={asset}
                onClick={() => void inspect(asset.assetId)}
                data-testid={`rgb-abandon-item-${index}`}
              />
            )}
            onLoadMore={() => undefined}
            onRefresh={() => void load()}
            hasMore={false}
            loading={loading}
            showLoading={loading}
            emptyText={t('assets_no_assets')}
            emptyPreset="assets"
          />
        </Column>
      </Content>
      {plan ? (
        <Column gap="md" style={{ padding: 16, background: '#1b1b1b' }}>
          <Text text={t('rgb_asset_abandon_confirm_title')} preset="title-bold" />
          <Text text={t('rgb_asset_abandon_confirm_description')} color="danger" size="sm" wrap />
          <Text text={`${plan.ticker || plan.name || 'RGB'} · ${shortId(plan.assetId)}`} color="white" wrap />
          <Text text={`${plan.utxos.length} UTXO · ${plan.satoshis} sats`} color="textDim" />
          <Row fullX>
            <Button text={t('cancel')} preset="defaultV2" full disabled={preparing} onClick={() => setPlan(undefined)} />
            <Button text={t('rgb_asset_abandon_action')} preset="primaryV2" full disabled={preparing} onClick={() => void requestWrite(prepare)} />
          </Row>
        </Column>
      ) : null}
      {writeLeaseModal}
    </Layout>
  );
}
