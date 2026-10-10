import { Content, Header, Layout } from '@/ui/components';
import { useI18n } from '@unisat/wallet-state';

import { AddressHistorySection } from './AddressHistorySection';

export default function HistoryScreen() {
  const { t } = useI18n();

  return (
    <Layout>
      <Header onBack={() => window.history.back()} title={t('history')} />
      <Content>
        <AddressHistorySection />
      </Content>
    </Layout>
  );
}
