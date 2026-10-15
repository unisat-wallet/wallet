import { type ReactNode, useEffect, useState } from 'react';

import { Button, Card, Column, Content, Footer, Header, Icon, Layout, RGBAssetIcon, Row, Text } from '@/ui/components';
import WebsiteBar from '@/ui/components/WebsiteBar';
import { shortAddress } from '@/ui/utils';
import type { SignedData, ToSignData } from '@unisat/wallet-shared';
import { getRgbTokenIconInfo, useApproval, useI18n, useWallet } from '@unisat/wallet-state';

import { useRgbWriteLeaseGuard } from '../../RGB/components/useRgbWriteLeaseGuard';
import SignPsbt from './SignPsbt';

type Receive = {
  assetId?: string;
  amount?: string | number;
  status?: string;
};

type RgbAssetMetadata = {
  name?: string;
  ticker?: string;
  iconInfo?: {
    iconShortName?: string;
    iconUrl?: string;
  };
  iconUrl?: string;
};

interface Props {
  params: {
    data: {
      assetId?: string;
      amount?: string;
      durationSeconds?: number;
      recipientType?: 'blind' | 'witness';
      ticker?: string;
      name?: string;
      precision?: number;
      orderId?: string;
      toSignData?: ToSignData;
      invoice?: string;
      receive?: Receive;
    };
    session: {
      origin: string;
      icon: string;
      name: string;
    };
  };
}

export function RgbReceive({ params: { data, session } }: Props) {
  return <RgbReceiveApproval data={data} session={session} />;
}

