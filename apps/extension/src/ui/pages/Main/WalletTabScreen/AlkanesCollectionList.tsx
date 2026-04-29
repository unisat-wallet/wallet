import { Column, InfiniteList, Text } from '@/ui/components';
import { AlkanesCollectionCard } from '@/ui/components/AlkanesCollectionCard';
import { useAlkanesCollectionListLogic, useDevice, useI18n } from '@unisat/wallet-state';

export function AlkanesCollectionList({ showHeader = false }: { showHeader?: boolean }) {
  const { t } = useI18n();
  const { onRefresh, items, total, onLoadMore, onClickItem, loading, hasMore } = useAlkanesCollectionListLogic();

  const device = useDevice();

  return (
    <Column>
      {showHeader ? (
        <Text
          mx="md"
          text={`${t('alkanes_collections')} (${Math.max(total, 0)})`}
          size="sm"
          color="white_muted"
          mb="sm"
        />
      ) : null}
      <InfiniteList
        data={items}
        total={total}
        numColumns={device.cardColumnsInList}
        keyExtractor={(item) => item.alkaneid}
        renderItem={({ item, index }) => {
          return <AlkanesCollectionCard alkanesCollection={item} onClick={() => onClickItem(item)} />;
        }}
        onLoadMore={onLoadMore}
        onRefresh={onRefresh}
        hasMore={hasMore}
        loading={loading}
      />
    </Column>
  );
}
