import { Column, InfiniteList } from '@/ui/components';
import RGBBalanceCard from '@/ui/components/RGBBalanceCard';
import { useI18n, useRGBListLogic } from '@unisat/wallet-state';

function getAssetId(item: any, index: number) {
  return (item?.assetId || item?.id || index).toString();
}

type RGBListProps = {
  list: ReturnType<typeof useRGBListLogic>;
};

export function RGBList({ list }: RGBListProps) {
  const { t } = useI18n();
  const { onRefresh, items, total, onLoadMore, onClickItem, loading, showLoading, hasLoaded, hasMore } = list;

  return (
    <Column>
      <InfiniteList
        data={items}
        total={total}
        keyExtractor={getAssetId}
        renderItem={({ item, index }) => {
          return (
            <RGBBalanceCard tokenBalance={item} onClick={() => onClickItem(item)} data-testid={`rgb-item-${index}`} />
          );
        }}
        onLoadMore={onLoadMore}
        onRefresh={onRefresh}
        hasMore={hasMore}
        loading={loading && !hasLoaded}
        showLoading={showLoading && !hasLoaded}
        emptyText={t('assets_no_assets')}
        emptyPreset="assets"
      />
    </Column>
  );
}
