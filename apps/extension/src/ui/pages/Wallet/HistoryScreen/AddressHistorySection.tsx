import { useEffect, useState } from 'react';

import { Column, Row, Text } from '@/ui/components';
import { Pagination } from '@/ui/components/Pagination';
import type {
  AddressHistoryAssetItem,
  AddressHistorySummaryItem,
  AddressHistorySummaryPage
} from '@unisat/wallet-shared';
import { useCurrentAddress, useI18n, useNavigation, useWallet } from '@unisat/wallet-state';

import { HistoryDetailSheet } from './HistoryDetailSheet';
import styles from './history.module.less';
import { getHistoryAssetChanges, getHistoryDate, type HistoryAssetChange } from './historyAssetView';

const PREVIEW_LIMIT = 5;
const PAGE_SIZE = 20;

function HistoryAssetIcon({ asset }: { asset: AddressHistoryAssetItem }) {
  if (asset.kind === 'coin') {
    return (
      <span className={styles.assetIconFrame} aria-hidden="true">
        <img src="/images/history/bitcoin.png" alt="" className={styles.assetIcon} />
      </span>
    );
  }

  const protocolIcon =
    asset.kind === 'inscription'
      ? '/images/history/ordinals.svg'
      : asset.kind === 'alkanes'
      ? '/images/history/alkanes.svg'
      : '';

  return (
    <span className={styles.assetIconFrame} aria-hidden="true">
      <img src="/images/history/asset-base.svg" alt="" className={styles.assetIconBase} />
      {protocolIcon ? (
        <img src={protocolIcon} alt="" className={styles.protocolIcon} />
      ) : (
        <span className={styles.assetInitial}>{(asset.symbol || asset.kind).slice(0, 2).toUpperCase()}</span>
      )}
    </span>
  );
}

function HistoryChange({ change }: { change: HistoryAssetChange }) {
  const label = change.asset.displayName || change.asset.symbol || change.asset.kind;
  const value = `${change.sign}${change.asset.amount} ${label}`;
  return (
    <span className={change.sign === '+' ? styles.receivedAmount : styles.sentAmount} title={value}>
      {value}
    </span>
  );
}

function HistoryRow({ item, onClick }: { item: AddressHistorySummaryItem; onClick: () => void }) {
  const { t } = useI18n();
  const { changes, total } = getHistoryAssetChanges(item);
  const primary = changes[0];
  if (!primary) return null;
  const directionLabel = item.direction === 'mixed' ? t('mixed') : primary.sign === '+' ? t('receive') : t('send');
  const assetKind = primary.asset.kind;
  const assetCategory =
    assetKind === 'coin'
      ? primary.asset.symbol
      : assetKind === 'inscription'
      ? t('ordinals')
      : assetKind === 'runes' || assetKind === 'alkanes' || assetKind === 'brc20'
      ? t(assetKind)
      : assetKind.replaceAll('_', '-').toUpperCase();
  const subtitle = item.status === 'pending' ? `${assetCategory} · ${t('history_pending')}` : assetCategory;

  return (
    <button type="button" className={styles.historyRow} onClick={onClick} data-testid={`history-${item.txid}`}>
      <span className={styles.rowLeading}>
        <HistoryAssetIcon asset={primary.asset} />
        <span className={styles.rowLabels}>
          <span className={styles.rowTitle}>{directionLabel}</span>
          <span className={styles.rowSubtitle} title={item.txid}>
            {subtitle}
          </span>
        </span>
      </span>
      <span className={styles.rowAmounts}>
        <HistoryChange change={primary} />
        {changes[1] && <HistoryChange change={changes[1]} />}
        {total > 2 && <span className={styles.moreCount}>{t('history_more_count', String(total - 2))}</span>}
      </span>
    </button>
  );
}

type HistoryFilter = 'all' | 'receive' | 'send';

/** Displays address history as asset changes, with transaction details one tap away. */
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
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<AddressHistorySummaryItem>();

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
      .getAddressHistory({ address, start: preview ? 0 : (page - 1) * PAGE_SIZE, limit: PAGE_SIZE })
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

  const visibleItems = history.detail
    .filter((item) => getHistoryAssetChanges(item).total > 0)
    .filter((item) => {
      if (filter === 'all') return true;
      return getHistoryAssetChanges(item).changes.some((change) => change.sign === (filter === 'receive' ? '+' : '-'));
    })
    .slice(0, preview ? PREVIEW_LIMIT : undefined);
  const groupedItems = visibleItems.reduce<{ date: string; items: AddressHistorySummaryItem[] }[]>((groups, item) => {
    const date = getHistoryDate(item.timestamp);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.date === date) lastGroup.items.push(item);
    else groups.push({ date, items: [item] });
    return groups;
  }, []);

  return (
    <Column gap="lg" fullX classname={styles.historySection}>
      <div className={styles.historyHeader}>
        {preview && <Text text={t('history')} size="md" color="white" />}
        <div className={styles.filterContainer}>
          <button
            type="button"
            className={styles.filterButton}
            aria-label={t('filter')}
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
          >
            <img src="/images/history/filter.svg" alt="" />
          </button>
          {filterOpen && (
            <div className={styles.filterMenu}>
              {(['all', 'receive', 'send'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={filter === key ? styles.filterActive : styles.filterOption}
                  onClick={() => {
                    setFilter(key);
                    setFilterOpen(false);
                  }}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
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
      ) : visibleItems.length === 0 ? (
        <Text
          text={t(history.total > 0 ? 'history_no_asset_change' : 'history_no_transactions')}
          color="textDim"
          size="sm"
        />
      ) : (
        <div className={styles.historyGroups}>
          {groupedItems.map((group, index) => (
            <section key={`${group.date}-${index}`} className={styles.historyGroup}>
              {group.date && <div className={styles.dateLabel}>{group.date}</div>}
              <div className={styles.historyRows}>
                {group.items.map((item) => (
                  <HistoryRow key={item.txid} item={item} onClick={() => setSelectedItem(item)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {preview && address && history.total > 0 && (
        <button type="button" className={styles.viewAllButton} onClick={() => nav.navToExplorerAddress(address)}>
          {t('view_on_uniscan')}
          <span className={styles.viewAllArrow} aria-hidden="true">
            <img src="/images/history/view-all-arrow.svg" alt="" />
          </span>
        </button>
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
      {selectedItem && <HistoryDetailSheet summary={selectedItem} onClose={() => setSelectedItem(undefined)} />}
    </Column>
  );
}
