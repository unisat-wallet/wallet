import { useState } from 'react';

import { Button, Card, Column, Content, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
import WebsiteBar from '@/ui/components/WebsiteBar';
import type { SignedData, ToSignData } from '@unisat/wallet-shared';
import { useApproval, useWallet } from '@unisat/wallet-state';

import SignPsbt from './SignPsbt';

type Receive = {
  assetId?: string;
  amount?: string | number;
  status?: string;
};

interface Props {
  params: {
    data: {
      assetId?: string;
      amount?: string;
      durationSeconds?: number;
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
  const [utxoToSignData, setUtxoToSignData] = useState<ToSignData>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      <SignPsbt
        params={{ data: { toSignDatas: [utxoToSignData] }, session }}
        handleCancel={() => setUtxoToSignData(undefined)}
        handleConfirm={(signedDatas) => void onSignRgbUtxo(signedDatas)}
      />
    );
  }

  return (
    <Layout>
      <Header>
        <WebsiteBar session={session} />
      </Header>
      <Content>
        <Column mt="lg" gap="lg">
          <Column itemsCenter gap="sm">
            <div
              style={{
                width: 52,
                height: 52,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 16,
                background: 'rgba(235, 185, 76, 0.16)',
                border: '1px solid rgba(235, 185, 76, 0.30)'
              }}
            >
              <Icon icon="invoice" color="gold" size={26} />
            </div>
            <Text text="Create RGB receive invoice" preset="title-bold" textCenter />
            <Text
              text={`${session.name || session.origin} wants to create a one-time invoice for receiving RGB assets.`}
              preset="sub"
              textCenter
              color="textDim"
            />
          </Column>

          <Card style={{ display: 'block', padding: 16, border: '1px solid rgba(255,255,255,0.10)' }}>
            <Column gap="lg">
              <Row justifyBetween itemsCenter>
                <Text text="Receive request" preset="bold" />
                <Row itemsCenter gap="xs" style={{ color: '#7BE098' }}>
                  <Icon icon="checked" size={14} />
                  <Text text="One-time" size="xs" color="success" />
                </Row>
              </Row>
              <Column gap="sm">
                <RgbReceiveDetail label="Asset" value={data.assetId || 'Any RGB asset'} />
                <RgbReceiveDetail label="Amount" value={data.amount || 'Any amount'} />
                <RgbReceiveDetail
                  label="Expiry"
                  value={data.durationSeconds ? `${data.durationSeconds} seconds` : 'No expiry'}
                />
              </Column>
            </Column>
          </Card>

          <Card style={{ display: 'block', padding: 16, background: 'rgba(235, 185, 76, 0.08)' }}>
            <Column gap="md">
              <Row itemsCenter gap="sm">
                <Icon icon="utxo" color="gold" size={20} />
                <Text text="What happens next" preset="bold" />
              </Row>
              <RgbReceiveStep number="1" text="Your wallet checks for an available RGB funding UTXO." />
              <RgbReceiveStep number="2" text="If needed, you will review and sign one funding transaction." />
              <RgbReceiveStep number="3" text="The invoice is created and returned to this site." />
            </Column>
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
          <Button text="Cancel" preset="default" onClick={() => rejectApproval()} full />
          <Button
            text={loading ? 'Preparing...' : 'Create invoice'}
            preset="primary"
            onClick={() => void onCreateInvoice()}
            disabled={loading}
            full
          />
        </Row>
      </Footer>
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

function RgbReceiveStep({ number, text }: { number: string; text: string }) {
  return (
    <Row gap="sm" itemsCenter>
      <div
        style={{
          width: 20,
          height: 20,
          flex: '0 0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 10,
          background: 'rgba(235, 185, 76, 0.20)'
        }}
      >
        <Text text={number} size="xxs" color="gold" preset="bold" />
      </div>
      <Text text={text} size="xs" color="textDim" style={{ flex: 1 }} />
    </Row>
  );
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
  const [feePoolToSignData, setFeePoolToSignData] = useState<ToSignData>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      <SignPsbt
        params={{ data: { toSignDatas: [feePoolToSignData] }, session }}
        handleCancel={() => setFeePoolToSignData(undefined)}
        handleConfirm={(signedDatas) => void onSignFeePoolTopUp(signedDatas)}
      />
    );
  }

  return (
    <RgbApprovalLayout
      session={session}
      title="Prepare RGB payment"
      description="Your wallet will prepare an RGB transfer. If needed, you will first fund the RGB fee pool used to pay the Bitcoin network fee."
      rows={[
        ['Asset', data.assetId || 'Unknown asset'],
        ['Amount', data.amount || 'Use invoice amount'],
        ['Invoice', data.invoice || '']
      ]}
      confirmText={loading ? 'Checking fee pool...' : 'Continue'}
      onConfirm={() => void onPreparePayment()}
      onCancel={() => rejectApproval()}
      confirmDisabled={loading}
      error={error}
    />
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
            onClick={() => {
              if (onConfirm) onConfirm();
              else resolveApproval();
            }}
            disabled={confirmDisabled}
            full
          />
        </Row>
      </Footer>
    </Layout>
  );
}
