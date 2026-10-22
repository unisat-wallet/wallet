import { useEffect, useState } from 'react';

import { IMAGE_SOURCE_MAP } from '@/shared/constant';
import { Column, Icon, Row, Text, Tooltip } from '@/ui/components';
import { Pagination } from '@/ui/components/Pagination';
import { fontSizes } from '@/ui/theme/font';
import { shortAddress } from '@/ui/utils';
import type {
  AddressHistoryAssetItem,
  AddressHistorySummaryItem,
  AddressHistorySummaryPage
} from '@unisat/wallet-shared';
import { useChain, useChainType, useCurrentAddress, useI18n, useNavigation, useWallet } from '@unisat/wallet-state';

import { HistoryDetailSheet } from './HistoryDetailSheet';
import { HistoryTokenIcon } from './HistoryTokenIcon';
import styles from './history.module.less';
import {
  getHistoryAssetChanges,
  getHistoryDate,
  getHistoryTitle,
  type HistoryAssetChange
} from './historyAssetView';

const PREVIEW_LIMIT = 10;
const PAGE_SIZE = 20;

function HistoryAssetIcon({ asset }: { asset: AddressHistoryAssetItem }) {
  const chain = useChain();
  if (asset.kind === 'coin') {
    return (
      <span className={styles.assetIconFrame} aria-hidden="true">
        <img src={IMAGE_SOURCE_MAP[chain.icon]} alt="" className={styles.assetIcon} />
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
      <HistoryTokenIcon
        asset={asset}
        className={styles.assetIcon}
        fallback={
          protocolIcon ? (
            <img src={protocolIcon} alt="" className={styles.protocolIcon} />
          ) : (
            <span className={styles.assetInitial}>{(asset.symbol || asset.kind).slice(0, 2).toUpperCase()}</span>
          )
        }
      />
    </span>
  );
}

function HistoryChange({
  change,
  hideAmount = false
}: {
  change: HistoryAssetChange;
  hideAmount?: boolean;
}) {
  const chain = useChain();
  const label =
    change.asset.kind === 'coin' ? chain.unit : change.asset.displayName || change.asset.symbol || change.asset.kind;
  const value = hideAmount ? label : `${change.sign}${change.asset.amount} ${label}`;
  return (
    <span className={change.sign === '+' ? styles.receivedAmount : styles.sentAmount} title={value}>
      {value}
    </span>
  );
}

type HistoryAssetCategoryTone = 'brc20' | 'runes' | 'alkanes' | 'cat20' | 'inscription' | 'default';

function getHistoryAssetCategory(kind: AddressHistoryAssetItem['kind'], unit: string, t: (key: string) => string) {
  if (kind === 'coin') return { label: unit, tone: 'default' as const };
  if (kind === 'inscription') return { label: t('inscriptions'), tone: 'inscription' as const };
  if (kind === 'brc20' || kind === 'brc20_prog') return { label: t('brc20'), tone: 'brc20' as const };
  if (kind === 'runes') return { label: t('runes'), tone: 'runes' as const };
  if (kind === 'alkanes') return { label: t('alkanes'), tone: 'alkanes' as const };
  if (kind === 'cat20' || kind === 'cat20_v2') return { label: 'CAT20', tone: 'cat20' as const };
  return { label: kind.replaceAll('_', '-').toUpperCase(), tone: 'default' as const };
}

const assetCategoryToneClass: Record<HistoryAssetCategoryTone, string> = {
  brc20: styles.assetCategory_brc20,
  runes: styles.assetCategory_runes,
  alkanes: styles.assetCategory_alkanes,
  cat20: styles.assetCategory_cat20,
  inscription: styles.assetCategory_inscription,
  default: styles.assetCategory_default
};

function HistoryRow({ item, onClick }: { item: AddressHistorySummaryItem; onClick: () => void }) {
  const { t } = useI18n();
  const chain = useChain();
  const isSelfTransfer = item.direction === 'self';
  const { changes, total } = getHistoryAssetChanges(item);
  const primary = changes[0];
  if (!primary) return null;
  const directionLabel = getHistoryTitle(item, primary.sign === '+', t);
  const { label: assetCategory, tone } = getHistoryAssetCategory(primary.asset.kind, chain.unit, t);

  return (
    <button type="button" className={styles.historyRow} onClick={onClick} data-testid={`history-${item.txid}`}>
      <span className={styles.rowLeading}>
        <HistoryAssetIcon asset={primary.asset} />
        <span className={styles.rowLabels}>
          <span className={styles.rowTitle}>{directionLabel}</span>
          <span className={styles.rowSubtitle}>
            <span className={`${styles.assetCategoryTag} ${assetCategoryToneClass[tone]}`}>{assetCategory}</span>
            {item.status === 'pending' ? <span className={styles.rowPending}> · {t('history_pending')}</span> : null}
          </span>
          {item.toAddress && (
            <span className={styles.rowSubtitle} title={item.toAddress}>
              {t('to')}: {shortAddress(item.toAddress, 5)}
            </span>
          )}
        </span>
      </span>
      <span className={styles.rowAmounts}>
        {isSelfTransfer ? (
          <span className={styles.sentAmount}>
            -{(item.feeSatoshis / 100_000_000).toFixed(8)} {chain.unit}
          </span>
        ) : (
          <>
            <HistoryChange change={primary} hideAmount={item.display?.hideAmount} />
            {changes[1] && <HistoryChange change={changes[1]} hideAmount={item.display?.hideAmount} />}
            {total > 2 && (
              <span className={styles.moreCount}>{t('history_more_count', String(total - 2))}</span>
            )}
          </>
        )}
      </span>
    </button>
  );
}

type HistoryFilter = 'all' | 'receive' | 'send';

/** Displays address history as asset changes, with transaction details one tap away. */
export function AddressHistorySection({
  preview = false,
  unavailable = false,
  showRgbHistoryHint = false
}: {
  preview?: boolean;
  unavailable?: boolean;
  showRgbHistoryHint?: boolean;
}) {
  const address = useCurrentAddress();
  const chainType = useChainType();
  if (unavailable && preview) return <AddressHistoryUnavailable address={address} />;
  return (
    <AddressHistoryContent
      key={`${chainType}:${address}`}
      address={address}
      preview={preview}
      showRgbHistoryHint={showRgbHistoryHint}
    />
  );
}

function AddressHistoryUnavailable({ address }: { address: string }) {
  const chain = useChain();
  const nav = useNavigation();
  const { t } = useI18n();
  return (
    <Column gap="lg" fullX classname={styles.historySection}>
      <div className={styles.historyHeader}>
        <Text text={t('history')} size="md" color="white" />
      </div>
      <Text text={t('home_history_shortcut_description')} color="textDim" size="sm" />
      {address && (
        <button type="button" className={styles.viewAllButton} onClick={() => nav.navToExplorerAddress(address)}>
          {t(chain.unisatExplorerUrl ? 'view_on_uniscan' : 'view_on_explorer')}
          <span className={styles.viewAllArrow} aria-hidden="true">
            <img src="/images/history/view-all-arrow.svg" alt="" />
          </span>
        </button>
      )}
    </Column>
  );
}

function AddressHistoryContent({
  address,
  preview,
  showRgbHistoryHint
}: {
  address: string;
  preview: boolean;
  showRgbHistoryHint: boolean;
}) {
  const wallet = useWallet();
  const nav = useNavigation();
  const { t, locale } = useI18n();
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
      .getAddressHistory({ address, start: preview ? 0 : (page - 1) * PAGE_SIZE, limit: PAGE_SIZE, locale })
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
  }, [address, wallet, page, preview, refreshKey, locale]);

  const visibleItems = history.detail
    .filter((item) => getHistoryAssetChanges(item).total > 0)
    .filter((item) => {
      if (filter === 'all') return true;
      if (item.direction === 'self') return filter === 'send';
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
        {preview && (
          <div className={styles.historyTitle}>
            <Text text={t('history')} size="md" color="white" />
            {showRgbHistoryHint ? (
              <Tooltip
                title={t('history_rgb_not_included')}
                placement="top"
                overlayStyle={{
                  fontSize: fontSizes.xs,
                  maxWidth: 280,
                  lineHeight: '16px'
                }}>
                <div className={styles.historyHint} aria-label={t('history_rgb_not_included')}>
                  <Icon
                    icon="balance-question"
                    size={18}
                    containerStyle={{
                      display: 'block',
                      filter: 'brightness(0) invert(1)',
                      opacity: 0.65
                    }}
                  />
                </div>
              </Tooltip>
            ) : null}
          </div>
        )}
        {!preview && (
          <div className={styles.filterContainer}>
            <button
              type="button"
              className={styles.filterButton}
              aria-label={t('filter')}
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}>
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
                    }}>
                    {t(key)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
