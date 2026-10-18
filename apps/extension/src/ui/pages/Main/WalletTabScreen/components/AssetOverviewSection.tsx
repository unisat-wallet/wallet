import { useEffect, useRef, useState } from 'react';

import type { AddressAssetOverviewItem } from '@unisat/wallet-shared';
import { AssetTabKey, MoreAssetTabKey, useChainType, useCurrentAddress, useI18n, useNavigation, useWallTabFocusRefresh, useWallet } from '@unisat/wallet-state';

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

function AssetOverviewCard({ item, onClick, isUsdt }: { item: AddressAssetOverviewItem; onClick: () => void; isUsdt: boolean }) {
  const { t } = useI18n();
  const [imageError, setImageError] = useState(false);
  const name = isToken(item) ? item.name || item.symbol :
    item.kind === 'domain' ? item.category :
    item.kind === 'inscription-summary' ? t('ordinals') : item.name;
  const imageUrl = isUsdt ? './images/icons/protocol/usdt-logo.svg' : isToken(item) ? item.logo :
    item.kind === 'ord-collection' ? item.logo :
    item.kind === 'alkanes-collection' ? item.image : '';
  const amount = isToken(item) ? formatBalance(item.balance) :
    `${item.kind === 'inscription-summary' ? item.total : item.count} ${t('items')}`;

  useEffect(() => setImageError(false), [imageUrl]);

  return (
    <button
      type="button"
      className={styles.card}
      onClick={onClick}
      onDragStart={(event) => event.preventDefault()}
      title={name}
    >
      <span className={styles.iconFrame} aria-hidden="true">
        {imageUrl && !imageError ? (
          <img
            className={styles.iconImage}
            src={imageUrl}
            alt=""
            draggable={false}
            onError={() => setImageError(true)}
          />
        ) : item.kind === 'domain' ? (
          <>
            <img
              className={styles.domainBackground}
              src="/images/asset-overview/domain-bg.svg"
              alt=""
              draggable={false}
            />
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
export function AssetOverviewSection({ isRgbActive, rgbUsdtAssetId }: { isRgbActive: boolean; rgbUsdtAssetId: string }) {
  const address = useCurrentAddress();
  const chainType = useChainType();
  return <AssetOverviewContent key={`${chainType}:${address}`} address={address} isRgbActive={isRgbActive} rgbUsdtAssetId={rgbUsdtAssetId} />;
}

function AssetOverviewContent({ address, isRgbActive, rgbUsdtAssetId }: { address: string; isRgbActive: boolean; rgbUsdtAssetId: string }) {
  const wallet = useWallet();
  const nav = useNavigation();
  const { t } = useI18n();
  const focusRefresh = useWallTabFocusRefresh();
  const [result, setResult] = useState<{ address: string; items: AddressAssetOverviewItem[] } | null>(null);
  const [errorAddress, setErrorAddress] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const cardRowRef = useRef<HTMLDivElement>(null);
  const mouseDragRef = useRef<{ startX: number; startScrollLeft: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const drag = mouseDragRef.current;
      const element = cardRowRef.current;
      if (!drag || !element) return;

      const deltaX = event.clientX - drag.startX;
      if (Math.abs(deltaX) > 4) drag.moved = true;
      if (drag.moved) {
        element.scrollLeft = drag.startScrollLeft - deltaX;
        event.preventDefault();
      }
    };

    const onMouseUp = (event: MouseEvent) => {
      const drag = mouseDragRef.current;
      if (drag?.moved && cardRowRef.current?.contains(event.target as Node)) {
        suppressClickRef.current = true;
      }
      mouseDragRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

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
  }, [address, wallet, focusRefresh, refreshKey, isRgbActive]);

  const overviewItems = result?.address === address ? result.items : null;
  const configuredUsdtId = isRgbActive ? rgbUsdtAssetId : '';
  const isRgbUsdt = (item: AddressAssetOverviewItem) => item.kind === 'rgb' &&
    !!configuredUsdtId && item.tokenId.replace(/^rgb:/i, '') === configuredUsdtId.replace(/^rgb:/i, '');
  const items = overviewItems?.filter(item => !(
    isRgbUsdt(item) && isToken(item) && /^0+(?:\.0+)?$/.test(item.balance.trim())
  )) ?? null;
  const openAssets = () => nav.navigate('AssetsTabScreen');
  const openItem = (item: AddressAssetOverviewItem) => {
    switch (item.kind) {
      case 'brc20':
        nav.navigate('BRC20TokenScreen', { ticker: item.tokenId });
        break;
      case 'rune':
        nav.navigate('RunesTokenScreen', { runeid: item.tokenId });
        break;
      case 'alkanes':
        nav.navigate('AlkanesTokenScreen', { alkaneid: item.tokenId });
        break;
      case 'rgb':
        nav.navigate('RGBTokenScreen', { assetId: item.tokenId });
        break;
      case 'inscription-summary':
      case 'domain':
        nav.navigate('AssetsTabScreen', { assetTabKey: AssetTabKey.ORDINALS });
        break;
      case 'alkanes-collection':
        nav.navigate('AssetsTabScreen', {
          assetTabKey: AssetTabKey.ALKANES,
          moreAssetTabKey: MoreAssetTabKey.ALKANES_COLLECTION
        });
        break;
      default:
        openAssets();
    }
  };

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
          <div
            ref={cardRowRef}
            className={styles.cardRow}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              mouseDragRef.current = {
                startX: event.clientX,
                startScrollLeft: event.currentTarget.scrollLeft,
                moved: false
              };
            }}
            onClickCapture={(event) => {
              if (!suppressClickRef.current) return;
              suppressClickRef.current = false;
              event.preventDefault();
              event.stopPropagation();
            }}
            onWheel={(event) => {
              // Let browsers handle trackpad's native horizontal gesture for smooth scrolling.
              if (event.deltaX !== 0 || event.deltaY === 0) return;
              const element = event.currentTarget;
              const nextScrollLeft = Math.max(
                0,
                Math.min(element.scrollWidth - element.clientWidth, element.scrollLeft + event.deltaY)
              );
              if (nextScrollLeft !== element.scrollLeft) {
                element.scrollLeft = nextScrollLeft;
                event.preventDefault();
              }
            }}
          >
            {items.map((item) => <AssetOverviewCard key={getItemKey(item)} item={item} isUsdt={isRgbUsdt(item)} onClick={() => openItem(item)} />)}
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
