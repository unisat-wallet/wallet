import { useEffect, useState } from 'react';

import { Button, Column, Content, Header, Input, Layout } from '@/ui/components';
import { FooterButtonContainer } from '@/ui/components/FooterButtonContainer';
import { useI18n, useTools, useWallet } from '@unisat/wallet-state';

import { useNavigate } from '../MainRoute';

export default function CreateWatchWalletScreen() {
  const [address, setAddress] = useState('');
  const [disabled, setDisabled] = useState(true);
  const wallet = useWallet();
  const tools = useTools();
  const { t } = useI18n();
  const navigate = useNavigate();

  useEffect(() => {
    setDisabled(!address);
  }, [address]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAddress(e.target.value.trim());
  };

  const onConfirm = async () => {
    try {
      await wallet.createTmpKeyringWithAddress(address);
    } catch (e) {
      tools.toastError((e as Error).message || t('watch_address_error'));
      return;
    }
    try {
      await wallet.createKeyringWithAddress(address);
      navigate('MainScreen');
    } catch (e) {
      tools.toastError((e as Error).message);
    }
  };

  return (
    <Layout>
      <Header
        onBack={() => {
          window.history.go(-1);
        }}
        title={t('create_watch_wallet')}
      />
      <Content>
        <Column gap="lg">
          <Input
            placeholder={t('watch_address_placeholder')}
            onChange={onChange}
            autoFocus={true}
          />
          <FooterButtonContainer>
            <Button disabled={disabled} text={t('continue')} preset="primary" onClick={onConfirm} />
          </FooterButtonContainer>
        </Column>
      </Content>
    </Layout>
  );
}
