import {
  Button,
  Card,
  Column,
  Content,
  Footer,
  Header,
  Layout,
  Row,
  Text
} from '@/ui/components';
import WebsiteBar from '@/ui/components/WebsiteBar';
import { useApproval, useI18n } from '@unisat/wallet-state';

interface Props {
  params: {
    data: {
      appName: string;
      context: string;
    };
    session: {
      origin: string;
      icon: string;
      name: string;
    };
  };
}

export default function DeriveContextHash({ params: { data, session } }: Props) {
  const { resolveApproval, rejectApproval } = useApproval();
  const { t } = useI18n();

  const handleCancel = () => {
    rejectApproval();
  };

  const handleConfirm = () => {
    resolveApproval();
  };

  return (
    <Layout>
      <Content>
        <Header>
          <WebsiteBar session={session} />
        </Header>

        <Column>
          <Text text={t('derive_context_hash_request')} preset="title-bold" textCenter mt="lg" />

          <Text text={t('derive_context_hash_description')} textCenter mt="lg" />

          <Text text={t('derive_context_hash_app_name')} preset="bold" mt="lg" />
          <Card>
            <Text text={data.appName} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }} />
          </Card>

          <Text text={t('derive_context_hash_context')} preset="bold" mt="lg" />
          <Card>
            <div
              style={{
                userSelect: 'text',
                maxHeight: 384,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontFamily: 'monospace'
              }}>
              {data.context}
            </div>
          </Card>

          <Text
            preset="sub"
            textCenter
            mt="lg"
            color="warning"
            text={t('derive_context_hash_warning')}
          />
        </Column>
      </Content>

      <Footer>
        <Row full>
          <Button text={t('reject')} full preset="default" onClick={handleCancel} />
          <Button text={t('confirm')} full preset="primary" onClick={handleConfirm} />
        </Row>
      </Footer>
    </Layout>
  );
}
