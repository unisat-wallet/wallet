import { useEffect, useState } from 'react';

import { Button, Card, Column, Content, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { CopyableAddress } from '@/ui/components/CopyableAddress';
import WebsiteBar from '@/ui/components/WebsiteBar';
import { fontSizes } from '@/ui/theme/font';
import { LoadingOutlined } from '@ant-design/icons';
import { COSMOS_CHAINS_MAP } from '@unisat/babylon-service/types';
import { Account, WebsiteState } from '@unisat/wallet-shared';
import { useApproval, useI18n, useWallet } from '@unisat/wallet-state';

export interface ItemData {
  key: string;
  account?: Account;
}

interface Props {
  params: {
    session: {
      origin: string;
      icon: string;
      name: string;
    };
    data: {
      chainId: string;
    };
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Unable to load Cosmos address';
}

export default function CosmosConnect({ params: { session, data } }: Props) {
  const { resolveApproval, rejectApproval } = useApproval();
  const { t } = useI18n();
  const wallet = useWallet();

  const [checkState, setCheckState] = useState(WebsiteState.CHECKING);
  const [warning, setWarning] = useState('');
  const [address, setAddress] = useState('');
  const [addressLoading, setAddressLoading] = useState(true);
  const [addressError, setAddressError] = useState('');
  const [addressLoadAttempt, setAddressLoadAttempt] = useState(0);
  const addressReady = !addressLoading && !addressError && Boolean(address);
  const networkName =
    data.chainId === 'bbn-1'
      ? 'Babylon Network'
      : COSMOS_CHAINS_MAP[data.chainId]?.chainName || 'Cosmos Network';

  const handleCancel = () => {
    rejectApproval(t('user_rejected_the_request'));
  };

  const handleConnect = async () => {
    if (!addressReady) return;
    resolveApproval();
  };

  useEffect(() => {
    let active = true;
    setAddress('');
    setAddressError('');
    setAddressLoading(true);

    wallet
      .getBabylonAddress(data.chainId)
      .then((nextAddress) => {
        if (!active) return;
        if (!nextAddress) throw new Error('Cosmos address is unavailable');
        setAddress(nextAddress);
      })
      .catch((error) => {
        if (!active) return;
        const message = getErrorMessage(error);
        setAddressError(message);
      })
      .finally(() => {
        if (active) setAddressLoading(false);
      });

    return () => {
      active = false;
    };
  }, [addressLoadAttempt, data.chainId, wallet]);

  useEffect(() => {
    let active = true;
    wallet.checkWebsite(session.origin).then((v) => {
      if (!active) return;
      if (v.isScammer) {
        setCheckState(WebsiteState.SCAMMER);
      } else {
        setCheckState(WebsiteState.SAFE);
      }
      if (v.warning) {
        setWarning(v.warning);
      }
    });

    return () => {
      active = false;
    };
  }, [session.origin, wallet]);

  if (checkState === WebsiteState.CHECKING) {
    return (
      <Layout>
        <Content itemsCenter justifyCenter>
          <Icon size={fontSizes.xxxl} color="gold">
            <LoadingOutlined />
          </Icon>
        </Content>
      </Layout>
    );
  }

  if (checkState === WebsiteState.SCAMMER) {
    return (
      <Layout>
        <Header>
          <WebsiteBar session={session} />
        </Header>
        <Content>
          <Column>
            <Text text={t('phishing_detection')} preset="title-bold" textCenter mt="xxl" />
            <Text text={t('malicious_behavior_and_suspicious_activity_have_be')} mt="md" />
            <Text text={t('your_access_to_this_page_has_been_restricted_by_un')} mt="md" />
          </Column>
        </Content>

        <Footer>
          <Row full>
            <Button text={t('reject_blocked_by_unisat_wallet')} preset="danger" onClick={handleCancel} full />
          </Row>
        </Footer>
      </Layout>
    );
  }

  if (warning) {
    return (
      <Layout>
        <Header>
          <WebsiteBar session={session} />
        </Header>
        <Content>
          <Column>
            <Text text={t('warning')} preset="title-bold" textCenter mt="xxl" />
            <Text text={warning} mt="md" />
          </Column>
        </Content>

        <Footer>
          <Row full>
            <Button
              text={t('i_am_aware_of_the_risks')}
              preset="danger"
              onClick={() => {
                setWarning('');
              }}
              full
            />
          </Row>
        </Footer>
      </Layout>
    );
  }

  return (
    <Layout>
      <Header>
        <WebsiteBar session={session} />
      </Header>
      <Content>
        <Column mt="lg" gap="md">
          <Text text={t('connect_with_unisat_wallet')} preset="title-bold" textCenter />
          <Text text={t('select_the_account_to_use_on_this_site')} preset="sub" textCenter />

          <Card style={{ display: 'block' }}>
            <Row justifyBetween itemsCenter gap="md" fullX>
              <Row itemsCenter gap="md" style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    flex: '0 0 44px',
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(235, 185, 76, 0.14)'
                  }}>
                  <Icon icon="baby" size={28} />
                </div>
                <Column gap="xs" style={{ minWidth: 0 }}>
                  <Text text={networkName} preset="bold" />
                  <Text text={data.chainId} size="xs" color="textDim" style={{ wordBreak: 'break-all' }} />
                </Column>
              </Row>
              <div
                style={{
                  padding: '6px 9px',
                  borderRadius: 8,
                  flex: '0 0 auto',
                  background: 'rgba(235, 185, 76, 0.14)'
                }}>
                <Text text="CONNECT" size="xxs" color="gold" />
              </div>
            </Row>
          </Card>

          <Card
            style={{
              display: 'block',
              border: addressReady ? '1px solid rgba(235, 185, 76, 0.70)' : '1px solid transparent',
              background: addressReady ? 'rgba(235, 185, 76, 0.07)' : undefined
            }}>
            <Column gap="md" fullX>
              <Row justifyBetween itemsCenter gap="md" fullX>
                <Row itemsCenter gap="sm">
                  <Icon icon="user" size={18} />
                  <Text text={addressReady ? 'Selected account' : 'Account'} preset="bold" />
                </Row>
                {addressReady ? (
                  <Row itemsCenter gap="xs">
                    <Icon icon="circle-check" color="gold" size={19} />
                    <Text text="Selected" size="xxs" color="gold" />
                  </Row>
                ) : null}
              </Row>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.10)' }} />
              {addressLoading ? (
                <Row itemsCenter justifyCenter gap="sm" style={{ minHeight: 42 }}>
                  <Icon size={18} color="gold">
                    <LoadingOutlined />
                  </Icon>
                  <Text text={t('loading')} size="sm" color="textDim" />
                </Row>
              ) : addressError ? (
                <Column gap="sm" itemsCenter style={{ minHeight: 42 }}>
                  <Row itemsCenter gap="sm">
                    <Icon icon="warning" color="red" size={17} />
                    <Text text={addressError} size="xs" color="red" textCenter />
                  </Row>
                  <Button
                    text={t('try_again')}
                    preset="minimal"
                    onClick={() => setAddressLoadAttempt((value) => value + 1)}
                  />
                </Column>
              ) : (
                <Row justifyBetween itemsCenter gap="md" fullX>
                  <Text text={t('address')} size="xs" color="textDim" />
                  <CopyableAddress address={address} copyPosition="after" len={10} />
                </Row>
              )}
            </Column>
          </Card>

          <Card style={{ display: 'block', padding: 12, background: 'rgba(235, 185, 76, 0.12)' }}>
            <Column gap="sm" fullX>
              <Row itemsCenter gap="sm">
                <Icon icon="warning" color="gold" size={18} />
                <Text text="Only connect with sites you trust." preset="sub" color="gold" />
              </Row>
              <Text
                text="This site will be able to view your selected account's address. It cannot access your funds or sign transactions without your approval."
                size="xs"
                color="textDim"
                style={{ lineHeight: '18px' }}
              />
            </Column>
          </Card>
        </Column>
      </Content>

      <Footer>
        <Row full>
          <Button text={t('cancel')} preset="default" onClick={handleCancel} full />
          <Button
            text={t('connect')}
            preset="primary"
            onClick={handleConnect}
            disabled={!addressReady}
            full
          />
        </Row>
      </Footer>
    </Layout>
  );
}
