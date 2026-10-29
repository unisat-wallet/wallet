import { useState } from 'react';

import { Button, Card, Column, Content, Footer, Header, Layout, Row, Text } from '@/ui/components';
import { CopyableAddress } from '@/ui/components/CopyableAddress';
import WebsiteBar from '@/ui/components/WebsiteBar';
import KeystoneSignScreen from '@/ui/pages/Wallet/KeystoneSignScreen';
import { KeyringType, KeystoneSignEnum } from '@unisat/keyring-service/types';
import { useApproval, useCurrentAccount, useI18n, useWallet } from '@unisat/wallet-state';
import type { CosmosDirectSignSummary } from '@unisat/babylon-service';

interface Props {
  params: {
    method: 'cosmos_signDirect' | 'cosmos_signArbitrary';
    data: {
      chainId: string;
      signerAddress: string;
      signDoc?: any;
      data?: any;
      dataType?: string;
      signBytesHex: string;
      summary?: CosmosDirectSignSummary;
    };
    session: {
      origin: string;
      icon: string;
      name: string;
    };
  };
  origin?: string;
  requestDefer?: any;
}

export default function CosmosSign({ params: { method, data, session }, origin }: Props) {
  const { resolveApproval, rejectApproval } = useApproval();
  const account = useCurrentAccount();
  const [isKeystoneSigning, setIsKeystoneSigning] = useState(false);
  const { t } = useI18n();

  const isKeystone = account.type === KeyringType.KeystoneKeyring;

  const wallet = useWallet();

  const isDirect = method === 'cosmos_signDirect';
  const keystoneSignType = isDirect ? KeystoneSignEnum.COSMOS_DIRECT : KeystoneSignEnum.COSMOS_ARBITRARY;

  const handleCancel = () => {
    rejectApproval();
  };

  const handleConfirm = async () => {
    if (isKeystone) {
      setIsKeystoneSigning(true);
    } else if (isDirect) {
      const result = await wallet.cosmosSignDirect({
        chainId: data.chainId,
        signerAddress: data.signerAddress,
        signDoc: data.signDoc
      });
      resolveApproval(result);
    } else {
      const result = await wallet.cosmosSignArbitrary({
        chainId: data.chainId,
        signerAddress: data.signerAddress,
        dataType: data.dataType || '',
        data: data.data
      });
      resolveApproval(result);
    }
  };

  if (isKeystoneSigning) {
    return (
      <KeystoneSignScreen
        type={keystoneSignType}
        data={data.signBytesHex}
        onSuccess={(result) => {
          resolveApproval(result);
          setIsKeystoneSigning(false);
        }}
        onBack={() => {
          setIsKeystoneSigning(false);
        }}
      />
    );
  }

  return (
    <Layout>
      <Content>
        <Header>
          <WebsiteBar session={session} />
        </Header>
        <Column>
          <Text text={t('cosmos_sign_request')} preset="title-bold" textCenter mt="lg" />

          <Row justifyCenter>
            <Row justifyCenter px="lg" py="sm" style={{ backgroundColor: '#3F3227', borderRadius: 10 }}>
              <CopyableAddress address={data.signerAddress} />
            </Row>
          </Row>

          <Text text={t('only_sign_if_you_fully_understand_the_content_and_')} preset="sub" textCenter mt="lg" />
          <Text text={t('you_are_signing')} textCenter mt="lg" />

          <Card>
            <div
              style={{
                userSelect: 'text',
                maxHeight: 384,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                flexWrap: 'wrap'
              }}>
              {isDirect
                ? JSON.stringify(data.summary, null, 2)
                : method === 'cosmos_signArbitrary'
                  ? data.data
                  : ''}
            </div>
          </Card>
        </Column>
      </Content>

      <Footer>
        <Row full>
          <Button text={t('reject')} full preset="default" onClick={handleCancel} />
          <Button text={t('sign')} full preset="primary" onClick={handleConfirm} />
        </Row>
      </Footer>
    </Layout>
  );
}
