import { Button, Card, Column, Content, Footer, Header, Layout, Row, Text } from '@/ui/components';
import WebsiteBar from '@/ui/components/WebsiteBar';
import { useApproval } from '@unisat/wallet-state';

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
  return (
    <RgbApprovalLayout
      session={session}
      title="Create RGB receive invoice"
      description="This site will receive RGB using a one-time invoice created by your wallet."
      rows={[
        ['Asset', data.assetId || 'Any asset'],
        ['Amount', data.amount || 'Any amount'],
        ['Expires in', data.durationSeconds ? `${data.durationSeconds} seconds` : 'No expiry'],
      ]}
      confirmText="Create invoice"
    />
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
        ['Status', receive.status || 'Pending acceptance'],
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
        ['Amount', String(receive.amount ?? 'Unknown amount')],
      ]}
      confirmText="Reject receive"
      confirmPreset="danger"
    />
  );
}

export function RgbPayment({ params: { data, session } }: Props) {
  return (
    <RgbApprovalLayout
      session={session}
      title="Prepare RGB payment"
      description="Your wallet will prepare an RGB transfer. You will review and sign the Bitcoin transaction in the next step."
      rows={[
        ['Asset', data.assetId || 'Unknown asset'],
        ['Amount', data.amount || 'Use invoice amount'],
        ['Invoice', data.invoice || ''],
      ]}
      confirmText="Continue"
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
}: {
  session: Props['params']['session'];
  title: string;
  description: string;
  rows: Array<[string, string]>;
  confirmText: string;
  confirmPreset?: 'primary' | 'danger';
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
        </Column>
      </Content>
      <Footer>
        <Row full>
          <Button text="Cancel" preset="default" onClick={() => rejectApproval()} full />
          <Button text={confirmText} preset={confirmPreset} onClick={() => resolveApproval()} full />
        </Row>
      </Footer>
    </Layout>
  );
}