function RgbReceiveApproval({ data, session }: { data: Props['params']['data']; session: Props['params']['session'] }) {
  const wallet = useWallet();
  const { t } = useI18n();
  const { resolveApproval, rejectApproval } = useApproval();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const [utxoToSignData, setUtxoToSignData] = useState<ToSignData>();
  const [howItWorksExpanded, setHowItWorksExpanded] = useState(false);
  const [invoiceDetailsExpanded, setInvoiceDetailsExpanded] = useState(false);
  const [assetMetadata, setAssetMetadata] = useState<RgbAssetMetadata>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const amount = data.amount?.trim() || t('rgb_approval_any_amount');
  const ticker = assetMetadata?.ticker?.trim();
  const assetName = assetMetadata?.name?.trim();
  const amountLabel = ticker && data.amount?.trim() ? `${amount} ${ticker}` : amount;
  const assetLabel = data.assetId
    ? [ticker, assetName && assetName !== ticker ? assetName : ''].filter(Boolean).join(' · ') ||
      `${t('rgb_approval_rgb_asset')} · ${shortAddress(data.assetId, 6)}`
    : t('rgb_approval_any_rgb_asset');
  const expiry = formatRgbInvoiceExpiry(data.durationSeconds, t);

  useEffect(() => {
    let active = true;
    if (!data.assetId) {
      setAssetMetadata(undefined);
      return () => {
        active = false;
      };
    }

    void wallet
      .getRGBAssetDetail('', data.assetId)
      .then((asset) => {
        if (!active) return;
        setAssetMetadata({
          name: asset.name,
          ticker: asset.ticker,
          iconInfo: asset.iconInfo,
          iconUrl: asset.iconUrl
        });
      })
      .catch(() => {
        if (active) setAssetMetadata(undefined);
      });

    return () => {
      active = false;
    };
  }, [data.assetId, wallet]);

  const hasAvailableRgbUtxo = (summary: {
    available?: boolean;
    availableAllocationCount?: number;
    freeAllocationCount?: number;
    pendingAllocationCount?: number;
  }) => {
    if (summary.available === true) return true;
    const count = Number(summary.availableAllocationCount ?? summary.freeAllocationCount ?? 0);
    if (Number.isFinite(count) && count > 0) return true;
    const pendingCount = Number(summary.pendingAllocationCount ?? 0);
    return Number.isFinite(pendingCount) && pendingCount > 0;
  };

  const getErrorMessage = (value: unknown) => {
    if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
      return value.message;
    }
    return String(value || t('rgb_approval_create_utxo_failed'));
  };

  const onCreateInvoice = async () => {
    setLoading(true);
    setError('');
    try {
      const summary = await wallet.getRgbAllocationSummary({ skipSync: false });
      if (hasAvailableRgbUtxo(summary)) {
        await resolveApproval();
        return;
      }

      const result = await wallet.createRgbUtxosBegin({
        // One funding transaction provides capacity for several blind invoices.
        num: 5,
        upTo: true
      });
      const toSignData = result?.toSignData as ToSignData | undefined;
      if (!toSignData) throw new Error(t('rgb_approval_create_utxo_no_signing_data'));
      setUtxoToSignData(toSignData);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const onSignRgbUtxo = async (signedDatas: SignedData[]) => {
    const signedPsbt = signedDatas[0]?.psbtHex;
    if (!signedPsbt) {
      setError(t('rgb_approval_create_utxo_no_signed_psbt'));
      setUtxoToSignData(undefined);
      return;
    }

    setLoading(true);
    setError('');
    try {
      await wallet.createRgbUtxosEnd({ signedPsbt });
      await resolveApproval();
    } catch (e) {
      setError(getErrorMessage(e));
      setUtxoToSignData(undefined);
    } finally {
      setLoading(false);
    }
  };

  if (utxoToSignData) {
    return (
      <>
        <SignPsbt
          params={{ data: { toSignDatas: [utxoToSignData] }, session }}
          handleCancel={() => setUtxoToSignData(undefined)}
          handleConfirm={(signedDatas) => void requestWrite(() => void onSignRgbUtxo(signedDatas))}
        />
        {writeLeaseModal}
      </>
    );
  }

  return (
    <Layout>
      <Header>
        <WebsiteBar session={session} />
      </Header>
      <Content>
        <Column mt="lg" gap="md">
          <Text text={t('rgb_approval_create_invoice_title')} preset="title-bold" textCenter />
          <Text text={t('rgb_approval_create_invoice_description')} preset="sub" textCenter />

          <Card style={{ display: 'block' }}>
            <Column gap="md" fullX>
              <Row justifyBetween gap="md" fullX style={{ alignItems: 'flex-start' }}>
                <Row gap="md" itemsCenter style={{ minWidth: 0, flex: 1 }}>
                  <RGBAssetIcon
                    iconInfo={getRgbTokenIconInfo(assetMetadata, ticker || assetName || 'RGB')}
                    ticker={ticker}
                    name={assetName}
                    size={52}
                    isAnyRgbAsset={!data.assetId}
                  />
                  <Column gap="xs" style={{ minWidth: 0, flex: 1 }}>
                    <Text text={t('receive')} size="sm" color="textDim" />
                    <Text text={amountLabel} size="xxl" preset="title-bold" style={{ wordBreak: 'break-word' }} />
                    <Text text={assetLabel} size="sm" color="textDim" />
                  </Column>
                </Row>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flex: '0 0 auto',
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: data.recipientType === 'witness' ? 'rgba(235, 185, 76, 0.14)' : 'rgba(255,255,255,0.08)'
                  }}
                >
                  <Icon icon="rgb" size={12} />
                  <Text
                    text={data.recipientType === 'witness' ? t('rgb_approval_witness') : t('rgb_approval_blind')}
                    size="xxs"
                    color={data.recipientType === 'witness' ? 'gold' : 'textDim'}
                  />
                </div>
              </Row>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.10)' }} />
              <Row itemsCenter gap="sm">
                <Icon icon="history" color="textDim" size={15} />
                <Text text={expiry} size="sm" color="textDim" />
              </Row>
            </Column>
          </Card>

          <Card style={{ display: 'block', padding: 0 }}>
            <RgbApprovalAccordion
              title={t('rgb_approval_how_it_works')}
              description={t('rgb_approval_create_how_it_works_description')}
              expanded={howItWorksExpanded}
              onClick={() => setHowItWorksExpanded((value) => !value)}
            >
              <Row itemsCenter gap="sm">
                <Icon icon="utxo" color="gold" size={20} />
                <Text text={t('rgb_approval_create_step_invoice')} size="xs" color="textDim" />
              </Row>
              <Text
                text={t('rgb_approval_create_step_setup')}
                size="xs"
                color="textDim"
                style={{ lineHeight: '18px' }}
              />
              <Text text={t('rgb_approval_create_step_no_assets_leave')} size="xs" color="success" />
            </RgbApprovalAccordion>
            <RgbApprovalAccordion
              title={t('rgb_approval_invoice_details')}
              description={t('rgb_approval_invoice_details_description')}
              expanded={invoiceDetailsExpanded}
              onClick={() => setInvoiceDetailsExpanded((value) => !value)}
              bordered
            >
              <Column gap="sm">
                {data.assetId ? <RgbReceiveDetail label={t('asset')} value={assetLabel} /> : null}
                <RgbReceiveDetail
                  label={t('asset_id')}
                  value={data.assetId ? shortAddress(data.assetId, 10) : t('rgb_approval_any_rgb_asset')}
                />
                <RgbReceiveDetail label={t('amount')} value={amount} />
                <RgbReceiveDetail
                  label={t('recipient')}
                  value={
                    data.recipientType === 'witness' ? t('rgb_approval_witness_seal') : t('rgb_approval_blind_seal')
                  }
                />
                <RgbReceiveDetail label={t('rgb_approval_expiry')} value={expiry} />
              </Column>
            </RgbApprovalAccordion>
          </Card>

          {error && (
            <Card style={{ display: 'block', padding: 12, background: 'rgba(237, 51, 75, 0.12)' }}>
              <Row itemsCenter gap="sm">
                <Icon icon="warning" color="red" size={18} />
                <Text text={error} preset="sub" color="red" style={{ flex: 1, wordBreak: 'break-word' }} />
              </Row>
            </Card>
          )}
        </Column>
      </Content>
      <Footer>
        <Row full>
          <Button text={t('cancel')} preset="default" onClick={() => rejectApproval()} full />
          <Button
            text={loading ? t('rgb_approval_preparing') : t('create_invoice')}
            preset="primary"
            onClick={() => void requestWrite(() => void onCreateInvoice())}
            disabled={loading}
            full
          />
        </Row>
      </Footer>
      {writeLeaseModal}
    </Layout>
  );
}

