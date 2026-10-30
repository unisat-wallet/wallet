import { Column, Content, Header, Layout } from '@/ui/components';
import { useI18n, useRGBTransfersLogic } from '@unisat/wallet-state';

import { RGBTransfersList } from '../Main/WalletTabScreen/RGBTransfersList';

export default function RGBTransfersScreen() {
  const { t } = useI18n();
  const transfers = useRGBTransfersLogic({ initialFullSync: true, pollingEnabled: false });

  return (
    <Layout>
      <Header onBack={() => window.history.go(-1)} title={t('rgb_history')} />
      <Content>
        <Column fullX data-testid="rgb-transfers-screen">
          <RGBTransfersList transfers={transfers} />
        </Column>
      </Content>
    </Layout>
  );
}
