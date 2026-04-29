import { Column, InfiniteList, Text } from '@/ui/components';
import AlkanesBalanceCard from '@/ui/components/AlkanesBalanceCard';
import { useAlkanesListLogic, useI18n } from '@unisat/wallet-state';

export function AlkanesList({ showHeader = false }: { showHeader?: boolean }) {
  const { t } = useI18n();
  const { onRefresh, items, total, onLoadMore, onClickItem, loading, hasMore, priceMap } = useAlkanesListLogic();

  return (
    <Column>
      {showHeader ? (
        <Text mx="md" text={`${t('alkanes')} (${Math.max(total, 0)})`} size="sm" color="white_muted" mb="sm" />
      ) : null}
      <InfiniteList
        data={items}
        total={total}
        keyExtractor={(item) => item.alkaneid}
        renderItem={({ item }) => {
          return (
            <AlkanesBalanceCard tokenBalance={item} price={priceMap[item.alkaneid]} onClick={() => onClickItem(item)} />
          );
        }}
        onLoadMore={onLoadMore}
        onRefresh={onRefresh}
        hasMore={hasMore}
        loading={loading}
      />
    </Column>
  );
}