function RgbReceiveDetail({ label, value }: { label: string; value: string }) {
  return (
    <Row justifyBetween itemsCenter gap="md">
      <Text text={label} size="xs" color="textDim" />
      <Text
        text={value}
        size="sm"
        preset="bold"
        style={{ maxWidth: '68%', textAlign: 'right', wordBreak: 'break-all' }}
      />
    </Row>
  );
}

function RgbApprovalAccordion({
  title,
  description,
  expanded,
  onClick,
  bordered,
  children
}: {
  title: string;
  description: string;
  expanded: boolean;
  onClick: () => void;
  bordered?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ borderTop: bordered ? '1px solid rgba(255,255,255,0.10)' : undefined }}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onClick();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '11px 14px',
          cursor: 'pointer'
        }}
      >
        <Row gap="md" itemsCenter style={{ minWidth: 0 }}>
          <Icon icon={expanded ? 'up' : 'down'} color="textDim" size={13} />
          <Column gap="zero" style={{ minWidth: 0 }}>
            <Text text={title} preset="bold" size="sm" />
            <Text text={description} size="xs" color="textDim" />
          </Column>
        </Row>
        <Icon icon="right" color="textDim" size={14} />
      </div>
      {expanded ? (
        <Column gap="sm" style={{ padding: '0 14px 12px' }}>
          {children}
        </Column>
      ) : null}
    </div>
  );
}

function formatRgbInvoiceExpiry(
  durationSeconds: number | undefined,
  t: (key: string, substitutions?: Record<string, string>) => string
) {
  if (!durationSeconds || durationSeconds <= 0) return t('rgb_no_expiry');
  if (durationSeconds < 60) {
    return t('rgb_expires_in_seconds', { count: String(durationSeconds) });
  }
  if (durationSeconds < 3600) {
    return t('rgb_expires_in_minutes', { count: String(Math.ceil(durationSeconds / 60)) });
  }
  if (durationSeconds < 86_400) {
    return t('rgb_expires_in_hours', { count: String(Math.ceil(durationSeconds / 3600)) });
  }
  return t('rgb_expires_in_days', { count: String(Math.ceil(durationSeconds / 86_400)) });
}

