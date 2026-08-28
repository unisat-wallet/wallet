import { useEffect, useState } from 'react';

import { Content, Header, Layout } from '@/ui/components';
import LoadingPage from '@/ui/components/LoadingPage';
import { useI18n } from '@unisat/wallet-state';

import { LanguageCard } from './Language';
import { RgbCard } from './RgbCard';
import { SecurityCard } from './SecurityCard';

export default function AdvancedScreen() {
  const { t } = useI18n();

  const [init, setInit] = useState(false);
  useEffect(() => {
    setTimeout(() => {
      setInit(true);
    }, 300);
  }, []);

  if (!init) {
    return <LoadingPage />;
  }

  return (
    <Layout>
      <Header
        onBack={() => {
          window.history.go(-1);
        }}
        title={t('advanced')}
      />
      <Content style={{ paddingTop: 16 }}>
        <LanguageCard />

        <SecurityCard />

        <RgbCard />
      </Content>
    </Layout>
  );
}
