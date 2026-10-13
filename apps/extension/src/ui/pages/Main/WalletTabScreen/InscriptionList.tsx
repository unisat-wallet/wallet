import { InfiniteList } from '@/ui/components';
import InscriptionPreview from '@/ui/components/InscriptionPreview';
import { useDevice, useI18n, useInscriptionListLogic } from '@unisat/wallet-state';

export function InscriptionList() {
  const { t } = useI18n();
  const { onRefresh, items, total, onLoadMore, onClickItem, loading, hasMore } = useInscriptionListLogic();

  const device = useDevice();
  return (
    <InfiniteList
      data={items}
      total={total}
      countUnit="inscription"
      numColumns={device.cardColumnsInList}
      keyExtractor={(item) => item.inscriptionId}
      renderItem={({ item, index }) => {
        return (
          <InscriptionPreview
            key={item.inscriptionId || `inscription-${index}`}
            data={item}
            preset="medium"
            onClick={() => onClickItem(item)}
            data-testid={`inscription-item-${index}`}
          />
        );
      }}
      onLoadMore={onLoadMore}
      onRefresh={onRefresh}
      hasMore={hasMore}
      loading={loading}
      emptyText={t('assets_no_assets')}
        emptyPreset="assets"
        emptyMarketplace
      emptyMarketplacePath="/market/collection"
    />
  );
}
