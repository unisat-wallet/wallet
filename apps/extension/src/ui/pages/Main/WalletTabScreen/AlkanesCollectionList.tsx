import { InfiniteList } from '@/ui/components';
import { AlkanesCollectionCard } from '@/ui/components/AlkanesCollectionCard';
import { useAlkanesCollectionListLogic, useDevice, useI18n } from '@unisat/wallet-state';

export function AlkanesCollectionList() {
  const { t } = useI18n();
  const { onRefresh, items, total, onLoadMore, onClickItem, loading, hasMore } = useAlkanesCollectionListLogic();

  const device = useDevice();

  return (
    <InfiniteList
      data={items}
      total={total}
      countUnit="collection"
      numColumns={device.cardColumnsInList}
      keyExtractor={(item) => item.alkaneid}
      renderItem={({ item }) => {
        return <AlkanesCollectionCard alkanesCollection={item} onClick={() => onClickItem(item)} />;
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
