import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, Card, Column, Content, Footer, Header, Layout, Row, Text } from '@/ui/components';
import AccountSelect from '@/ui/components/AccountSelect';
import { FeeRateIcon } from '@/ui/components/FeeRateIcon';
import LoadingPage from '@/ui/components/LoadingPage';
import { NavTabBar } from '@/ui/components/NavTabBar';
import { NoticePopover } from '@/ui/components/NoticePopover';
import { SwitchNetworkBar } from '@/ui/components/SwitchNetworkBar';
import { Tabs } from '@/ui/components/Tabs';
import { VersionNotice } from '@/ui/components/VersionNotice';
import { dismissAssetsNewBadge } from '@/ui/utils/assetsNewBadge';
import { getCurrentTab } from '@/ui/web/tabs';
import { KeyringType } from '@unisat/keyring-service/types';
import { AddressAssetSummary, Brc20TickFilter, VersionDetail } from '@unisat/wallet-shared';
import '@unisat/wallet-state';
import {
  AssetTabKey,
  MoreAssetTabKey,
  UNCONFIGURED_RGB_USDT_ASSET_ID,
  getReadyRgbBroadcasts,
  selectReadyRgbBroadcastId,
  uiActions,
  useAppDispatch,
  useAssetTabKey,
  useChain,
  useCurrentAccount,
  useCurrentKeyring,
  useI18n,
  useIsUnlocked,
  useMoreAssetTabKey,
  useNavigation,
  useRGBListLogic,
  useRGBTransfersLogic,
  useSupportedAssets,
  useTools,
  useVersionInfo,
  useWallTabFocusRefresh,
  useWallet,
  useWalletConfig,
  type RgbTransferItem
} from '@unisat/wallet-state';

import { useNavigate } from '../../MainRoute';
import { RGBTransferDetailSheet } from '../../RGB/RGBTransferDetailSheet';
import { RgbFeatureActivationModal } from '../../RGB/components/RgbFeatureActivationModal';
import { RgbRecoveryConflictModal } from '../../RGB/components/RgbRecoveryConflictModal';
import { SwitchChainModal } from '../../Settings/SwitchChainModal';
import { AddressHistorySection } from '../../Wallet/HistoryScreen/AddressHistorySection';
import { AlkanesCollectionList } from './AlkanesCollectionList';
import { AlkanesList } from './AlkanesList';
import { BRC20Tab } from './BRC20Tab';
import { OrdinalsTab } from './OrdinalsTab';
import { RGBHomeTabs } from './RGBHomeTabs';
import { RunesList } from './RunesList';
import { SidePanelExpand } from './SidePanelExpand';
import { AnnouncementCard } from './components/AnnouncementCard';
import { AssetOverviewSection } from './components/AssetOverviewSection';
import { BalanceCard } from './components/BalanceCard';
import { HomeTips } from './components/HomeTips';
import { WalletActions } from './components/WalletActions';

const STORAGE_VERSION_KEY = 'version_detail';
const ASSET_TAB_STORAGE_PREFIX = 'asset_tab_selection_v1:';
const ALKANES_COLLECTION_TAB_KEY = 'alkanes_collection';
const NOTIFICATION_REFRESH_INTERVAL = 10_000;
let lastNotificationRefreshAt = 0;
const ASSET_COUNT_CACHE_MS = 10_000;
const recentAssetTabCounts = new Map<string, {
  promise: Promise<{ summary: AddressAssetSummary; brc20Count: number }>;
  expiresAt: number;
}>();
const assetTabLabel = (name: string, count: number, showCount: boolean) =>
  showCount && count > 0 ? `${name} (${count > 1000 ? '>1k' : count})` : name;
const dismissedRgbBroadcastIdsByContext = new Map<string, Set<string>>();
const dismissedRgbAcceptanceIdsByContext = new Map<string, Set<string>>();

function getDismissedIdsForContext(
  contextKey: string,
  localIdsByContext: Map<string, Set<string>>,
  sessionIdsByContext: Map<string, Set<string>>
) {
  return new Set([...(sessionIdsByContext.get(contextKey) ?? []), ...(localIdsByContext.get(contextKey) ?? [])]);
}

function rememberDismissedId(idsByContext: Map<string, Set<string>>, contextKey: string, id: string) {
  idsByContext.set(contextKey, new Set(idsByContext.get(contextKey)).add(id));
}

function getPendingRgbAcceptances(items: ReturnType<typeof useRGBTransfersLogic>['items'], dismissedIds: Set<string>) {
  return items
    .filter(
      (item) =>
        item.type === 'receive' &&
        item.local === true &&
        ['pending_accept', 'validation_failed'].includes(item.status.toLowerCase()) &&
        !dismissedIds.has(item.transferId || item.id)
    )
    .sort((left, right) => right.timestamp - left.timestamp);
}

