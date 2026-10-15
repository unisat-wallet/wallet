import { BottomSheetHeader, Card, Column, Icon, InfiniteList, RGBAssetIcon, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { getRgbAssetName } from '@/ui/components/RGBAssetIcon';
import {
  getRgbTokenIconInfo,
  getRgbTokenPrecision,
  toRgbDisplayAmount,
  useI18n,
  useRGBListLogic,
  type RgbBalance
} from '@unisat/wallet-state';

type RGBListState = ReturnType<typeof useRGBListLogic>;

function canSendAsset(asset: RgbBalance) {
  return !!asset.assetId && Number(asset.spendable || 0) > 0;
}

function SelectorChevron() {
  return <Icon icon="right" size={20} style={{ backgroundColor: 'rgba(255, 255, 255, 0.65)' }} />;
}

export function RgbSendAssetSelectorModal({
  list,
  onClose,
  onSelect
}: {
  list: RGBListState;
  onClose: () => void;
  onSelect: (asset: RgbBalance) => void;
}) {
  const { t } = useI18n();

  return (
    <BottomModal onClose={onClose} bodyStyle={{ padding: 0 }}>
      <Column fullX gap="zero">
        <BottomSheetHeader title={t('select_asset')} onClose={onClose} />
        <Column
          fullX
          style={{
            padding: '0 20px 20px',
            boxSizing: 'border-box',
            minHeight: 200
          }}
        >
          <InfiniteList
            data={list.items}
            total={list.total}
            hasMore={list.hasMore}
            loading={list.loading && !list.hasLoaded}
            showLoading={list.showLoading && !list.hasLoaded}
            onLoadMore={list.onLoadMore}
            onRefresh={list.onRefresh}
            emptyText={t('assets_no_assets')}
            keyExtractor={(asset) => asset.assetId}
            renderItem={({ item: asset, index }) => {
              const sendable = canSendAsset(asset);
              const ticker = asset.ticker || 'RGB';
              const name = getRgbAssetName(asset) || ticker;
              const spendable = toRgbDisplayAmount(asset.spendable || '0', getRgbTokenPrecision(asset));
              return (
                <Card
                  fullX
                  itemsCenter
                  onClick={sendable ? () => onSelect(asset) : undefined}
                  data-testid={`send-asset-rgb-${index}`}
                  style={{
                    minHeight: 64,
                    padding: '10px 12px',
                    borderRadius: 10,
                    opacity: sendable ? 1 : 0.5,
                    cursor: sendable ? 'pointer' : 'default'
                  }}
                >
                  <Row itemsCenter gap="md" style={{ minWidth: 0, flex: 1 }}>
                    <RGBAssetIcon iconInfo={getRgbTokenIconInfo(asset, ticker)} ticker={ticker} name={name} size={32} />
                    <Column gap="zero" style={{ minWidth: 0, flex: 1 }}>
                      <Text text={name} size="sm" ellipsis />
                      <Text
                        text={`${t('available_balance')}: ${spendable} ${ticker}`}
                        size="xs"
                        color="textDim"
                        ellipsis
                      />
                    </Column>
                  </Row>
                  {sendable ? <SelectorChevron /> : null}
                </Card>
              );
            }}
          />
        </Column>
      </Column>
    </BottomModal>
  );
}