export function RgbReceiveAccept({ params: { data, session } }: Props) {
  const { t } = useI18n();
  const receive = data.receive || {};
  return (
    <RgbApprovalLayout
      session={session}
      title={t('rgb_approval_accept_receive_title')}
      description={t('rgb_approval_accept_receive_description')}
      rows={[
        [t('asset'), receive.assetId || t('rgb_approval_unknown_asset')],
        [t('amount'), String(receive.amount ?? t('rgb_approval_unknown_amount'))],
        [t('status'), receive.status || t('rgb_approval_pending_acceptance')]
      ]}
      confirmText={t('rgb_approval_accept_rgb')}
    />
  );
}

export function RgbReceiveReject({ params: { data, session } }: Props) {
  const { t } = useI18n();
  const receive = data.receive || {};
  return (
    <RgbApprovalLayout
      session={session}
      title={t('rgb_approval_reject_receive_title')}
      description={t('rgb_approval_reject_receive_description')}
      rows={[
        [t('asset'), receive.assetId || t('rgb_approval_unknown_asset')],
        [t('amount'), String(receive.amount ?? t('rgb_approval_unknown_amount'))]
      ]}
      confirmText={t('rgb_approval_reject_receive')}
      confirmPreset="danger"
    />
  );
}

export function RgbPayment({ params: { data, session } }: Props) {
  return <RgbPaymentApproval data={data} session={session} />;
}

