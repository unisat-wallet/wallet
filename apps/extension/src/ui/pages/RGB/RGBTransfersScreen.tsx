import { Column, Content, Header, Layout } from '@/ui/components';
import { useI18n, useNavigation, useRGBTransfersLogic } from '@unisat/wallet-state';

import { RGBTransfersList } from '../Main/WalletTabScreen/RGBTransfersList';

export default function RGBTransfersScreen() {
  const { t } = useI18n();
  const nav = useNavigation();
  const routeState = nav.getRouteState<'RGBTransfersScreen'>();
  const pendingOnly = routeState?.filter === 'pending';
  const transfers = useRGBTransfersLogic({ initialFullSync: true, pollingEnabled: false });

  return (
    <Layout>
      <Header
        onBack={() => window.history.go(-1)}
        title={t(pendingOnly ? 'rgb_pending_acceptances' : 'rgb_history')}
      />
      <Content>
        <Column fullX data-testid="rgb-transfers-screen">
          <RGBTransfersList transfers={transfers} pendingOnly={pendingOnly} />
        </Column>
      </Content>
    </Layout>
  );
}
