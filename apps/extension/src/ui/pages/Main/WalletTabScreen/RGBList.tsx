import { Button, Column, InfiniteList, Row, Text } from '@/ui/components';
import RGBBalanceCard from '@/ui/components/RGBBalanceCard';
import { IS_DEVELOPMENT } from '@/ui/utils';
import { useI18n, useNavigation, useRGBListLogic } from '@unisat/wallet-state';

function getAssetId(item: any, index: number) {
  return (item?.assetId || item?.id || index).toString();
}

export function RGBList({ showHeader = false }: { showHeader?: boolean }) {
  const { t } = useI18n();
  const nav = useNavigation();
  const { onRefresh, items, total, onLoadMore, onClickItem, loading, hasMore } = useRGBListLogic();

  return (
    <Column gap="md">
      {showHeader ? (
        <Text mx="md" text={`${t('rgb')} (${Math.max(total, 0)})`} size="sm" color="white_muted" mb="sm" />
      ) : null}
      {IS_DEVELOPMENT ? (
        <Row mx="md" fullX gap="sm">
          <Button
            text="Issue"
            preset="primary"
            onClick={() => {
              nav.navigate('RGBIssueScreen');
            }}
          />
        </Row>
      ) : null}
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
        loading={loading}
      />
    </Column>
  );
}
