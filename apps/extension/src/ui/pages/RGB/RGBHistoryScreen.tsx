import { Column, Content, Header, Layout } from '@/ui/components';
import { useRGBHistoryScreenLogic } from '@unisat/wallet-state';

import { RGBTokenHistory } from './components/RGBTokenHistory';

export default function RGBHistoryScreen() {
  const { activity, total, loading, hasMore, onRefresh, onLoadMore, t } = useRGBHistoryScreenLogic();

  return (
    <Layout>
      <Header
        onBack={() => {
          window.history.go(-1);
        }}
        title={t('rgb_history')}
      />
      <Content>
        <Column fullX>
          <RGBTokenHistory
            ticker="RGB"
            activityItems={activity}
            activityTotal={total}
            activityLoading={loading}
            activityHasMore={hasMore}
            onLoadMoreActivity={onLoadMore}
            onRefreshActivity={onRefresh}
            showAssetTicker
          />
        </Column>
      </Content>
    </Layout>
  );
}
