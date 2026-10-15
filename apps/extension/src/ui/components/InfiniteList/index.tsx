import { useEffect, useMemo, useRef, useState } from 'react';

import { Column, Row, Text } from '@/ui/components';
import { AssetEmptyState } from '@/ui/components/Empty/AssetEmptyState';
import { Empty } from '@/ui/components/Empty';
import { Pagination } from '@/ui/components/Pagination';
import { LoadingOutlined } from '@ant-design/icons';
import { useI18n } from '@unisat/wallet-state';

interface InfiniteListProps<T> {
  data: T[];
  renderItem: (item: { item: T; index: number }) => JSX.Element;
  keyExtractor: (item: T, index: number) => string;
  onLoadMore: () => void;
  onRefresh: () => void;
  hasMore: boolean;
  loading: boolean;
  /** Whether to show the loading overlay while a request is in progress. */
  showLoading?: boolean;
  height?: number | string;
  numColumns?: number;
  total: number;
  emptyText?: string;
  emptyPreset?: 'simple' | 'assets';
  /** Show the Assets screen marketplace empty state. */
  emptyMarketplace?: boolean;
  emptyMarketplacePath?: string;
  /** Vertical gap between rows. Use 0 for bordered history-style lists. */
  rowGap?: number;
  /** Number of items shown per UI page; independent of the fetch batch size. */
  pageSize?: number;
  /** Keep the current page when the total changes while more data is loaded. */
  preservePageOnTotalChange?: boolean;
  /** Show the total number of assets above the list. */
  countUnit?: 'asset' | 'collection' | 'inscription';
}

export function InfiniteList<T>({
  data,
  total,
  renderItem,
  keyExtractor,
  onLoadMore,
  onRefresh,
  hasMore,
  loading,
  showLoading,
  height,
  numColumns = 1,
  emptyText,
  emptyPreset = 'assets',
  emptyMarketplace = false,
  emptyMarketplacePath,
  rowGap = 8,
  pageSize = 20,
  preservePageOnTotalChange = false,
  countUnit
}: InfiniteListProps<T>) {
  const { t } = useI18n();
  const [pagination, setPagination] = useState({ currentPage: 1, pageSize });
  const containerRef = useRef<HTMLDivElement>(null);
  const countLabel = countUnit === 'collection'
    ? t(total === 1 ? 'collection' : 'collections')
    : countUnit === 'inscription'
      ? t(total === 1 ? 'inscription' : 'inscriptions')
      : t(total === 1 ? 'asset' : 'assets');

  const pageData = useMemo(() => {
    const start = (pagination.currentPage - 1) * pagination.pageSize;
    const end = pagination.currentPage * pagination.pageSize;
    return data.slice(start, end);
  }, [data, pagination]);

  useEffect(() => {
    if (data.length > 0 && pageData.length < pagination.pageSize && hasMore && !loading) {
      onLoadMore();
    }
  }, [pagination, data.length]);

  useEffect(() => {
    if (!preservePageOnTotalChange) {
      setPagination((current) => ({ currentPage: 1, pageSize: current.pageSize }));
      return;
    }
    setPagination((current) => {
      const lastPage = Math.max(1, Math.ceil(total / current.pageSize));
      return current.currentPage > lastPage ? { ...current, currentPage: lastPage } : current;
    });
  }, [total, preservePageOnTotalChange]);

  useEffect(() => {
    setPagination((current) =>
      current.pageSize === pageSize ? current : { currentPage: 1, pageSize }
    );
  }, [pageSize]);

  const gridRows = useMemo(() => {
    const rows: T[][] = [];
    for (let i = 0; i < pageData.length; i += numColumns) {
      rows.push(pageData.slice(i, i + numColumns));
    }
    return rows;
  }, [pageData, numColumns]);

  if (!loading && data.length === 0) {
    if (emptyMarketplace) return <AssetEmptyState marketplacePath={emptyMarketplacePath} />;
    const isAssetsEmpty = emptyPreset === 'assets';
    return (
      <Column itemsCenter justifyCenter={!isAssetsEmpty} style={isAssetsEmpty ? { paddingTop: 8 } : { minHeight: 150 }}>
        <Empty text={emptyText || t('empty')} preset={emptyPreset} />
      </Column>
    );
  }

  return (
    <Column>
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: height || 'auto',
          overflowY: height ? 'auto' : 'visible'
        }}
      >
        {(showLoading ?? loading) && (
          <Row justifyCenter style={{ position: 'absolute', width: '100%', zIndex: 10, padding: '10px 0' }}>
            <div style={{ backgroundColor: 'rgba(0,0,0,0.7)', padding: '8px 12px', borderRadius: '4px' }}>
              <LoadingOutlined style={{ color: '#ffde04' }} />
            </div>
          </Row>
        )}

        <div style={{ width: '100%' }}>
          {countUnit && total > 0 && data.length > 0 && (
            <Text
              text={`${total} ${countLabel}`}
              size="sm"
              color="white_muted"
              mb="sm"
              style={{ textTransform: 'lowercase' }}
            />
          )}
          {gridRows.map((row, rowIndex) => (
            <div
              key={`row-${rowIndex}`}
              style={{
                width: '100%',
                marginBottom: rowGap,
                display: 'grid',
                gridTemplateColumns: `repeat(${numColumns}, 1fr)`,
                gap: '8px'
              }}
            >
              {row.map((item, idx) => (
                <div key={keyExtractor(item, idx)} style={{ width: '100%' }}>
                  {renderItem({ item, index: idx })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {total > pagination.pageSize && (
        <Row justifyCenter mt="lg">
          <Pagination
            pagination={pagination}
            total={total}
            onChange={(p) => {
              setPagination(p);
            }}
          />
        </Row>
      )}
    </Column>
  );
}
