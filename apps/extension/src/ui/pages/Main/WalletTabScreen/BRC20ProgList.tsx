import { InfiniteList } from '@/ui/components';
import BRC20BalanceCard from '@/ui/components/BRC20BalanceCard';
import { useBRC20ProgListLogic, useI18n } from '@unisat/wallet-state';

export function BRC20ProgList() {
  const { t } = useI18n();
  const { onRefresh, items, total, onLoadMore, onClickItem, loading, hasMore, priceMap } = useBRC20ProgListLogic();

  return (
    <InfiniteList
      data={items}
      total={total}
      keyExtractor={(item) => item.ticker}
      renderItem={({ item }) => {
        return <BRC20BalanceCard tokenBalance={item} price={priceMap[item.ticker]} onClick={() => onClickItem(item)} />;
      }}
      onLoadMore={onLoadMore}
      onRefresh={onRefresh}
      hasMore={hasMore}
      loading={loading}
      emptyText={t('assets_no_assets')}
      emptyPreset="assets"
    />
  );
}
