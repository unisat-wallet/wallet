import { type ReactNode, useEffect, useState } from 'react';

import { Button, Card, Column, Content, Footer, Header, Icon, Image, Layout, Row, Text } from '@/ui/components';
import WebsiteBar from '@/ui/components/WebsiteBar';
import { formatSessionIcon, shortAddress } from '@/ui/utils';
import type { SignedData, ToSignData } from '@unisat/wallet-shared';
import { useApproval, useWallet } from '@unisat/wallet-state';

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
};

interface Props {
  params: {
    data: {
      assetId?: string;
      amount?: string;
      durationSeconds?: number;
      recipientType?: 'blind' | 'witness';
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
  const { resolveApproval, rejectApproval } = useApproval();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const [utxoToSignData, setUtxoToSignData] = useState<ToSignData>();
  const [howItWorksExpanded, setHowItWorksExpanded] = useState(false);
  const [invoiceDetailsExpanded, setInvoiceDetailsExpanded] = useState(false);
  const [assetMetadata, setAssetMetadata] = useState<RgbAssetMetadata>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const amount = data.amount?.trim() || 'Any amount';
  const ticker = assetMetadata?.ticker?.trim();
  const assetName = assetMetadata?.name?.trim();
  const amountLabel = ticker && amount !== 'Any amount' ? `${amount} ${ticker}` : amount;
  const assetLabel = data.assetId
    ? [ticker, assetName && assetName !== ticker ? assetName : ''].filter(Boolean).join(' · ') ||
      `RGB asset · ${shortAddress(data.assetId, 6)}`
    : 'Any RGB asset';
  const expiry = formatRgbInvoiceExpiry(data.durationSeconds);
  const siteName = session.name?.split('|')[0].trim() || session.origin;

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
        setAssetMetadata({ name: asset.name, ticker: asset.ticker });
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
    return String(value || 'Unable to create RGB UTXO');
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
      if (!toSignData) throw new Error('RGB UTXO creation did not return signing data');
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
      setError('RGB UTXO PSBT signing did not return psbtHex');
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
    <Layout style={{ background: '#090A0D' }}>
      <Content>
        <Column
          mt="md"
          gap="md"
          style={{ width: '100%', maxWidth: 520, alignSelf: 'center', padding: '0 14px 14px', boxSizing: 'border-box' }}
        >
          <Column itemsCenter gap="xs" style={{ paddingTop: 4 }}>
            <div
              style={{
                width: 52,
                height: 52,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03))',
                border: '1px solid rgba(255,255,255,0.22)',
                overflow: 'hidden'
              }}
            >
              <Image
                src={formatSessionIcon(session)}
                fallbackSrc="./images/icons/artifacts/unknown.png"
                size={38}
                style={{ borderRadius: 11 }}
              />
            </div>
            <Text text={siteName} size="lg" preset="title-bold" textCenter />
            <Row itemsCenter gap="xs">
              <Icon icon="link" color="textDim" size={11} />
              <Text text={session.origin} size="xs" color="textDim" textCenter />
            </Row>
            <Text
              text="wants to create an RGB receive invoice"
              size="lg"
              preset="title-bold"
              textCenter
              style={{ marginTop: 8 }}
            />
            <Text text="Create an invoice to receive RGB assets." size="sm" textCenter color="textDim" />
          </Column>

