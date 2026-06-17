import { IMAGE_SOURCE_MAP } from '@/shared/constant';
import { Column, Content, Header, Layout, ReceiveQRCodeCard } from '@/ui/components';
import { useAccountAddress, useChain, useCurrentAccount, useI18n } from '@unisat/wallet-state';

import './index.less';

export default function ReceiveScreen() {
  const currentAccount = useCurrentAccount();
  const address = useAccountAddress();
  const chain = useChain();
  const { t } = useI18n();

  return (
    <Layout>
      <Header
        onBack={() => {
          window.history.go(-1);
        }}
        title={t('receive')}
      />
      <Content>
        <Column gap="lg">
          <ReceiveQRCodeCard
            title={currentAccount?.alianName || ''}
            description={t('use_this_address_to_receive', { unit: chain.unit, chain: chain.label })}
            value={address || ''}
            valueLabel={t('receive_address')}
            qrIconSrc={IMAGE_SOURCE_MAP[chain.icon]}
            accentColor="#F4B62C"
          />
        </Column>
      </Content>
    </Layout>
  );
}
