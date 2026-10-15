import { useEffect, useState } from 'react';

import type { AddressAssetOverviewItem } from '@unisat/wallet-shared';
import { useCurrentAddress, useI18n, useNavigation, useWallTabFocusRefresh, useWallet } from '@unisat/wallet-state';

import styles from './asset-overview.module.less';

function isToken(item: AddressAssetOverviewItem): item is Extract<AddressAssetOverviewItem, { tokenId: string }> {
  return 'tokenId' in item;
}

function getItemKey(item: AddressAssetOverviewItem) {
  if (isToken(item)) return `${item.kind}:${item.tokenId}`;
  if (item.kind === 'alkanes-collection') return `${item.kind}:${item.alkaneid}`;
  if (item.kind === 'domain') return `${item.kind}:${item.category}`;
  if (item.kind === 'inscription-summary') return item.kind;
  return `${item.kind}:${item.collectionId}`;
}

function formatBalance(value: string) {
  const [whole, fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function AssetOverviewCard({ item, onClick }: { item: AddressAssetOverviewItem; onClick: () => void }) {
  const { t } = useI18n();
  const [imageError, setImageError] = useState(false);
  const name = isToken(item) ? item.name || item.symbol :
    item.kind === 'domain' ? item.category :
    item.kind === 'inscription-summary' ? t('ordinals') : item.name;
  const imageUrl = isToken(item) ? item.logo :
    item.kind === 'ord-collection' ? item.logo :
    item.kind === 'alkanes-collection' ? item.image : '';
  const amount = isToken(item) ? formatBalance(item.balance) :
    `${item.kind === 'inscription-summary' ? item.total : item.count} ${t('items')}`;

  useEffect(() => setImageError(false), [imageUrl]);

  return (
    <button type="button" className={styles.card} onClick={onClick} title={name}>
      <span className={styles.iconFrame} aria-hidden="true">
        {imageUrl && !imageError ? (
          <img className={styles.iconImage} src={imageUrl} alt="" onError={() => setImageError(true)} />
        ) : item.kind === 'domain' ? (
          <>
            <img className={styles.domainBackground} src="/images/asset-overview/domain-bg.svg" alt="" />
            <span className={styles.domainLabel}>{item.category.replace(/^\./, '').slice(0, 3)}</span>
          </>
        ) : (
          <span className={styles.iconFallback}>{name.slice(0, 2).toUpperCase()}</span>
        )}
      </span>
      <span className={styles.cardText}>
        <span className={styles.cardName}>{name}</span>
        <span className={isToken(item) ? styles.tokenAmount : styles.itemCount}>{amount}</span>
      </span>
    </button>
  );
}

/** Small homepage preview of the address's assets. */
export function AssetOverviewSection() {
  const address = useCurrentAddress();
  const wallet = useWallet();
  const nav = useNavigation();
  const { t } = useI18n();
  const focusRefresh = useWallTabFocusRefresh();
  const [result, setResult] = useState<{ address: string; items: AddressAssetOverviewItem[] } | null>(null);
  const [errorAddress, setErrorAddress] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!address) return;
    let active = true;
    setErrorAddress(null);
    wallet.getAddressAssetOverview(address)
      .then(({ list }) => {
        if (active) {
          setResult({ address, items: list });
          setErrorAddress(null);
        }
      })
      .catch(() => {
        if (active) setErrorAddress(address);
      });
    return () => { active = false; };
  }, [address, wallet, focusRefresh, refreshKey]);

  const items = result?.address === address ? result.items : null;
  const openAssets = () => nav.navigate('AssetsTabScreen');

  return (
    <section className={styles.section} aria-label={t('assets')}>
      <div className={styles.header}>
        <span className={styles.title}>{t('assets')}</span>
        <button type="button" className={styles.viewAll} onClick={openAssets}>
          {t('view_all')}
          <svg className={styles.viewAllArrow} viewBox="0 0 12 6.7301" aria-hidden="true">
            <path
              d="M6 6.7301C5.83324 6.7301 5.67344 6.66297 5.55671 6.54385L0.177404 1.05516C-0.0625558 0.810352 -0.0585774 0.417367 0.18625 0.177428C0.431056 -0.0624896 0.824063 -0.0585535 1.06398 0.186274L6 5.22266L10.936 0.186274C11.1759 -0.0585747 11.5689 -0.0625742 11.8137 0.177428C12.0586 0.417388 12.0625 0.810352 11.8226 1.05516L6.44328 6.54385C6.32655 6.66297 6.16678 6.7301 6 6.7301Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
      {items?.length ? (
        <div className={styles.cardViewport}>
          <div className={styles.cardRow}>
            {items.map((item) => <AssetOverviewCard key={getItemKey(item)} item={item} onClick={openAssets} />)}
          </div>
        </div>
      ) : (
        <div className={styles.emptyRow}>
          {errorAddress === address ? (
            <button type="button" className={styles.retry} onClick={() => setRefreshKey((key) => key + 1)}>
              {t('try_again')}
            </button>
          ) : items ? t('assets_no_assets') : t('loading')}
        </div>
      )}
    </section>
  );
}