          <Card
            style={{
              display: 'block',
              padding: 14,
              borderRadius: 14,
              border: '1px solid rgba(148, 160, 190, 0.20)',
              background: 'linear-gradient(135deg, rgba(30, 33, 44, 0.94), rgba(16, 17, 23, 0.94))',
              boxShadow: '0 12px 34px rgba(0,0,0,0.22)'
            }}
          >
            <Column gap="md">
              <Row justifyBetween gap="md" style={{ alignItems: 'flex-start' }}>
                <Row gap="md" itemsCenter style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      width: 58,
                      height: 58,
                      flex: '0 0 58px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 16,
                      background: 'radial-gradient(circle at 30% 25%, #7B4DFF 0%, #4A36D6 42%, #F49B37 100%)',
                      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)'
                    }}
                  >
                    <Icon icon="rgb" size={30} />
                  </div>
                  <Column gap="xs" style={{ minWidth: 0, flex: 1 }}>
                    <Text text="Receive" size="sm" color="textDim" />
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
                    text={data.recipientType === 'witness' ? 'Witness' : 'Blind'}
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

          <Card
            style={{
              display: 'block',
              padding: 0,
              borderRadius: 14,
              border: '1px solid rgba(148, 160, 190, 0.18)',
              background: 'linear-gradient(135deg, rgba(24, 26, 35, 0.94), rgba(14, 15, 20, 0.94))'
            }}
          >
            <RgbApprovalAccordion
              title="How this works"
              description="A brief overview of what will happen."
              expanded={howItWorksExpanded}
              onClick={() => setHowItWorksExpanded((value) => !value)}
            >
              <Row itemsCenter gap="sm">
                <Icon icon="utxo" color="gold" size={20} />
                <Text text="Your wallet creates an invoice for this site." size="xs" color="textDim" />
              </Row>
              <Text
                text="If wallet setup requires a Bitcoin transaction, its recipients and network fee will be shown on the next screen before you sign."
                size="xs"
                color="textDim"
                style={{ lineHeight: '18px' }}
              />
              <Text text="No RGB assets leave your wallet when creating this invoice." size="xs" color="success" />
            </RgbApprovalAccordion>
            <RgbApprovalAccordion
              title="Invoice details"
              description="Asset ID, recipient and expiry information."
              expanded={invoiceDetailsExpanded}
              onClick={() => setInvoiceDetailsExpanded((value) => !value)}
              bordered
            >
              <Column gap="sm">
                {data.assetId ? <RgbReceiveDetail label="Asset" value={assetLabel} /> : null}
                <RgbReceiveDetail
                  label="Asset ID"
                  value={data.assetId ? shortAddress(data.assetId, 10) : 'Any RGB asset'}
                />
                <RgbReceiveDetail label="Amount" value={amount} />
                <RgbReceiveDetail
                  label="Recipient"
                  value={data.recipientType === 'witness' ? 'Witness seal' : 'Blind seal'}
                />
                <RgbReceiveDetail label="Expiry" value={expiry} />
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
      <Footer
        style={{ padding: '10px 14px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#090A0D' }}
      >
        <Row full gap="md">
          <Button
            text="Cancel"
            preset="default"
            onClick={() => rejectApproval()}
            full
            style={{ height: 48, borderRadius: 12, background: 'transparent', borderColor: 'rgba(255,255,255,0.32)' }}
            textStyle={{ fontSize: 14, fontWeight: 700 }}
          />
          <Button
            text={loading ? 'Preparing...' : 'Create invoice'}
            preset="primary"
            onClick={() => void requestWrite(() => void onCreateInvoice())}
            disabled={loading}
            full
            style={{ height: 48, borderRadius: 12 }}
            textStyle={{ fontSize: 14, fontWeight: 700 }}
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

function formatRgbInvoiceExpiry(durationSeconds?: number) {
  if (!durationSeconds || durationSeconds <= 0) return 'No expiry';
  if (durationSeconds < 60) return `Expires in ${durationSeconds} sec`;
  if (durationSeconds < 3600) return `Expires in ${Math.ceil(durationSeconds / 60)} min`;
  if (durationSeconds < 86_400) return `Expires in ${Math.ceil(durationSeconds / 3600)} hr`;
  return `Expires in ${Math.ceil(durationSeconds / 86_400)} day${durationSeconds >= 172_800 ? 's' : ''}`;
}

