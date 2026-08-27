import { Column, Icon, InfiniteList, Row, Text } from '@/ui/components';
import { Empty } from '@/ui/components/Empty';
import type { IconTypes } from '@/ui/components/Icon';
import { colors } from '@/ui/theme/colors';
import { shortAddress } from '@/ui/utils';
import type { RgbActivityItem } from '@unisat/wallet-state';
import { toRgbDisplayAmount, useI18n, useNavigation } from '@unisat/wallet-state';

function getActivityIcon(type: string): IconTypes {
  if (type === 'send') {
    return 'history_send';
  }

  if (type === 'receive') {
    return 'history_receive';
  }

  if (type === 'issue') {
    return 'history_inscribe';
  }

  return 'history';
}

function formatActivityTime(timestamp: number) {
  if (!timestamp) {
    return '';
  }

  const time = timestamp > 1000000000000 ? timestamp : timestamp * 1000;
  return new Date(time).toLocaleString();
}

function getActivityTitle(type: string, t: (key: string) => string) {
  if (!type) {
    return t('activity');
  }

  if (type === 'send') {
    return t('send');
  }

  if (type === 'receive') {
    return t('receive');
  }

  if (type === 'issue') {
    return t('issue');
  }

  return type.charAt(0).toUpperCase() + type.slice(1);
}

function isPending(status?: string) {
  return (
    typeof status === 'string' &&
    ['pending', 'unconfirmed', 'waitingconfirmations', 'waitingcounterparty'].includes(status.toLowerCase())
  );
}

function RGBActivityItem({
  item,
  ticker,
  precision,
  showAssetTicker
}: {
  item: RgbActivityItem;
  ticker: string;
  precision?: number;
  showAssetTicker?: boolean;
}) {
  const nav = useNavigation();
  const { t } = useI18n();
  const type = item.type.toLowerCase();
  const amount = toRgbDisplayAmount(item.amount, item.precision ?? precision ?? 0);
  const txid = item.txid;
  const time = formatActivityTime(item.timestamp);
  const subTitle = time || txid;
  const pending = isPending(item.status);
  const extendedItem = item as RgbActivityItem & { ticker?: string; name?: string };
  const displayTicker = showAssetTicker
    ? extendedItem.ticker || extendedItem.name || item.assetId?.slice(0, 8) || ticker
    : ticker;

  return (
    <Row fullX justifyBetween justifyCenter py="md" style={{ borderBottomWidth: 1, borderColor: colors.border2 }}>
      <Row itemsCenter>
        <Row
          onClick={() => {
            if (txid !== '--') {
              nav.navToExplorerTx(txid);
            }
          }}>
          <Icon icon={getActivityIcon(type)} size={32} />
        </Row>

        <Column>
          <Row style={{ alignItems: 'start' }}>
            <Text text={getActivityTitle(type, t)} />

            {pending ? (
              <Row style={{ backgroundColor: 'rgba(244, 182, 44, 0.15)', borderRadius: 4 }} px="md" py="xs">
                <Text text={t('history_pending')} style={{ color: 'rgba(244, 182, 44, 0.85)' }} size="xs" />
              </Row>
            ) : null}
          </Row>

          <Row>
            <Text text={shortAddress(subTitle, 10)} preset="sub" />
          </Row>
        </Column>
      </Row>

      {amount !== '0' && amount !== '--' ? (
        <Row itemsCenter>
          <Text text={amount} />
          <Text text={displayTicker} preset="sub" />
        </Row>
      ) : null}
    </Row>
  );
}

export function RGBTokenHistory(props: {
  ticker: string;
  displayName?: string;
  precision?: number;
  activityItems?: RgbActivityItem[];
  activityTotal?: number;
  activityLoading?: boolean;
  activityHasMore?: boolean;
  onLoadMoreActivity?: () => void;
  onRefreshActivity?: () => void;
  showAssetTicker?: boolean;
}) {
  const { t } = useI18n();
  const {
    ticker,
    displayName,
    precision,
    activityItems = [],
    activityTotal = activityItems.length,
    activityLoading = false,
    activityHasMore = false,
    onLoadMoreActivity,
    onRefreshActivity,
    showAssetTicker = false
  } = props;
  const tokenName = displayName || ticker;

  if (activityLoading && activityItems.length === 0) {
    return (
      <Column style={{ minHeight: 150 }} itemsCenter justifyCenter>
        <Text text={t('loading')} preset="sub" />
      </Column>
    );
  }

  if (!activityLoading && activityItems.length === 0) {
    return (
      <Column fullX itemsCenter style={{ paddingTop: 24 }}>
        <Empty text={t('empty')} preset="assets" />
      </Column>
    );
  }

  return (
    <Column fullX>
      <InfiniteList
        data={activityItems}
        total={activityTotal}
        keyExtractor={(item, index) => item.id || item.txid || index.toString()}
        renderItem={({ item }) => (
          <RGBActivityItem item={item} ticker={tokenName} precision={precision} showAssetTicker={showAssetTicker} />
        )}
        onLoadMore={onLoadMoreActivity || (() => undefined)}
        onRefresh={onRefreshActivity || (() => undefined)}
        hasMore={activityHasMore}
        loading={activityLoading}
      />
    </Column>
  );
}