function selectPendingRgbAcceptanceId(
  pendingAcceptances: ReturnType<typeof getPendingRgbAcceptances>,
  activeId?: string
) {
  if (activeId && pendingAcceptances.some((item) => (item.transferId || item.id) === activeId)) return activeId;
  const first = pendingAcceptances[0];
  return first?.transferId || first?.id;
}

export default function WalletTabScreen({
  screen = 'home',
  preferredAssetTab
}: {
  screen?: 'home' | 'assets';
  preferredAssetTab?: { assetTabKey: AssetTabKey; moreAssetTabKey?: MoreAssetTabKey };
}) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const chain = useChain();

  const currentKeyring = useCurrentKeyring();
  const currentAccount = useCurrentAccount();

  const wallet = useWallet();
  const rgbUsdtAssetId = useWalletConfig().rgbUsdtAssetId?.trim() || '';
  const [connected, setConnected] = useState(false);
  const dispatch = useAppDispatch();
  const assetTabKey = useAssetTabKey();
  const moreAssetTabKey = useMoreAssetTabKey();
  const tools = useTools();

  const versionInfo = useVersionInfo();

  const [showSafeNotice, setShowSafeNotice] = useState(false);
  const [showVersionNotice, setShowVersionNotice] = useState<VersionDetail | null>(null);

  const nav = useNavigation();
  const isUnlocked = useIsUnlocked();

  useEffect(() => {
    if (!isUnlocked) {
      nav.navToLock({
        autoUnlockByFace: false
      });
    }
  }, [isUnlocked]);

  useEffect(() => {
    const run = async () => {
      // Home and Assets mount this screen separately. A tab switch should not
      // fetch the same server notification list again within the polling window.
      const now = Date.now();
      if (now - lastNotificationRefreshAt >= NOTIFICATION_REFRESH_INTERVAL) {
        lastNotificationRefreshAt = now;
        void wallet.getNotifications().catch((error) => {
          console.warn('Failed to refresh notifications', error);
        });
      }

      const show = await wallet.getShowSafeNotice();
      setShowSafeNotice(show);

      const activeTab = await getCurrentTab();
      if (!activeTab) return;
      const site = await wallet.getCurrentConnectedSite(activeTab.id);
      if (site) {
        setConnected(site.isConnected);
      }
    };
    run();
  }, []);

  // Entering Assets dismisses the "New" badge for the current address only.
  useEffect(() => {
    if (screen !== 'assets') return;
    const address = currentAccount?.address;
    if (!address) return;
    dismissAssetsNewBadge(address);
    void wallet.setAssetsNewBadgeDismissed(address, true);
  }, [screen, wallet, currentAccount?.address]);

  useEffect(() => {
    const run = async () => {
      try {
        let needFetchVersionDetail = false;
        const item = localStorage.getItem(STORAGE_VERSION_KEY);
        let versionDetail: VersionDetail | undefined = undefined;
        if (!item) {
          needFetchVersionDetail = true;
        } else {
          versionDetail = JSON.parse(item || '{}');
          if (versionDetail && versionDetail.version !== versionInfo.currentVersion) {
            needFetchVersionDetail = true;
          }
        }
        if (needFetchVersionDetail) {
          versionDetail = await wallet.getVersionDetail(versionInfo.currentVersion);
          localStorage.setItem(STORAGE_VERSION_KEY, JSON.stringify(versionDetail));

          if (versionDetail && versionDetail.notice) {
            setShowVersionNotice(versionDetail);
          }
        }
      } catch (e) {
        console.log(e);
      }
    };
    run();
  }, []);

  const supportedAssets = useSupportedAssets();
  const walletTabFocusRefresh = useWallTabFocusRefresh();
  const assetContextKey = `${chain.enum}:${currentAccount.key}:${currentAccount.address}`;
  const rgbContextKey = `${assetContextKey}:${currentKeyring?.key ?? ''}`;
  const [assetCounts, setAssetCounts] = useState<{
    key: string;
    summary: AddressAssetSummary;
    brc20Count: number;
  } | null>(null);
  const [rgbAssetCount, setRgbAssetCount] = useState<{ key: string; count: number } | null>(null);
  const [assetCountErrorKey, setAssetCountErrorKey] = useState<string | null>(null);
  const [pinnedSelection, setPinnedSelection] = useState<{ contextKey: string; tabKey: string } | null>(null);
  const [restoredTabContextKey, setRestoredTabContextKey] = useState('');
  const [rgbFeatureEnabled, setRgbFeatureEnabled] = useState(false);
  const [rgbRemoteRecoveryAvailable, setRgbRemoteRecoveryAvailable] = useState(false);
  const [rgbStatusContextKey, setRgbStatusContextKey] = useState('');
  const [rgbStatusErrorKey, setRgbStatusErrorKey] = useState('');
  const [rgbStatusRetry, setRgbStatusRetry] = useState({ contextKey: '', count: 0 });
  const [rgbActivationOpen, setRgbActivationOpen] = useState(false);
  const [rgbActivationLoading, setRgbActivationLoading] = useState(false);

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    if (!supportedAssets.assets.rgb) {
      setRgbFeatureEnabled(false);
      setRgbRemoteRecoveryAvailable(false);
      setRgbStatusErrorKey('');
      setRgbStatusContextKey(rgbContextKey);
      return () => {
        active = false;
      };
    }
    if (!isUnlocked) {
      setRgbStatusContextKey('');
      return () => {
        active = false;
      };
    }
    void wallet
      .getRgbFeatureStatus()
      .then((status) => {
        if (!active) return;
        setRgbFeatureEnabled(status.enabled && status.supported);
        setRgbRemoteRecoveryAvailable(!status.enabled && status.supported && status.remoteRecoveryAvailable);
        setRgbStatusErrorKey('');
        setRgbStatusContextKey(rgbContextKey);
      })
      .catch(() => {
        if (active) {
          if (rgbStatusRetry.contextKey !== rgbContextKey || rgbStatusRetry.count === 0) {
            retryTimer = setTimeout(() => setRgbStatusRetry({ contextKey: rgbContextKey, count: 1 }), 500);
          } else {
            setRgbStatusErrorKey(rgbContextKey);
            setRgbStatusContextKey(rgbContextKey);
          }
        }
      });
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [rgbContextKey, supportedAssets.assets.rgb, isUnlocked, walletTabFocusRefresh, rgbStatusRetry, wallet]);

  useEffect(() => {
    setRgbActivationOpen(false);
  }, [rgbContextKey]);

  const onRgbFeatureEnabled = useCallback(() => {
    setRgbFeatureEnabled(true);
    setRgbRemoteRecoveryAvailable(false);
    setRgbStatusErrorKey('');
    setRgbStatusContextKey(rgbContextKey);
  }, [rgbContextKey]);

  const isRgbActive = supportedAssets.assets.rgb && rgbStatusContextKey === rgbContextKey && rgbFeatureEnabled;
  const rgbRecoveryAvailable = rgbStatusContextKey === rgbContextKey && rgbRemoteRecoveryAvailable;
  useEffect(() => {
    if (screen !== 'assets' || !currentAccount.address) return;
    let active = true;
    const cacheKey = JSON.stringify([
      assetContextKey, currentKeyring?.key, supportedAssets.assets.brc20, walletTabFocusRefresh
    ]);
    let cached = recentAssetTabCounts.get(cacheKey);
    if (!cached || cached.expiresAt <= Date.now()) {
      cached = {
        promise: Promise.all([
          wallet.getAddressAssetSummary(currentAccount.address),
          supportedAssets.assets.brc20
            ? wallet
                .getBRC20List({
                  address: currentAccount.address,
                  currentPage: 1,
                  pageSize: 1,
                  tickFilter: Brc20TickFilter.TICK_BYTES_4_5_6
                })
                .then((result) => result.total)
                .catch(() => null)
            : Promise.resolve(null)
        ]).then(([summary, brc20Count]) => ({
          summary,
          brc20Count: Math.max(summary.brc20Count, brc20Count ?? 0)
        })),
        expiresAt: Number.POSITIVE_INFINITY
      };
      recentAssetTabCounts.delete(cacheKey);
      recentAssetTabCounts.set(cacheKey, cached);
      if (recentAssetTabCounts.size > 20) {
        const oldestKey = recentAssetTabCounts.keys().next().value;
        if (oldestKey !== undefined) recentAssetTabCounts.delete(oldestKey);
      }
      const entry = cached;
      void entry.promise.then(
        () => { entry.expiresAt = Date.now() + ASSET_COUNT_CACHE_MS; },
        () => { if (recentAssetTabCounts.get(cacheKey) === entry) recentAssetTabCounts.delete(cacheKey); }
      );
    }
    void cached.promise
      .then(({ summary, brc20Count }) => {
        if (active) {
          setAssetCounts({
            key: assetContextKey,
            summary,
            brc20Count
          });
          setAssetCountErrorKey(null);
        }
      })
      .catch((error) => {
        console.error('Failed to load asset tab counts', error);
        if (active) setAssetCountErrorKey(assetContextKey);
      });
    return () => {
      active = false;
    };
  }, [screen, assetContextKey, currentKeyring?.key, walletTabFocusRefresh, supportedAssets.assets.brc20, wallet]);

  useEffect(() => {
    if (screen !== 'assets' || !currentAccount.address || !isRgbActive) return;
    let active = true;
    void Promise.all([
      wallet.getRGBList('', 1, 1, { skipSync: true }),
      rgbUsdtAssetId && rgbUsdtAssetId !== UNCONFIGURED_RGB_USDT_ASSET_ID
        ? wallet.getRGBAssetBalance('', rgbUsdtAssetId).catch(() => undefined)
        : Promise.resolve(undefined)
    ])
      .then(([result, usdtBalance]) => {
        if (active) {
          setRgbAssetCount({
            key: rgbContextKey,
            count: result.total + (rgbUsdtAssetId && !usdtBalance ? 1 : 0)
          });
        }
      })
      .catch(() => {
        if (active && rgbUsdtAssetId) setRgbAssetCount({ key: rgbContextKey, count: 1 });
      });
    return () => {
      active = false;
    };
  }, [screen, rgbContextKey, walletTabFocusRefresh, isRgbActive, rgbUsdtAssetId, wallet]);

  const effectiveAssetTabKey = assetTabKey === AssetTabKey.MORE ? AssetTabKey.ALKANES : assetTabKey;
  const isRgbAssetTab =
    screen === 'assets' && restoredTabContextKey === assetContextKey && effectiveAssetTabKey === AssetTabKey.RGB;
  const rgbList = useRGBListLogic({
    autoRefresh: true,
    enabled: isRgbActive && isRgbAssetTab,
    focused: isRgbAssetTab
  });
  // This list drives the global Accept/Reject sheet, so its first request must
  // advance receive state instead of only rendering cached activity. In
  // particular, a sender can press Done before its self-transfer consignment
  // reaches the proxy; the assets screen must then take over polling from the
  // transfer-detail screen without waiting for another navigation or focus.
  const rgbTransfers = useRGBTransfersLogic({
    enabled: isRgbActive,
    initialFullSync: true,
    // This hook drives global pending action sheets, not a history view.
    // Exact local/status polling is sufficient even while Assets is visible.
    foreground: false
  });
  const [broadcastQueue, setBroadcastQueue] = useState<{
    contextKey: string;
    activeId?: string;
    dismissedIdsByContext: Map<string, Set<string>>;
  }>(() => ({ contextKey: rgbContextKey, dismissedIdsByContext: new Map(dismissedRgbBroadcastIdsByContext) }));
  const [acceptanceQueue, setAcceptanceQueue] = useState<{
    contextKey: string;
    activeId?: string;
    dismissedIdsByContext: Map<string, Set<string>>;
  }>(() => ({ contextKey: rgbContextKey, dismissedIdsByContext: new Map(dismissedRgbAcceptanceIdsByContext) }));
  const [acceptanceActionBatch, setAcceptanceActionBatch] = useState<{
    contextKey: string;
    items: RgbTransferItem[];
  }>({ contextKey: rgbContextKey, items: [] });
  const dismissedBroadcastIds =
    broadcastQueue.contextKey === rgbContextKey
      ? getDismissedIdsForContext(
          rgbContextKey,
          broadcastQueue.dismissedIdsByContext,
          dismissedRgbBroadcastIdsByContext
        )
      : new Set<string>();
  const readyBroadcasts = getReadyRgbBroadcasts(rgbTransfers.items, dismissedBroadcastIds);
  const readyBroadcast =
    broadcastQueue.contextKey === rgbContextKey
      ? readyBroadcasts.find((item) => (item.transferId || item.id) === broadcastQueue.activeId)
      : undefined;
  const dismissedAcceptanceIds =
    acceptanceQueue.contextKey === rgbContextKey
      ? getDismissedIdsForContext(
          rgbContextKey,
          acceptanceQueue.dismissedIdsByContext,
          dismissedRgbAcceptanceIdsByContext
        )
      : new Set<string>();
  const pendingAcceptances = getPendingRgbAcceptances(rgbTransfers.items, dismissedAcceptanceIds);
  const lockedAcceptanceBatch =
    acceptanceActionBatch.contextKey === rgbContextKey ? acceptanceActionBatch.items : [];
  const pendingAcceptance = lockedAcceptanceBatch[0] ?? (
    acceptanceQueue.contextKey === rgbContextKey
      ? pendingAcceptances.find((item) => (item.transferId || item.id) === acceptanceQueue.activeId)
      : undefined
  );
  const pendingAcceptanceBatch = lockedAcceptanceBatch.length > 0
    ? lockedAcceptanceBatch
    : pendingAcceptance
    ? pendingAcceptance.batch && pendingAcceptance.txid
      ? pendingAcceptances.filter(
          (item) => item.batch === true && item.txid === pendingAcceptance.txid
        )
      : [pendingAcceptance]
    : [];

  useEffect(() => {
    setBroadcastQueue((current) => {
      if (current.contextKey !== rgbContextKey) {
        return { ...current, contextKey: rgbContextKey, activeId: undefined };
      }
      const available = rgbTransfers.isCurrentAccountLoaded
        ? getReadyRgbBroadcasts(
            rgbTransfers.items,
            getDismissedIdsForContext(rgbContextKey, current.dismissedIdsByContext, dismissedRgbBroadcastIdsByContext)
          )
        : [];
      const activeId = selectReadyRgbBroadcastId(available, current.activeId);
      return current.activeId === activeId ? current : { ...current, activeId };
    });
  }, [
    rgbContextKey,
    rgbTransfers.items,
    rgbTransfers.isCurrentAccountLoaded,
    broadcastQueue.activeId,
    broadcastQueue.dismissedIdsByContext
  ]);

  useEffect(() => {
    setAcceptanceQueue((current) => {
      if (current.contextKey !== rgbContextKey) {
        return { ...current, contextKey: rgbContextKey, activeId: undefined };
      }
      const available =
        isRgbActive && rgbTransfers.isCurrentAccountLoaded
          ? getPendingRgbAcceptances(
              rgbTransfers.items,
              getDismissedIdsForContext(
                rgbContextKey,
                current.dismissedIdsByContext,
                dismissedRgbAcceptanceIdsByContext
              )
            )
          : [];
      const activeId = selectPendingRgbAcceptanceId(available, current.activeId);
      return current.activeId === activeId ? current : { ...current, activeId };
    });
  }, [
    isRgbActive,
    rgbContextKey,
    rgbTransfers.items,
    rgbTransfers.isCurrentAccountLoaded,
    acceptanceQueue.activeId,
    acceptanceQueue.dismissedIdsByContext
  ]);

  const dismissBroadcast = () => {
    if (!readyBroadcast) return;
    const transferId = readyBroadcast.transferId || readyBroadcast.id;
    rememberDismissedId(dismissedRgbBroadcastIdsByContext, rgbContextKey, transferId);
    setBroadcastQueue((current) => {
      if (current.contextKey !== rgbContextKey) return current;
      const dismissedIdsByContext = new Map(current.dismissedIdsByContext);
      rememberDismissedId(dismissedIdsByContext, rgbContextKey, transferId);
      return { ...current, activeId: undefined, dismissedIdsByContext };
    });
  };

  const dismissPendingAcceptance = () => {
    if (!pendingAcceptance) return;
    const transferIds = pendingAcceptanceBatch.map((item) => item.transferId || item.id);
    for (const transferId of transferIds) {
      rememberDismissedId(dismissedRgbAcceptanceIdsByContext, rgbContextKey, transferId);
    }
    setAcceptanceQueue((current) => {
      if (current.contextKey !== rgbContextKey) return current;
      const dismissedIdsByContext = new Map(current.dismissedIdsByContext);
      for (const transferId of transferIds) {
        rememberDismissedId(dismissedIdsByContext, rgbContextKey, transferId);
      }
      return { ...current, activeId: undefined, dismissedIdsByContext };
    });
    setAcceptanceActionBatch({ contextKey: rgbContextKey, items: [] });
  };

  const onEnableRgb = useCallback(async () => {
    setRgbActivationLoading(true);
    try {
      await wallet.enableRgbFeature();
      setRgbActivationOpen(false);
      onRgbFeatureEnabled();
    } catch (error) {
      const rawMessage = error && typeof error === 'object' && 'message' in error ? error.message : error;
      const nestedMessage =
        rawMessage && typeof rawMessage === 'object' && 'message' in rawMessage ? rawMessage.message : undefined;
      const candidate = typeof rawMessage === 'string' ? rawMessage : nestedMessage;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const message =
        typeof candidate === 'string' && candidate && candidate !== 'Object' && candidate !== '[object Object]'
          ? candidate
          : `${t('unknown_error')}${typeof code === 'number' ? ` (${code})` : ''}`;
      tools.toastError(message);
      void wallet
        .getRgbFeatureStatus()
        .then((status) => {
          if (status.enabled && status.supported) {
            setRgbActivationOpen(false);
            onRgbFeatureEnabled();
          }
        })
        .catch(() => undefined);
    } finally {
      setRgbActivationLoading(false);
    }
  }, [onRgbFeatureEnabled, t, tools, wallet]);

  const counts = assetCounts?.key === assetContextKey ? assetCounts : null;
  const assetTabsLoading =
    (!counts && assetCountErrorKey !== assetContextKey) ||
    (screen === 'assets' && restoredTabContextKey !== assetContextKey);
  const rgbCount = isRgbActive && rgbAssetCount?.key === rgbContextKey ? rgbAssetCount.count : 0;
  const hasAnyAsset = counts
    ? counts.brc20Count +
        counts.summary.inscriptionCount +
        counts.summary.runesCount +
        counts.summary.alkanesCount +
        counts.summary.alkanesCollectionCount +
        rgbCount >
      0
    : false;
  const tabCounts = [
    {
      key: String(AssetTabKey.BRC20),
      assetTabKey: AssetTabKey.BRC20,
      supported: supportedAssets.assets.brc20,
      count: counts?.brc20Count ?? 0
    },
    {
      key: String(AssetTabKey.ORDINALS),
      assetTabKey: AssetTabKey.ORDINALS,
      supported: supportedAssets.assets.ordinals,
      count: counts?.summary.inscriptionCount ?? 0
    },
    {
      key: String(AssetTabKey.RUNES),
      assetTabKey: AssetTabKey.RUNES,
      supported: supportedAssets.assets.runes,
      count: counts?.summary.runesCount ?? 0
    },
    {
      key: String(AssetTabKey.RGB),
      assetTabKey: AssetTabKey.RGB,
      supported: supportedAssets.assets.rgb,
      count: rgbCount
    },
    {
      key: String(AssetTabKey.ALKANES),
      assetTabKey: AssetTabKey.ALKANES,
      moreAssetTabKey: MoreAssetTabKey.ALKANES_TOKEN,
      supported: supportedAssets.assets.alkanes,
      count: counts?.summary.alkanesCount ?? 0
    },
    {
      key: ALKANES_COLLECTION_TAB_KEY,
      assetTabKey: AssetTabKey.ALKANES,
      moreAssetTabKey: MoreAssetTabKey.ALKANES_COLLECTION,
      supported: supportedAssets.assets.alkanes,
      count: counts?.summary.alkanesCollectionCount ?? 0
    }
  ];
  useEffect(() => {
    if (screen !== 'assets') return;
    const storageKey = `${ASSET_TAB_STORAGE_PREFIX}${assetContextKey}`;
    let savedTabKey: string | null = null;
    try {
      savedTabKey = localStorage.getItem(storageKey);
    } catch {
      // Asset tabs still work when browser storage is unavailable.
    }
    const requestedTab =
      preferredAssetTab &&
      tabCounts.find(
        ({ assetTabKey, moreAssetTabKey, supported }) =>
          supported &&
          assetTabKey === preferredAssetTab.assetTabKey &&
          (preferredAssetTab.moreAssetTabKey === undefined || moreAssetTabKey === preferredAssetTab.moreAssetTabKey)
      );
    const savedTab = tabCounts.find(({ key, supported }) => supported && key === savedTabKey);
    const initialTab = requestedTab || savedTab || tabCounts.find(({ supported }) => supported);
    const pinnedTab = requestedTab || savedTab;
    setPinnedSelection(pinnedTab ? { contextKey: assetContextKey, tabKey: pinnedTab.key } : null);
    if (initialTab) {
      dispatch(
        uiActions.updateAssetTabScreen({
          assetTabKey: initialTab.assetTabKey,
          ...(initialTab.moreAssetTabKey ? { moreAssetTabKey: initialTab.moreAssetTabKey } : {})
        })
      );
    }
    setRestoredTabContextKey(assetContextKey);
  }, [
    screen,
    assetContextKey,
    supportedAssets.key,
    preferredAssetTab?.assetTabKey,
    preferredAssetTab?.moreAssetTabKey,
    dispatch
  ]);
  const selectedTabKey =
    effectiveAssetTabKey === AssetTabKey.ALKANES && moreAssetTabKey === MoreAssetTabKey.ALKANES_COLLECTION
      ? ALKANES_COLLECTION_TAB_KEY
      : String(effectiveAssetTabKey);
  useEffect(() => {
    if (
      assetTabsLoading ||
      restoredTabContextKey !== assetContextKey ||
      !counts ||
      !hasAnyAsset ||
      (pinnedSelection?.contextKey === assetContextKey && pinnedSelection.tabKey === selectedTabKey)
    )
      return;
    const selected = tabCounts.find(({ key }) => key === selectedTabKey);
    if (selected?.supported && selected.count > 0) return;
    const firstPopulated = tabCounts.find(({ supported, count }) => supported && count > 0);
    if (firstPopulated) {
      dispatch(
        uiActions.updateAssetTabScreen({
          assetTabKey: firstPopulated.assetTabKey,
          ...(firstPopulated.moreAssetTabKey ? { moreAssetTabKey: firstPopulated.moreAssetTabKey } : {})
        })
      );
    }
  }, [
    assetContextKey,
    assetCounts,
    assetTabsLoading,
    restoredTabContextKey,
    selectedTabKey,
    hasAnyAsset,
    pinnedSelection,
    supportedAssets.key,
    dispatch
  ]);
  const visibleAssetTabs = tabCounts.filter(({ supported }) => supported);
  // .sort((left, right) => Number(right.count > 0) - Number(left.count > 0));
  const visibleTabKeys = visibleAssetTabs.map(({ key }) => key);

  const tabItems = useMemo(() => {
    const items: {
      key: string;
      label: string | JSX.Element;
      children: JSX.Element;
    }[] = [];
    for (const { key, count } of visibleAssetTabs) {
      const label = (name: string) => assetTabLabel(name, count, !!counts);
      if (key === String(AssetTabKey.BRC20)) items.push({ key, label: label(t('brc20')), children: <BRC20Tab /> });
      if (key === String(AssetTabKey.ORDINALS))
        items.push({ key, label: label(t('ordinals')), children: <OrdinalsTab /> });
      if (key === String(AssetTabKey.RUNES)) items.push({ key, label: label(t('runes')), children: <RunesList /> });
      if (key === String(AssetTabKey.RGB))
        items.push({
          key,
          label: label(t('rgb')),
          children:
            rgbStatusContextKey !== rgbContextKey ? (
              <Text text={t('loading')} color="white_muted" />
            ) : rgbStatusErrorKey === rgbContextKey ? (
              <Column itemsCenter gap="md" data-testid="asset-load-error">
                <Text text={t('load_failed')} color="white_muted" />
                <Button
                  text={t('try_again')}
                  preset="primary"
                  onClick={() => setRgbStatusRetry((value) => ({ contextKey: rgbContextKey, count: value.count + 1 }))}
                />
              </Column>
            ) : isRgbActive ? (
              <RGBHomeTabs key={`${chain.enum}:${currentAccount.key}`} transfers={rgbTransfers} list={rgbList} />
            ) : (
              <Column itemsCenter gap="md">
                <Button
                  text={t(rgbRecoveryAvailable ? 'restore_rgb' : 'enable_rgb')}
                  preset="primary"
                  data-testid="rgb-enable-button"
                  onClick={() => setRgbActivationOpen(true)}
                />
              </Column>
            )
        });
      if (key === String(AssetTabKey.ALKANES))
        items.push({ key, label: label(t('alkanes')), children: <AlkanesList /> });
      if (key === ALKANES_COLLECTION_TAB_KEY)
        items.push({ key, label: label(t('alkanes_collections')), children: <AlkanesCollectionList /> });
    }
    return items;
  }, [
    visibleAssetTabs.map(({ key, count }) => `${key}:${count}`).join(','),
    !!counts,
    t,
    isRgbActive,
    rgbStatusContextKey,
    rgbStatusErrorKey,
    rgbContextKey,
    rgbTransfers,
    rgbList,
    rgbRecoveryAvailable,
    chain.enum,
    currentAccount.key
  ]);

  const finalAssetTabKey = visibleTabKeys.includes(selectedTabKey)
    ? selectedTabKey
    : visibleTabKeys[0] ?? String(AssetTabKey.BRC20);

  const [switchChainModalVisible, setSwitchChainModalVisible] = useState(false);

  const mainContent = (
    <>
      {screen === 'home' ? (
        <>
          <AccountSelect />
          <Column mt="md" gap="xl">
            <HomeTips />
            <BalanceCard />
            <WalletActions chain={chain} />
            <AnnouncementCard />
            <AssetOverviewSection
              isRgbActive={isRgbActive}
              rgbUsdtAssetId={rgbUsdtAssetId}
              unavailable={chain.supportsAssetOverview === false}
            />
            <AddressHistorySection
              preview
              unavailable={chain.supportsAddressHistory === false}
              showRgbHistoryHint={isRgbActive}
            />
          </Column>
        </>
      ) : (
        <Column mt="md" gap="zero" data-testid="assets-screen">
          {assetTabsLoading ? (
            <Row itemsCenter aria-label={t('loading')} style={{ flexWrap: 'wrap', gap: 8, rowGap: 8 }}>
              <div style={{ width: 72, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              <div style={{ width: 88, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              <div style={{ width: 76, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              <div style={{ width: 64, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)' }} />
            </Row>
          ) : (
            <Tabs
              preset="style2"
              contentGap={16}
              defaultActiveKey={finalAssetTabKey}
              activeKey={finalAssetTabKey}
              items={tabItems}
              onTabClick={(key) => {
                const selected = visibleAssetTabs.find((item) => item.key === key);
                if (!selected) return;
                setPinnedSelection({ contextKey: assetContextKey, tabKey: key });
                try {
                  localStorage.setItem(`${ASSET_TAB_STORAGE_PREFIX}${assetContextKey}`, key);
                } catch {
                  // Keep the in-memory selection when browser storage is unavailable.
                }
                dispatch(
                  uiActions.updateAssetTabScreen({
                    assetTabKey: selected.assetTabKey,
                    ...(selected.moreAssetTabKey ? { moreAssetTabKey: selected.moreAssetTabKey } : {})
                  })
                );
              }}
            />
          )}
        </Column>
      )}
    </>
  );

  if (!currentAccount.address) {
    return <LoadingPage />;
  }
  return (
    <Layout>
      <Header
        type="home"
        LeftComponent={
          screen === 'assets' ? (
            <Row>
              <Text preset="title-bold" text={t('assets')} />
            </Row>
          ) : (
            <Card
              preset="style2"
              style={{ height: 28, padding: '0 8px' }}
              onClick={() => {
                navigate('SwitchKeyringScreen');
              }}
              data-testid="wallet-management-entry">
              <Text
                text={
                  currentKeyring.type === KeyringType.ColdWalletKeyring
                    ? `❄️  ${currentKeyring.alianName}`
                    : currentKeyring.alianName
                }
                size="xxs"
                ellipsis
                style={{ maxWidth: 100, lineHeight: '16px' }}
              />
            </Card>
          )
        }
        RightComponent={
          screen === 'assets' ? (
            <SwitchNetworkBar />
          ) : (
            <Row itemsCenter style={{ gap: 8 }}>
              <FeeRateIcon />
              <SwitchNetworkBar />
              <SidePanelExpand />
            </Row>
          )
        }
      />

      <Content>
        {mainContent}
        {isRgbActive && readyBroadcast ? (
          <RGBTransferDetailSheet
            key={readyBroadcast.transferId || readyBroadcast.id}
            transfer={readyBroadcast}
            transferId={readyBroadcast.transferId || readyBroadcast.id}
            remainingBroadcastCount={readyBroadcasts.length - 1}
            onClose={dismissBroadcast}
            onCanceled={() => void rgbTransfers.onRefresh({ showLoading: false })}
          />
        ) : null}
        {isRgbActive && !readyBroadcast && pendingAcceptance ? (
          <RGBTransferDetailSheet
            key={pendingAcceptance.transferId || pendingAcceptance.id}
            transfer={pendingAcceptance}
            transferId={pendingAcceptance.transferId || pendingAcceptance.id}
            batchTransfers={pendingAcceptanceBatch}
            onReceiveActionStart={() => {
              setAcceptanceActionBatch({ contextKey: rgbContextKey, items: pendingAcceptanceBatch });
            }}
            onReceiveActionFailed={() => {
              setAcceptanceActionBatch({ contextKey: rgbContextKey, items: [] });
            }}
            onClose={dismissPendingAcceptance}
            onCanceled={() => void rgbTransfers.onRefresh({ showLoading: false })}
          />
        ) : null}
        <RgbRecoveryConflictModal key={`${chain.enum}:${currentAccount.address}`} enabled={isUnlocked && isRgbActive} />
        {rgbActivationOpen && (
          <RgbFeatureActivationModal
            loading={rgbActivationLoading}
            recoveryAvailable={rgbRecoveryAvailable}
            onClose={() => setRgbActivationOpen(false)}
            onEnable={() => void onEnableRgb()}
          />
        )}
        {screen === 'home' && showSafeNotice && (
          <NoticePopover
            onClose={() => {
              wallet.setShowSafeNotice(false);
              setShowSafeNotice(false);
            }}
          />
        )}
        {switchChainModalVisible && (
          <SwitchChainModal
            onClose={() => {
              setSwitchChainModalVisible(false);
            }}
          />
        )}

        {screen === 'home' && showVersionNotice && (
          <VersionNotice
            notice={showVersionNotice}
            onClose={() => {
              setShowVersionNotice(null);
            }}
          />
        )}
      </Content>
      <Footer px="zero" py="zero">
        <NavTabBar tab={screen} />
      </Footer>
    </Layout>
  );
}
