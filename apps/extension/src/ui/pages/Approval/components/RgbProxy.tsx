import { Button, Card, Column, Content, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { useApproval, useI18n } from '@unisat/wallet-state';

type Props = {
  params: {
    endpoint: string;
    operation: string;
  };
};

export default function RgbProxy({ params }: Props) {
  const { resolveApproval, rejectApproval } = useApproval();
  const { t } = useI18n();
  const endpoint = params?.endpoint || '';

  return (
    <Layout>
      <Header />
      <Content>
        <Column mt="lg" gap="lg">
          <Column itemsCenter gap="md">
            <Icon icon="warning" color="gold" size={40} />
            <Text text="Use a third-party RGB proxy?" preset="title-bold" textCenter />
            <Text
              text="This proxy was supplied by the counterparty and is not on UniSat's trusted list. If you continue, the wallet extension will connect to it directly."
              color="textDim"
              textCenter
            />
          </Column>

          <Card style={{ display: 'block', padding: 16 }}>
            <Column gap="sm">
              <Text text="Proxy endpoint" size="xs" color="textDim" />
              <Text text={endpoint} size="sm" style={{ wordBreak: 'break-all' }} />
              <Text text="Operation" size="xs" color="textDim" />
              <Text text={params?.operation || 'RGB proxy request'} size="sm" />
            </Column>
          </Card>

          <Text
            text="Approval lasts until the wallet is locked. HTTP endpoints and redirects remain blocked."
            size="xs"
            color="textDim"
            textCenter
          />
        </Column>
      </Content>
      <Footer>
        <Row full>
          <Button
            text={t('cancel')}
            preset="default"
            onClick={() => rejectApproval(t('user_rejected_the_request'))}
            full
          />
          <Button
            text="Allow proxy"
            preset="primary"
            onClick={() => resolveApproval({ approved: true, endpoint })}
            full
          />
        </Row>
      </Footer>
    </Layout>
  );
}
