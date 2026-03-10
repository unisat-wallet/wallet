import { useEffect, useState } from 'react';

import { Button, Card, Column, Content, Footer, Header, Layout, Row, Text } from '@/ui/components';
import LoadingPage from '@/ui/components/LoadingPage';
import { PhishingDetection } from '@/ui/components/PhishingDetection';
import WebsiteBar from '@/ui/components/WebsiteBar';
import { useApproval, useI18n, useWallet } from '@unisat/wallet-state';

interface Props {
  params: {
    method: string;
    data: {
      context: string;
      proofBits?: number[];
    };
    session: {
      origin: string;
      icon: string;
      name: string;
    };
  };
}

export default function SignLamport({ params }: Props) {
  const { resolveApproval, rejectApproval } = useApproval();
  const { t } = useI18n();
  const wallet = useWallet();

  const { method, data, session } = params;
  const isSign = method === 'signWithLamport';
  const contextHex = data.context || '';

  const [ready, setReady] = useState(false);
  const [isScammer, setIsScammer] = useState(false);

  useEffect(() => {
    const website = session?.origin;
    if (website) {
      wallet
        .checkWebsite(website)
        .then((result) => {
          setIsScammer(result.isScammer);
        })
        .finally(() => {
          setReady(true);
        });
    } else {
      setReady(true);
    }
  }, []);

  if (!ready) {
    return <LoadingPage />;
  }

  if (isScammer) {
    return <PhishingDetection handleCancel={() => rejectApproval()} />;
  }

  return (
    <Layout>
      <Content>
        <Header>
          <WebsiteBar session={session} />
        </Header>
        <Column>
          <Text
            text={isSign ? t('lamport_signature_request') : t('lamport_public_key_request')}
            preset="title-bold"
            textCenter
            mt="lg"
          />
          <Text
            text={
              isSign
                ? t('lamport_signature_request_description')
                : t('lamport_public_key_request_description')
            }
            preset="sub"
            textCenter
            mt="lg"
          />

          <Card>
            <Column>
              <Text text={t('lamport_context')} preset="bold" />
              <div
                style={{
                  userSelect: 'text',
                  maxHeight: 200,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  fontSize: 12,
                  fontFamily: 'monospace',
                }}>
                {contextHex}
              </div>
            </Column>
          </Card>

          {isSign && (
            <Card style={{ borderColor: '#ff4d4f' }}>
              <Text text={t('lamport_signature_warning')} color="danger" />
            </Card>
          )}
        </Column>
      </Content>

      <Footer>
        <Row full>
          <Button preset="default" text={t('reject')} onClick={() => rejectApproval()} full />
          <Button
            preset="primary"
            text={isSign ? t('sign') : t('approve')}
            onClick={() => resolveApproval()}
            full
          />
        </Row>
      </Footer>
    </Layout>
  );
}
