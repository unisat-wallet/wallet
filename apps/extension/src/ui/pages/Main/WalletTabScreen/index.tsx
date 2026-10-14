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
  useWallet
} from '@unisat/wallet-state';

import { useNavigate } from '../../MainRoute';
import { RgbRecoveryConflictModal } from '../../RGB/components/RgbRecoveryConflictModal';
import { RGBTransferDetailSheet } from '../../RGB/RGBTransferDetailSheet';
import { RGBTransferNotificationPanel } from '../../RGB/components/RGBTransferNotificationPanel';
import { RgbFeatureActivationModal } from '../../RGB/components/RgbFeatureActivationModal';
import { SwitchChainModal } from '../../Settings/SwitchChainModal';
import { AddressHistorySection } from '../../Wallet/HistoryScreen/AddressHistorySection';
import { MoreActionItem, MoreActionSheet } from './MoreActionSheet';
import { BRC20Tab } from './BRC20Tab';
import { MoreTab } from './MoreTab';
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
const dismissedRgbBroadcastIdsByContext = new Map<string, Set<string>>();
const dismissedRgbAcceptanceIdsByContext = new Map<string, Set<string>>();

function getDismissedIdsForContext(
  contextKey: string,
  localIdsByContext: Map<string, Set<string>>,
  sessionIdsByContext: Map<string, Set<string>>
) {
  return new Set([
    ...(sessionIdsByContext.get(contextKey) ?? []),
    ...(localIdsByContext.get(contextKey) ?? [])
  ]);
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

export default function WalletTabScreen({ screen = 'home' }: { screen?: 'home' | 'assets' }) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const chain = useChain();

  const currentKeyring = useCurrentKeyring();
  const currentAccount = useCurrentAccount();

  const wallet = useWallet();
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
    rgbCount: number;
  } | null>(null);
  const [assetCountErrorKey, setAssetCountErrorKey] = useState<string | null>(null);
  const [pinnedSelection, setPinnedSelection] = useState<{ contextKey: string; tabKey: AssetTabKey } | null>(null);
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
      supportedAssets.assets.rgb
        ? wallet.getRgbFeatureStatus().then((status) => status.enabled && status.supported
          ? wallet.getRGBList('', 1, 1, { skipSync: true }).then((result) => result.total)
          : 0)
        : Promise.resolve(0),
      supportedAssets.assets.brc20
        ? wallet.getBRC20List({
            address: currentAccount.address,
            currentPage: 1,
            pageSize: 1,
            tickFilter: Brc20TickFilter.TICK_BYTES_4_5_6
          }).then((result) => result.total).catch(() => null)
        : Promise.resolve(null)
    ])
      .then(([summary, rgbCount, brc20Count]) => {
        if (active) {
          setAssetCounts({
            key: assetContextKey,
            summary,
            brc20Count: Math.max(summary.brc20Count, brc20Count ?? 0),
            rgbCount
          });
          setAssetCountErrorKey(null);
        }
      })
      .catch((error) => {
        console.error('Failed to load asset tab counts', error);
        if (active) setAssetCountErrorKey(assetContextKey);
      });
    return () => { active = false; };
  }, [screen, assetContextKey, walletTabFocusRefresh, isRgbActive, supportedAssets.assets.rgb, supportedAssets.assets.brc20, wallet]);

  const effectiveAssetTabKey = assetTabKey === AssetTabKey.MORE ? AssetTabKey.ALKANES : assetTabKey;
  const isRgbAssetTab = screen === 'assets' && effectiveAssetTabKey === AssetTabKey.RGB;
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
  const dismissedBroadcastIds = broadcastQueue.contextKey === rgbContextKey
    ? getDismissedIdsForContext(rgbContextKey, broadcastQueue.dismissedIdsByContext, dismissedRgbBroadcastIdsByContext)
    : new Set<string>();
  const readyBroadcasts = getReadyRgbBroadcasts(rgbTransfers.items, dismissedBroadcastIds);
  const readyBroadcast = broadcastQueue.contextKey === rgbContextKey
    ? readyBroadcasts.find((item) => (item.transferId || item.id) === broadcastQueue.activeId)
    : undefined;
  const dismissedAcceptanceIds = acceptanceQueue.contextKey === rgbContextKey
    ? getDismissedIdsForContext(rgbContextKey, acceptanceQueue.dismissedIdsByContext, dismissedRgbAcceptanceIdsByContext)
    : new Set<string>();
  const pendingAcceptances = getPendingRgbAcceptances(rgbTransfers.items, dismissedAcceptanceIds);
  const pendingAcceptance = acceptanceQueue.contextKey === rgbContextKey
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
  }, [rgbContextKey, rgbTransfers.items, rgbTransfers.isCurrentAccountLoaded, broadcastQueue.activeId, broadcastQueue.dismissedIdsByContext]);

  useEffect(() => {
    setAcceptanceQueue((current) => {
      if (current.contextKey !== rgbContextKey) {
        return { ...current, contextKey: rgbContextKey, activeId: undefined };
      }
      const available = isRgbActive && rgbTransfers.isCurrentAccountLoaded
        ? getPendingRgbAcceptances(
            rgbTransfers.items,
            getDismissedIdsForContext(rgbContextKey, current.dismissedIdsByContext, dismissedRgbAcceptanceIdsByContext)
          )
        : [];
      const activeId = selectPendingRgbAcceptanceId(available, current.activeId);
      return current.activeId === activeId ? current : { ...current, activeId };
    });
  }, [isRgbActive, rgbContextKey, rgbTransfers.items, rgbTransfers.isCurrentAccountLoaded, acceptanceQueue.activeId, acceptanceQueue.dismissedIdsByContext]);

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
  const assetTabsLoading = (!counts && assetCountErrorKey !== assetContextKey) ||
    (supportedAssets.assets.rgb && rgbStatusContextKey !== rgbContextKey);
  const hasAnyAsset = counts ? (
    counts.brc20Count + counts.summary.inscriptionCount + counts.summary.runesCount +
    counts.summary.alkanesCount + counts.summary.alkanesCollectionCount + counts.rgbCount > 0
  ) : false;
  const showAllBaseTabs = (!counts && !assetTabsLoading) || Boolean(counts && !hasAnyAsset);
  const tabCounts = [
    { key: AssetTabKey.BRC20, supported: supportedAssets.assets.brc20, count: counts?.brc20Count ?? 0 },
    { key: AssetTabKey.ORDINALS, supported: supportedAssets.assets.ordinals, count: counts?.summary.inscriptionCount ?? 0 },
    { key: AssetTabKey.RUNES, supported: supportedAssets.assets.runes, count: counts?.summary.runesCount ?? 0 },
    { key: AssetTabKey.RGB, supported: supportedAssets.assets.rgb, count: counts?.rgbCount ?? 0 },
    {
      key: AssetTabKey.ALKANES,
      supported: supportedAssets.assets.alkanes,
      count: (counts?.summary.alkanesCount ?? 0) + (counts?.summary.alkanesCollectionCount ?? 0)
    }
  ];
  useEffect(() => {
    if (assetTabsLoading || !counts || !hasAnyAsset ||
        (pinnedSelection?.contextKey === assetContextKey && pinnedSelection.tabKey === effectiveAssetTabKey)) return;
    const selected = tabCounts.find(({ key }) => key === effectiveAssetTabKey);
    if (effectiveAssetTabKey === AssetTabKey.ALKANES && counts.summary.alkanesCount === 0 &&
        counts.summary.alkanesCollectionCount > 0 && moreAssetTabKey !== MoreAssetTabKey.ALKANES_COLLECTION) {
      dispatch(uiActions.updateAssetTabScreen({ moreAssetTabKey: MoreAssetTabKey.ALKANES_COLLECTION }));
      return;
    }
    if (effectiveAssetTabKey === AssetTabKey.ALKANES && counts.summary.alkanesCount > 0 &&
        counts.summary.alkanesCollectionCount === 0 && moreAssetTabKey !== MoreAssetTabKey.ALKANES_TOKEN) {
      dispatch(uiActions.updateAssetTabScreen({ moreAssetTabKey: MoreAssetTabKey.ALKANES_TOKEN }));
      return;
    }
    if (selected?.supported && (selected.count > 0 || (selected.key === AssetTabKey.RGB && isRgbActive))) return;
    const firstPopulated = tabCounts.find(({ supported, count }) => supported && count > 0);
    if (firstPopulated) {
      dispatch(uiActions.updateAssetTabScreen({
        assetTabKey: firstPopulated.key,
        ...(firstPopulated.key === AssetTabKey.ALKANES
          ? { moreAssetTabKey: counts.summary.alkanesCount > 0
            ? MoreAssetTabKey.ALKANES_TOKEN : MoreAssetTabKey.ALKANES_COLLECTION } : {})
      }));
    }
  }, [assetContextKey, assetCounts, assetTabsLoading, effectiveAssetTabKey, hasAnyAsset, pinnedSelection, supportedAssets.key, moreAssetTabKey, isRgbActive, dispatch]);
  const visibleAssetTabs = [
    ...tabCounts
  ].filter(({ key, supported, count }) => supported && (
    count > 0 || (key === AssetTabKey.RGB && isRgbActive) ||
    (key === effectiveAssetTabKey && !assetTabsLoading && (!counts || !hasAnyAsset ||
      (pinnedSelection?.contextKey === assetContextKey && pinnedSelection.tabKey === key))) ||
    (showAllBaseTabs && key !== AssetTabKey.ALKANES)
  ));
  const visibleTabKeys = visibleAssetTabs.map(({ key }) => key);

  const moreActionItems: MoreActionItem[] = [
    ...(!visibleTabKeys.includes(AssetTabKey.BRC20) && supportedAssets.assets.brc20
      ? [{ assetTabKey: AssetTabKey.BRC20, label: t('brc20'), icon: 'assets' as const }] : []),
    ...(!visibleTabKeys.includes(AssetTabKey.ORDINALS) && supportedAssets.assets.ordinals
      ? [{ assetTabKey: AssetTabKey.ORDINALS, label: t('ordinals'), icon: 'ordinals' as const }] : []),
    ...(!visibleTabKeys.includes(AssetTabKey.RUNES) && supportedAssets.assets.runes
      ? [{ assetTabKey: AssetTabKey.RUNES, label: t('runes'), icon: 'assets' as const }] : []),
    ...(!visibleTabKeys.includes(AssetTabKey.RGB) && supportedAssets.assets.rgb
      ? [{ assetTabKey: AssetTabKey.RGB, label: t('rgb'), icon: 'rgb' as const }] : []),
    ...(supportedAssets.assets.alkanes ? [
      ...(!visibleTabKeys.includes(AssetTabKey.ALKANES) || moreAssetTabKey === MoreAssetTabKey.ALKANES_COLLECTION
        ? [{ assetTabKey: AssetTabKey.ALKANES, moreAssetTabKey: MoreAssetTabKey.ALKANES_TOKEN, label: t('alkanes'), icon: 'alkanes' as const }]
        : []),
      { assetTabKey: AssetTabKey.ALKANES, moreAssetTabKey: MoreAssetTabKey.ALKANES_COLLECTION,
        label: t('alkanes_collections'), icon: 'alkanes' as const }
    ] : [])
  ];

  const tabItems = useMemo(() => {
    const items: {
      key: AssetTabKey;
      label: string | JSX.Element;
      children: JSX.Element;
    }[] = [];
    for (const key of visibleTabKeys) {
      if (key === AssetTabKey.BRC20) items.push({ key, label: t('brc20'), children: <BRC20Tab /> });
      if (key === AssetTabKey.ORDINALS) items.push({ key, label: t('ordinals'), children: <OrdinalsTab /> });
      if (key === AssetTabKey.RUNES) items.push({ key, label: t('runes'), children: <RunesList /> });
      if (key === AssetTabKey.RGB) items.push({
        key,
        label: t('rgb'),
        children: isRgbActive ? (
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
      if (key === AssetTabKey.ALKANES) items.push({ key, label: t('alkanes'), children: <MoreTab /> });
    }
    return items;
  }, [visibleTabKeys.join(','), t, isRgbActive, rgbTransfers, rgbList, rgbRecoveryAvailable, chain.enum, currentAccount.key]);

  const finalAssetTabKey = visibleTabKeys.includes(effectiveAssetTabKey)
    ? effectiveAssetTabKey
    : (visibleTabKeys[0] ?? AssetTabKey.BRC20);

  const [switchChainModalVisible, setSwitchChainModalVisible] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  const mainContent = (
    <>
      {screen === 'home' ? (
        <>
          <AccountSelect />
          <Column mt="md" gap="lg2">
            <HomeTips />
            <BalanceCard />
            <WalletActions chain={chain} />
            <AnnouncementCard />
            <AssetOverviewSection />
            <AddressHistorySection preview />
          </Column>
        </>
      ) : (
        <Column mt="md" gap="zero">
          {assetTabsLoading ? (
            <Row
              itemsCenter
              aria-label={t('loading')}
              style={{ height: 50, gap: 16 }}>
              <div style={{ width: 68, height: 14, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              <div style={{ width: 86, height: 14, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              <div style={{ width: 58, height: 14, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)' }} />
            </Row>
          ) : <Tabs
            contentGap={24}
            defaultActiveKey={finalAssetTabKey as unknown as string}
            activeKey={finalAssetTabKey as unknown as string}
            items={tabItems as unknown as any[]}
            trailingAction={moreActionItems.length ? (
              <button
                type="button"
                aria-label={t('more')}
                title={t('more')}
                data-testid="asset-tabs-more"
                onClick={() => setMoreSheetOpen(true)}
                style={{
                  width: 36,
                  height: 40,
                  border: 0,
                  borderRadius: 8,
                  background: 'transparent',
                  color: 'rgba(255,255,255,0.65)',
                  fontSize: 25,
                  lineHeight: 1,
                  cursor: 'pointer'
                }}>
                ⋯
              </button>
            ) : undefined}
            onTabClick={(key) => {
              if ((key as unknown as AssetTabKey) === AssetTabKey.ALKANES &&
                  counts && counts.summary.alkanesCount === 0 && counts.summary.alkanesCollectionCount > 0) {
                dispatch(uiActions.updateAssetTabScreen({ moreAssetTabKey: MoreAssetTabKey.ALKANES_COLLECTION }));
              }
              setPinnedSelection(null);
              dispatch(uiActions.updateAssetTabScreen({ assetTabKey: key as unknown as AssetTabKey }));
            }}
          />}
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
              data-testid="wallet-management-entry"
            >
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
        {screen === 'assets' && !assetTabsLoading && moreSheetOpen ? (
          <MoreActionSheet
            items={moreActionItems}
            currentSelection={{ assetTabKey: effectiveAssetTabKey, moreAssetTabKey }}
            onClose={() => setMoreSheetOpen(false)}
            onSelect={(selection) => {
              setMoreSheetOpen(false);
              setPinnedSelection({ contextKey: assetContextKey, tabKey: selection.assetTabKey });
              dispatch(
                uiActions.updateAssetTabScreen({
                  assetTabKey: selection.assetTabKey,
                  moreAssetTabKey: selection.moreAssetTabKey
                })
              );
            }}
          />
        ) : null}
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