function RgbPaymentApproval({ data, session }: { data: Props['params']['data']; session: Props['params']['session'] }) {
  const wallet = useWallet();
  const { t } = useI18n();
  const { resolveApproval, rejectApproval } = useApproval();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const [feePoolToSignData, setFeePoolToSignData] = useState<ToSignData>();
  const [howItWorksExpanded, setHowItWorksExpanded] = useState(false);
  const [paymentDetailsExpanded, setPaymentDetailsExpanded] = useState(false);
  const [assetMetadata, setAssetMetadata] = useState<RgbAssetMetadata>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const amount = data.amount?.trim() || t('rgb_approval_use_invoice_amount');
  const ticker = assetMetadata?.ticker?.trim();
  const assetName = assetMetadata?.name?.trim();
  const amountLabel = ticker && data.amount?.trim() ? `${amount} ${ticker}` : amount;
  const assetLabel = data.assetId
    ? [ticker, assetName && assetName !== ticker ? assetName : ''].filter(Boolean).join(' · ') ||
      `${t('rgb_approval_rgb_asset')} · ${shortAddress(data.assetId, 6)}`
    : t('rgb_approval_asset_from_invoice');

  useEffect(() => {
    let active = true;
    if (!data.assetId) {
      setAssetMetadata(undefined);
      return () => {
        active = false;
      };
    }

    void wallet
      .getRGBAssetDetail('', data.assetId)
      .then((asset) => {
        if (!active) return;
        setAssetMetadata({
          name: asset.name,
          ticker: asset.ticker,
          iconInfo: asset.iconInfo,
          iconUrl: asset.iconUrl
        });
      })
      .catch(() => {
        if (active) setAssetMetadata(undefined);
      });

    return () => {
      active = false;
    };
  }, [data.assetId, wallet]);

  const getErrorMessage = (value: unknown) => {
    if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
      return value.message;
    }
    return String(value || t('rgb_approval_fund_fee_pool_failed'));
  };

  const onPreparePayment = async () => {
    setLoading(true);
    setError('');
    try {
      const feePool = await wallet.getRgbFeePoolStatus();
      if (feePool.ready) {
        await resolveApproval();
        return;
      }

      const result = await wallet.createRgbFeePoolTopUpBegin();
      const toSignData = result?.toSignData as ToSignData | undefined;
      if (!toSignData) throw new Error(t('rgb_approval_fee_pool_no_signing_data'));
      setFeePoolToSignData(toSignData);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const onSignFeePoolTopUp = async (signedDatas: SignedData[]) => {
    const signedPsbt = signedDatas[0]?.psbtHex;
    if (!signedPsbt) {
      setError(t('rgb_approval_fee_pool_no_signed_psbt'));
      setFeePoolToSignData(undefined);
      return;
    }

    setLoading(true);
    setError('');
    try {
      await wallet.createRgbFeePoolTopUpEnd({ signedPsbt });
      await resolveApproval();
    } catch (e) {
      setError(getErrorMessage(e));
      setFeePoolToSignData(undefined);
    } finally {
      setLoading(false);
    }
  };

  if (feePoolToSignData) {
    return (
      <>
        <SignPsbt
          params={{ data: { toSignDatas: [feePoolToSignData] }, session }}
          handleCancel={() => setFeePoolToSignData(undefined)}
          handleConfirm={(signedDatas) => void requestWrite(() => void onSignFeePoolTopUp(signedDatas))}
        />
        {writeLeaseModal}
      </>
    );
  }

  return (
    <Layout>
      <Header>
        <WebsiteBar session={session} />
      </Header>
      <Content>
        <Column mt="lg" gap="md">
          <Text text={t('rgb_approval_prepare_payment_title')} preset="title-bold" textCenter />
          <Text text={t('rgb_approval_prepare_payment_description')} preset="sub" textCenter />

          <Card style={{ display: 'block' }}>
            <Column gap="md" fullX>
              <Row justifyBetween gap="md" fullX style={{ alignItems: 'flex-start' }}>
                <Row gap="md" itemsCenter style={{ minWidth: 0, flex: 1 }}>
                  <RGBAssetIcon
                    iconInfo={getRgbTokenIconInfo(assetMetadata, ticker || assetName || 'RGB')}
                    ticker={ticker}
                    name={assetName}
                    size={52}
                  />
                  <Column gap="xs" style={{ minWidth: 0, flex: 1 }}>
                    <Text text={t('rgb_approval_pay')} size="sm" color="textDim" />
                    <Text text={amountLabel} size="xxl" preset="title-bold" style={{ wordBreak: 'break-word' }} />
                    <Text text={assetLabel} size="sm" color="textDim" max2Lines style={{ wordBreak: 'break-word' }} />
                  </Column>
                </Row>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 72,
                    minHeight: 28,
                    flex: '0 0 72px'
                  }}
                >
                  {data.recipientType ? (
                    <Row
                      itemsCenter
                      gap="xs"
                      style={{
                        padding: '6px 8px',
                        borderRadius: 8,
                        background:
                          data.recipientType === 'witness' ? 'rgba(235, 185, 76, 0.14)' : 'rgba(255,255,255,0.08)'
                      }}
                    >
                      <Icon icon="rgb" size={12} />
                      <Text
                        text={data.recipientType === 'witness' ? t('rgb_approval_witness') : t('rgb_approval_blind')}
                        size="xxs"
                        color={data.recipientType === 'witness' ? 'gold' : 'textDim'}
                      />
                    </Row>
                  ) : null}
                </div>
              </Row>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.10)' }} />
              <Column gap="xs" fullX style={{ minWidth: 0, alignItems: 'flex-start' }}>
                <Text text={t('asset_id')} size="xs" color="textDim" />
                <Text
                  text={data.assetId ? shortAddress(data.assetId, 10) : t('rgb_approval_from_invoice')}
                  size="sm"
                  style={{ maxWidth: '100%', wordBreak: 'break-all' }}
                />
              </Column>
            </Column>
          </Card>

          <Card style={{ display: 'block', padding: 0 }}>
            <RgbApprovalAccordion
              title={t('rgb_approval_how_it_works')}
              description={t('rgb_approval_payment_how_it_works_description')}
              expanded={howItWorksExpanded}
              onClick={() => setHowItWorksExpanded((value) => !value)}
            >
              <Text text={t('rgb_approval_payment_step_check_fee_pool')} size="xs" color="textDim" />
              <Text
                text={t('rgb_approval_payment_step_funding')}
                size="xs"
                color="textDim"
                style={{ lineHeight: '18px' }}
              />
              <Text text={t('rgb_approval_payment_step_review')} size="xs" color="success" />
            </RgbApprovalAccordion>
            <RgbApprovalAccordion
              title={t('rgb_approval_payment_details')}
              description={t('rgb_approval_payment_details_description')}
              expanded={paymentDetailsExpanded}
              onClick={() => setPaymentDetailsExpanded((value) => !value)}
              bordered
            >
              <Column gap="sm">
                <RgbReceiveDetail label={t('asset')} value={assetLabel} />
                <RgbReceiveDetail label={t('amount')} value={amountLabel} />
                <RgbReceiveDetail
                  label={t('rgb_approval_recipient_invoice')}
                  value={data.invoice ? shortAddress(data.invoice, 10) : t('rgb_approval_not_provided')}
                />
              </Column>
            </RgbApprovalAccordion>
          </Card>

          {error && (
            <Card style={{ display: 'block', padding: 12, background: 'rgba(237, 51, 75, 0.12)' }}>
              <Row itemsCenter gap="sm">
                <Icon icon="warning" color="red" size={18} />
                <Text text={error} preset="sub" color="red" style={{ flex: 1, wordBreak: 'break-word' }} />
              </Row>
            </Card>
          )}
        </Column>
      </Content>
      <Footer>
        <Row full>
          <Button text={t('cancel')} preset="default" onClick={() => rejectApproval()} full />
          <Button
            text={loading ? t('rgb_approval_checking') : t('rgb_approval_prepare_payment')}
            preset="primary"
            onClick={() => void requestWrite(() => void onPreparePayment())}
            disabled={loading}
            full
          />
        </Row>
      </Footer>
      {writeLeaseModal}
    </Layout>
  );
}

