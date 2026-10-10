import { useEffect, useState } from 'react';

import { Column, Icon, Row, Text } from '@/ui/components';
import { Pagination } from '@/ui/components/Pagination';
import type {
  AddressHistoryAssetItem,
  AddressHistorySummaryItem,
  AddressHistorySummaryPage
} from '@unisat/wallet-shared';
import { useCurrentAddress, useI18n, useNavigation, useWallet } from '@unisat/wallet-state';

const PREVIEW_LIMIT = 5;
const PAGE_SIZE = 20;

function HistoryRow({ item }: { item: AddressHistorySummaryItem }) {
  const { t } = useI18n();
  const nav = useNavigation();
  const directionLabel = {
    receive: t('receive'),
    send: t('send'),
    mixed: t('mixed'),
    self: t('self_transfer')
  }[item.direction];
  const entries: { asset: AddressHistoryAssetItem; sign: string; color: 'green' | 'red' }[] = [
    ...item.received.map((asset) => ({ asset, sign: '+', color: 'green' as const })),
    ...item.sent.map((asset) => ({ asset, sign: item.direction === 'self' ? '' : '-', color: 'red' as const }))
  ];
  const remaining = Math.max(item.receivedCount + item.sentCount - Math.min(entries.length, 2), 0);
  const date = item.timestamp > 0 ? new Date(item.timestamp * 1000).toLocaleString() : '';

  return (
    <Row
      clickable
      itemsCenter
      justifyBetween
      gap="md"
      onClick={() => nav.navToExplorerTx(item.txid)}
      data-testid={`history-${item.txid}`}
      style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
    >
      <Row itemsCenter gap="sm" style={{ minWidth: 0, flex: 1 }}>
        <Icon
          icon={
            item.direction === 'receive' ? 'history_receive' : item.direction === 'send' ? 'history_send' : 'history'
          }
          size={28}
        />
        <Column gap="zero" style={{ minWidth: 0 }}>
          <Text text={directionLabel} size="sm" />
          {date && <Text text={date} size="xxs" color="textDim" ellipsis />}
          {item.status === 'pending' && <Text text={t('history_pending')} size="xxs" color="gold" />}
        </Column>
      </Row>
      <Column gap="zero" style={{ alignItems: 'flex-end', minWidth: 0, maxWidth: '54%' }}>
        {entries.slice(0, 2).map(({ asset, sign, color }, index) => (
          <Text
            key={`${asset.kind}:${asset.assetId || asset.symbol}:${index}`}
            text={`${sign}${asset.amount} ${asset.displayName || asset.symbol || asset.kind}`}
            size="xs"
            color={sign ? color : 'white'}
            ellipsis
            style={{ maxWidth: '100%' }}
          />
        ))}
        {remaining > 0 && <Text text={t('history_more_count', String(remaining))} size="xxs" color="textDim" />}
        {entries.length === 0 && <Text text={item.txid.slice(0, 10)} size="xs" color="textDim" />}
      </Column>
    </Row>
  );
}

export function AddressHistorySection({ preview = false }: { preview?: boolean }) {
  const address = useCurrentAddress();
  const wallet = useWallet();
  const nav = useNavigation();
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [history, setHistory] = useState<AddressHistorySummaryPage>({ start: 0, total: 0, detail: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => setPage(1), [address]);

  useEffect(() => {
    let active = true;
    if (!address) {
      setHistory({ start: 0, total: 0, detail: [] });
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setError(false);
    wallet
      .getAddressHistory({
        address,
        start: preview ? 0 : (page - 1) * PAGE_SIZE,
        limit: preview ? PREVIEW_LIMIT : PAGE_SIZE
      })
      .then((result) => {
        if (active) setHistory(result);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [address, wallet, page, preview, refreshKey]);

  return (
    <Column gap="sm" fullX>
      {preview && (
        <Row justifyBetween itemsCenter>
          <Text text={t('history')} size="md" color="white" />
          <Text
            text={t('view_all')}
            size="xs"
            color="gold"
            onClick={() => nav.navigate('HistoryScreen')}
            style={{ cursor: 'pointer' }}
          />
        </Row>
      )}
      {loading ? (
        <Text text={t('loading')} color="textDim" size="sm" />
      ) : error ? (
        <Text
          text={t('try_again')}
          color="gold"
          size="sm"
          onClick={() => setRefreshKey((key) => key + 1)}
          style={{ cursor: 'pointer' }}
        />
      ) : history.detail.length === 0 ? (
        <Text text={t('history_no_transactions')} color="textDim" size="sm" />
      ) : (
        <Column gap="zero">
          {history.detail.map((item) => (
            <HistoryRow key={item.txid} item={item} />
          ))}
        </Column>
      )}
      {!preview && history.total > PAGE_SIZE && !loading && !error && (
        <Row justifyCenter mt="md">
          <Pagination
            pagination={{ currentPage: page, pageSize: PAGE_SIZE }}
            total={history.total}
            onChange={(pagination) => setPage(pagination.currentPage)}
          />
        </Row>
      )}
    </Column>
  );
}
