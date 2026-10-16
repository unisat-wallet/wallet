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
import { getCurrentTab } from '@/ui/web/tabs';
import { KeyringType } from '@unisat/keyring-service/types';
import { AddressAssetSummary, Brc20TickFilter, VersionDetail } from '@unisat/wallet-shared';
import '@unisat/wallet-state';
import {
  AssetTabKey,
  UNCONFIGURED_RGB_USDT_ASSET_ID,
  MoreAssetTabKey,
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
  useWalletConfig
} from '@unisat/wallet-state';

import { useNavigate } from '../../MainRoute';
import { RGBTransferDetailSheet } from '../../RGB/RGBTransferDetailSheet';
import { RGBTransferNotificationPanel } from '../../RGB/components/RGBTransferNotificationPanel';
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
        item.status.toLowerCase() === 'pending_accept' &&
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
      wallet.getNotifications();

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
  const [rgbActivationOpen, setRgbActivationOpen] = useState(false);
  const [rgbActivationLoading, setRgbActivationLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!supportedAssets.assets.rgb) {
      setRgbFeatureEnabled(false);
      setRgbRemoteRecoveryAvailable(false);
      setRgbStatusContextKey(rgbContextKey);
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
        setRgbStatusContextKey(rgbContextKey);
      })
      .catch(() => {
        if (active) {
          setRgbFeatureEnabled(false);
          setRgbRemoteRecoveryAvailable(false);
          setRgbStatusContextKey(rgbContextKey);
        }
      });
    return () => {
      active = false;
    };
  }, [rgbContextKey, supportedAssets.assets.rgb, wallet]);

  useEffect(() => {
    setRgbActivationOpen(false);
  }, [rgbContextKey]);

  const onRgbFeatureEnabled = useCallback(() => {
    setRgbFeatureEnabled(true);
    setRgbRemoteRecoveryAvailable(false);
    setRgbStatusContextKey(rgbContextKey);
  }, [rgbContextKey]);

  const isRgbActive = supportedAssets.assets.rgb && rgbStatusContextKey === rgbContextKey && rgbFeatureEnabled;
  const rgbRecoveryAvailable = rgbStatusContextKey === rgbContextKey && rgbRemoteRecoveryAvailable;
  useEffect(() => {
    if (screen !== 'assets' || !currentAccount.address) return;
    let active = true;
    Promise.all([
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
    ])
      .then(([summary, brc20Count]) => {
        if (active) {
          setAssetCounts({
            key: assetContextKey,
            summary,
            brc20Count: Math.max(summary.brc20Count, brc20Count ?? 0)
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
  }, [
    screen,
    assetContextKey,
    walletTabFocusRefresh,
    supportedAssets.assets.brc20,
    wallet
  ]);

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
      .catch((error) => {
        console.error('Failed to load RGB asset tab count', error);
        if (active && rgbUsdtAssetId) setRgbAssetCount({ key: rgbContextKey, count: 1 });
      });
    return () => {
      active = false;
    };
  }, [screen, rgbContextKey, walletTabFocusRefresh, isRgbActive, rgbUsdtAssetId, wallet]);

  const effectiveAssetTabKey = assetTabKey === AssetTabKey.MORE ? AssetTabKey.ALKANES : assetTabKey;
  const isRgbAssetTab = screen === 'assets' && restoredTabContextKey === assetContextKey && effectiveAssetTabKey === AssetTabKey.RGB;
  const rgbList = useRGBListLogic({
    autoRefresh: true,
    enabled: isRgbActive && isRgbAssetTab,
    focused: isRgbAssetTab
  });
  const rgbTransfers = useRGBTransfersLogic({ enabled: isRgbActive });
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
  const pendingAcceptance =
    acceptanceQueue.contextKey === rgbContextKey
      ? pendingAcceptances.find((item) => (item.transferId || item.id) === acceptanceQueue.activeId)
      : undefined;

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
    const transferId = pendingAcceptance.transferId || pendingAcceptance.id;
    rememberDismissedId(dismissedRgbAcceptanceIdsByContext, rgbContextKey, transferId);
    setAcceptanceQueue((current) => {
      if (current.contextKey !== rgbContextKey) return current;
      const dismissedIdsByContext = new Map(current.dismissedIdsByContext);
      rememberDismissedId(dismissedIdsByContext, rgbContextKey, transferId);
      return { ...current, activeId: undefined, dismissedIdsByContext };
    });
  };

  const onEnableRgb = useCallback(async () => {
    setRgbActivationLoading(true);
    try {
      await wallet.enableRgbFeature();
      setRgbActivationOpen(false);
      onRgbFeatureEnabled();
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setRgbActivationLoading(false);
    }
  }, [onRgbFeatureEnabled, tools, wallet]);

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
    const requestedTab = preferredAssetTab && tabCounts.find(({ assetTabKey, moreAssetTabKey, supported }) =>
      supported && assetTabKey === preferredAssetTab.assetTabKey &&
      (preferredAssetTab.moreAssetTabKey === undefined || moreAssetTabKey === preferredAssetTab.moreAssetTabKey)
    );
    const savedTab = tabCounts.find(({ key, supported }) => supported && key === savedTabKey);
    const initialTab = requestedTab || savedTab || tabCounts.find(({ supported }) => supported);
    const pinnedTab = requestedTab || savedTab;
    setPinnedSelection(pinnedTab ? { contextKey: assetContextKey, tabKey: pinnedTab.key } : null);
    if (initialTab) {
      dispatch(uiActions.updateAssetTabScreen({
        assetTabKey: initialTab.assetTabKey,
        ...(initialTab.moreAssetTabKey ? { moreAssetTabKey: initialTab.moreAssetTabKey } : {})
      }));
    }
    setRestoredTabContextKey(assetContextKey);
  }, [screen, assetContextKey, supportedAssets.key, preferredAssetTab?.assetTabKey, preferredAssetTab?.moreAssetTabKey, dispatch]);
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
          children: rgbStatusContextKey !== rgbContextKey ? (
            <Text text={t('loading')} color="white_muted" />
          ) : isRgbActive ? (
            <RGBHomeTabs key={`${chain.enum}:${currentAccount.key}`} transfers={rgbTransfers} list={rgbList} />
          ) : (
            <Column itemsCenter gap="md">
              <Text text={t('rgb_assets')} color="white_muted" />
              <Button
                text={t(rgbRecoveryAvailable ? 'restore_rgb' : 'enable_rgb')}
                preset="primary"
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
            <AssetOverviewSection isRgbActive={isRgbActive} rgbUsdtAssetId={rgbUsdtAssetId} />
            <AddressHistorySection preview />
          </Column>
        </>
      ) : (
        <Column mt="md" gap="zero">
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
        {isRgbActive ? (
          <RGBTransferNotificationPanel
            notification={rgbTransfers.notification}
            actionText={t('view_transfer')}
            onClose={rgbTransfers.dismissNotification}
            onAction={() => {
              const notification = rgbTransfers.notification;
              if (!notification) return;
              rgbTransfers.dismissNotification();
              nav.navigate('RGBTransferDetailScreen', {
                transferId: notification.transfer.transferId || notification.transfer.id,
                initialTransfer: notification.transfer
              });
            }}
          />
        ) : null}
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
            onClose={dismissPendingAcceptance}
            onCanceled={() => void rgbTransfers.onRefresh({ showLoading: false })}
          />
        ) : null}
        {screen === 'home' && (
          <RgbRecoveryConflictModal key={`${chain.enum}:${currentAccount.address}`} enabled={isRgbActive} />
        )}
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
