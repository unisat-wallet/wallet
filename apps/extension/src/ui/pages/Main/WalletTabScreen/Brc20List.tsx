import { InfiniteList } from '@/ui/components';
import BRC20BalanceCard from '@/ui/components/BRC20BalanceCard';
import { useBRC20ListLogic, useI18n } from '@unisat/wallet-state';

export function BRC20List() {
  const { t } = useI18n();
  const { onRefresh, total, items, onLoadMore, onClickItem, loading, hasMore, priceMap } = useBRC20ListLogic();

  return (
    <InfiniteList
      data={items}
      total={total}
      keyExtractor={(item) => item.ticker}
      renderItem={({ item, index }) => {
        return (
          <div data-testid={`brc20-item-${index}`}>
            <BRC20BalanceCard tokenBalance={item} price={priceMap[item.ticker]} onClick={() => onClickItem(item)} />
          </div>
        );
      }}
      onLoadMore={onLoadMore}
      onRefresh={onRefresh}
      hasMore={hasMore}
      loading={loading}
      emptyText={t('assets_no_assets')}
        emptyPreset="assets"
        emptyMarketplace
      emptyMarketplacePath="/market/brc20"
    />
  );
}