export function RgbPaymentCancel({ params: { session } }: Props) {
  const { t } = useI18n();
  return (
    <RgbApprovalLayout
      session={session}
      title={t('rgb_approval_cancel_payment_title')}
      description={t('rgb_approval_cancel_payment_description')}
      rows={[]}
      confirmText={t('rgb_approval_cancel_payment')}
      confirmPreset="danger"
    />
  );
}

export function RgbIssue({ params: { data, session } }: Props) {
  const { t } = useI18n();
  const { resolveApproval, rejectApproval } = useApproval();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  if (data.toSignData) {
    return (
      <>
        <SignPsbt
          params={{ data: { toSignDatas: [data.toSignData] }, session }}
          handleCancel={() => void rejectApproval()}
          handleConfirm={(signedDatas) => void requestWrite(() => void resolveApproval({ signedPsbt: signedDatas[0]?.psbtHex }))}
        />
        {writeLeaseModal}
      </>
    );
  }
  return (
    <RgbApprovalLayout
      session={session}
      title={t('issue_rgb_asset')}
      description={t('issue_rgb_asset_desc')}
      rows={[
        [t('name_label'), data.name || ''],
        [t('ticker_label'), data.ticker || ''],
        [t('total_supply'), data.amount || ''],
        [t('precision_rgb'), String(data.precision ?? 0)],
        ['Order ID', data.orderId || '']
      ]}
      confirmText={t('issue_asset')}
    />
  );
}

function RgbApprovalLayout({
  session,
  title,
  description,
  rows,
  confirmText,
  confirmPreset = 'primary',
  onConfirm,
  onCancel,
  confirmDisabled = false,
  error
}: {
  session: Props['params']['session'];
  title: string;
  description: string;
  rows: Array<[string, string]>;
  confirmText: string;
  confirmPreset?: 'primary' | 'danger';
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmDisabled?: boolean;
  error?: string;
}) {
  const { resolveApproval, rejectApproval } = useApproval();
  const { t } = useI18n();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  return (
    <Layout>
      <Header>
        <WebsiteBar session={session} />
      </Header>
      <Content>
        <Column mt="lg">
          <Text text={title} preset="title-bold" textCenter />
          <Text text={description} preset="sub" textCenter mt="md" />
          {rows.map(([label, value]) => (
            <Card key={label} mt="md">
              <Column gap="zero">
                <Text text={label} preset="sub" color="textDim" />
                <Text text={value} style={{ wordBreak: 'break-all' }} />
              </Column>
            </Card>
          ))}
          {error && <Text text={error} preset="sub" color="red" mt="md" />}
        </Column>
      </Content>
      <Footer>
        <Row full>
          <Button
            text={t('cancel')}
            preset="default"
            onClick={() => {
              if (onCancel) onCancel();
              else rejectApproval();
            }}
            full
          />
          <Button
            text={confirmText}
            preset={confirmPreset}
            onClick={() =>
              void requestWrite(() => {
                if (onConfirm) onConfirm();
                else resolveApproval();
              })
            }
            disabled={confirmDisabled}
            full
          />
        </Row>
      </Footer>
      {writeLeaseModal}
    </Layout>
  );
}