export function RgbReceiveAccept({ params: { data, session } }: Props) {
  const receive = data.receive || {};
  return (
    <RgbApprovalLayout
      session={session}
      title="Accept RGB receive"
      description="Accepting sends an acknowledgement to the sender. The sender may then broadcast the Bitcoin transaction."
      rows={[
        ['Asset', receive.assetId || 'Unknown asset'],
        ['Amount', String(receive.amount ?? 'Unknown amount')],
        ['Status', receive.status || 'Pending acceptance']
      ]}
      confirmText="Accept RGB"
    />
  );
}

export function RgbReceiveReject({ params: { data, session } }: Props) {
  const receive = data.receive || {};
  return (
    <RgbApprovalLayout
      session={session}
      title="Reject RGB receive"
      description="Rejecting declines this one-time invoice. The sender must not broadcast this RGB transfer."
      rows={[
        ['Asset', receive.assetId || 'Unknown asset'],
        ['Amount', String(receive.amount ?? 'Unknown amount')]
      ]}
      confirmText="Reject receive"
      confirmPreset="danger"
    />
  );
}

export function RgbPayment({ params: { data, session } }: Props) {
  return <RgbPaymentApproval data={data} session={session} />;
}

function RgbPaymentApproval({ data, session }: { data: Props['params']['data']; session: Props['params']['session'] }) {
  const wallet = useWallet();
  const { resolveApproval, rejectApproval } = useApproval();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const [feePoolToSignData, setFeePoolToSignData] = useState<ToSignData>();
  const [howItWorksExpanded, setHowItWorksExpanded] = useState(false);
  const [paymentDetailsExpanded, setPaymentDetailsExpanded] = useState(false);
  const [assetMetadata, setAssetMetadata] = useState<RgbAssetMetadata>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const amount = data.amount?.trim() || 'Use invoice amount';
  const ticker = assetMetadata?.ticker?.trim();
  const assetName = assetMetadata?.name?.trim();
  const amountLabel = ticker && amount !== 'Use invoice amount' ? `${amount} ${ticker}` : amount;
  const assetLabel = data.assetId
    ? [ticker, assetName && assetName !== ticker ? assetName : ''].filter(Boolean).join(' · ') ||
      `RGB asset · ${shortAddress(data.assetId, 6)}`
    : 'RGB asset from invoice';
  const siteName = session.name?.split('|')[0].trim() || session.origin;

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
        setAssetMetadata({ name: asset.name, ticker: asset.ticker });
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
    return String(value || 'Unable to fund the RGB fee pool');
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
      if (!toSignData) throw new Error('RGB fee-pool top-up did not return signing data');
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
      setError('RGB fee-pool PSBT signing did not return psbtHex');
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
    <Layout style={{ background: '#090A0D' }}>
      <Content>
        <Column
          mt="md"
          gap="md"
          style={{ width: '100%', maxWidth: 520, alignSelf: 'center', padding: '0 14px 14px', boxSizing: 'border-box' }}
        >
          <Column itemsCenter gap="xs" style={{ paddingTop: 4 }}>
            <div
              style={{
                width: 52,
                height: 52,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03))',
                border: '1px solid rgba(255,255,255,0.22)',
                overflow: 'hidden'
              }}
            >
              <Image
                src={formatSessionIcon(session)}
                fallbackSrc="./images/icons/artifacts/unknown.png"
                size={38}
                style={{ borderRadius: 11 }}
              />
            </div>
            <Text text={siteName} size="lg" preset="title-bold" textCenter />
            <Row itemsCenter gap="xs">
              <Icon icon="link" color="textDim" size={11} />
              <Text text={session.origin} size="xs" color="textDim" textCenter />
            </Row>
            <Text
              text="wants to prepare an RGB payment"
              size="lg"
              preset="title-bold"
              textCenter
              style={{ marginTop: 8 }}
            />
            <Text text="Review the payment details before continuing." size="sm" textCenter color="textDim" />
          </Column>

          <Card
            style={{
              display: 'block',
              padding: 14,
              borderRadius: 14,
              border: '1px solid rgba(148, 160, 190, 0.20)',
              background: 'linear-gradient(135deg, rgba(30, 33, 44, 0.94), rgba(16, 17, 23, 0.94))',
              boxShadow: '0 12px 34px rgba(0,0,0,0.22)'
            }}
          >
            <Row justifyBetween gap="md" style={{ alignItems: 'flex-start' }}>
              <Row gap="md" itemsCenter style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    width: 58,
                    height: 58,
                    flex: '0 0 58px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 16,
                    background: 'radial-gradient(circle at 30% 25%, #7B4DFF 0%, #4A36D6 42%, #F49B37 100%)',
                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)'
                  }}
                >
                  <Icon icon="send" color="white" size={30} />
                </div>
                <Column gap="xs" style={{ minWidth: 0, flex: 1 }}>
                  <Text text="Pay" size="sm" color="textDim" />
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
                  background: 'rgba(255, 123, 33, 0.14)'
                }}
              >
                <Icon icon="send" color="orange" size={12} />
                <Text text="Payment" size="xxs" color="orange" />
              </div>
            </Row>
          </Card>

          <Card
            style={{
              display: 'block',
              padding: 0,
              borderRadius: 14,
              border: '1px solid rgba(148, 160, 190, 0.18)',
              background: 'linear-gradient(135deg, rgba(24, 26, 35, 0.94), rgba(14, 15, 20, 0.94))'
            }}
          >
            <RgbApprovalAccordion
              title="How this works"
              description="The next steps needed to prepare this payment."
              expanded={howItWorksExpanded}
              onClick={() => setHowItWorksExpanded((value) => !value)}
            >
              <Text
                text="Your wallet checks the RGB fee pool before preparing this payment."
                size="xs"
                color="textDim"
              />
              <Text
                text="If a Bitcoin funding transaction is required, its recipients and network fee will be shown on the next screen before you sign."
                size="xs"
                color="textDim"
                style={{ lineHeight: '18px' }}
              />
              <Text
                text="You will review the final RGB payment transaction before signing."
                size="xs"
                color="success"
              />
            </RgbApprovalAccordion>
            <RgbApprovalAccordion
              title="Payment details"
              description="Asset, amount and recipient invoice information."
              expanded={paymentDetailsExpanded}
              onClick={() => setPaymentDetailsExpanded((value) => !value)}
              bordered
            >
              <Column gap="sm">
                <RgbReceiveDetail label="Asset" value={assetLabel} />
                <RgbReceiveDetail label="Amount" value={amountLabel} />
                <RgbReceiveDetail
                  label="Recipient invoice"
                  value={data.invoice ? shortAddress(data.invoice, 10) : 'Not provided'}
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
      <Footer
        style={{ padding: '10px 14px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#090A0D' }}
      >
        <Row full gap="md">
          <Button
            text="Cancel"
            preset="default"
            onClick={() => rejectApproval()}
            full
            style={{ height: 48, borderRadius: 12, background: 'transparent', borderColor: 'rgba(255,255,255,0.32)' }}
            textStyle={{ fontSize: 14, fontWeight: 700 }}
          />
          <Button
            text={loading ? 'Checking...' : 'Prepare payment'}
            preset="primary"
            onClick={() => void requestWrite(() => void onPreparePayment())}
            disabled={loading}
            full
            style={{ height: 48, borderRadius: 12 }}
            textStyle={{ fontSize: 14, fontWeight: 700 }}
          />
        </Row>
      </Footer>
      {writeLeaseModal}
    </Layout>
  );
}

export function RgbPaymentCancel({ params: { session } }: Props) {
  return (
    <RgbApprovalLayout
      session={session}
      title="Cancel RGB payment"
      description="Cancel only if the recipient has not acknowledged the consignment and the transaction has not been broadcast."
      rows={[]}
      confirmText="Cancel payment"
      confirmPreset="danger"
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
            text="Cancel"
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
