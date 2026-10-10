import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, Card, Column, Content, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
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
import { VersionDetail } from '@unisat/wallet-shared';
import '@unisat/wallet-state';
import {
  AssetTabKey,
  MoreAssetTabKey,
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
  useWallet
} from '@unisat/wallet-state';

import { useNavigate } from '../../MainRoute';
import { RgbRecoveryConflictModal } from '../../RGB/components/RgbRecoveryConflictModal';
import { RGBTransferNotificationPanel } from '../../RGB/components/RGBTransferNotificationPanel';
import { RgbFeatureActivationModal } from '../../RGB/components/RgbFeatureActivationModal';
import { SwitchChainModal } from '../../Settings/SwitchChainModal';
import { MoreActionSheet } from './MoreActionSheet';
import { BRC20Tab } from './BRC20Tab';
import { MoreTab } from './MoreTab';
import { OrdinalsTab } from './OrdinalsTab';
import { RGBHomeTabs } from './RGBHomeTabs';
import { RunesList } from './RunesList';
import { SidePanelExpand } from './SidePanelExpand';
import { AnnouncementCard } from './components/AnnouncementCard';
import { BalanceCard } from './components/BalanceCard';
import { HomeTips } from './components/HomeTips';
import { WalletActions } from './components/WalletActions';

const STORAGE_VERSION_KEY = 'version_detail';

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
  const mainRouteState = nav.getRouteState<'AssetsTabScreen'>();
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
  const [rgbFeatureEnabled, setRgbFeatureEnabled] = useState(false);
  const [rgbRemoteRecoveryAvailable, setRgbRemoteRecoveryAvailable] = useState(false);
  const [rgbActivationOpen, setRgbActivationOpen] = useState(false);
  const [rgbActivationLoading, setRgbActivationLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!supportedAssets.assets.rgb) {
      setRgbFeatureEnabled(false);
      setRgbRemoteRecoveryAvailable(false);
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
      })
      .catch(() => {
        if (active) {
          setRgbFeatureEnabled(false);
          setRgbRemoteRecoveryAvailable(false);
        }
      });
    return () => {
      active = false;
    };
  }, [chain.enum, currentAccount?.key, currentKeyring?.key, supportedAssets.assets.rgb, wallet]);

  const onRgbFeatureEnabled = useCallback(() => {
    setRgbFeatureEnabled(true);
    setRgbRemoteRecoveryAvailable(false);
  }, []);

  const isRgbActive = supportedAssets.assets.rgb && rgbFeatureEnabled;
  const isRgbAssetTab = screen === 'assets' && assetTabKey === AssetTabKey.RGB;
  const [rgbHomeTab, setRgbHomeTab] = useState<'assets' | 'transfers'>(mainRouteState?.rgbHomeTab || 'assets');
  const rgbList = useRGBListLogic({
    autoRefresh: true,
    enabled: isRgbActive && isRgbAssetTab,
    focused: isRgbAssetTab
  });
  const rgbTransfers = useRGBTransfersLogic({ enabled: isRgbActive });

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

  const tabItems = useMemo(() => {
    const items: {
      key: AssetTabKey;
      label: string | JSX.Element;
      children: JSX.Element;
    }[] = [];
    if (supportedAssets.assets.ordinals) {
      items.push({
        key: AssetTabKey.ORDINALS,
        label: t('ordinals'),
        children: <OrdinalsTab />
      });
    }

    if (supportedAssets.assets.brc20) {
      items.push({
        key: AssetTabKey.BRC20,
        label: 'BRC20',
        children: <BRC20Tab />
      });
    }

    if (supportedAssets.assets.runes) {
      items.push({
        key: AssetTabKey.RUNES,
        label: t('runes'),
        children: <RunesList />
      });
    }
    if (supportedAssets.assets.rgb) {
      items.push({
        key: AssetTabKey.RGB,
        label: t('rgb'),
        children: isRgbActive ? (
          <RGBHomeTabs initialTab={rgbHomeTab} transfers={rgbTransfers} list={rgbList} />
        ) : (
          <Column itemsCenter gap="md">
            <Text text={t('rgb_assets')} color="white_muted" />
            <Button
              text={t(rgbRemoteRecoveryAvailable ? 'restore_rgb' : 'enable_rgb')}
              preset="primary"
              onClick={() => setRgbActivationOpen(true)}
            />
          </Column>
        )
      });
    }
    if (supportedAssets.assets.alkanes) {
      items.push({
        key: AssetTabKey.MORE,
        label: (
          <Row itemsCenter>
            <Text text={t('more')} color={assetTabKey === AssetTabKey.MORE ? 'gold' : 'textDim'} size="md" />
            <Icon icon="drop_down" color={assetTabKey === AssetTabKey.MORE ? 'gold' : 'textDim'} size={10} />
          </Row>
        ),
        children: <MoreTab />
      });
    }
    return items;
  }, [supportedAssets.key, t, assetTabKey, isRgbActive, rgbHomeTab, rgbTransfers, rgbList, rgbRemoteRecoveryAvailable]);

  const finalAssetTabKey = useMemo(() => {
    if (!supportedAssets.tabKeys.includes(assetTabKey)) {
      return AssetTabKey.ORDINALS;
    }
    return assetTabKey;
  }, [assetTabKey, supportedAssets.key]);

  const [switchChainModalVisible, setSwitchChainModalVisible] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  useEffect(() => {
    if (mainRouteState?.rgbHomeTab) {
      setRgbHomeTab(mainRouteState.rgbHomeTab);
      dispatch(uiActions.updateAssetTabScreen({ assetTabKey: AssetTabKey.RGB }));
    }
  }, [mainRouteState?.rgbHomeTab, dispatch]);
  const [moreSheetSelection, setMoreSheetSelection] = useState<MoreAssetTabKey | undefined>(undefined);

  const mainContent = (
    <>
      {screen === 'home' ? (
        <>
          <AccountSelect />
          <Column mt="md" gap="lg2">
            <HomeTips />
            <BalanceCard />
            <WalletActions chain={chain} rgbEnabled={isRgbActive} />
            <AnnouncementCard />
          </Column>
        </>
      ) : (
        <Column mt="md" gap="zero">
          <Tabs
            defaultActiveKey={finalAssetTabKey as unknown as string}
            activeKey={finalAssetTabKey as unknown as string}
            items={tabItems as unknown as any[]}
            onTabClick={(key) => {
              if ((key as unknown as AssetTabKey) === AssetTabKey.MORE) {
                if (assetTabKey === AssetTabKey.MORE) {
                  setMoreSheetSelection(moreAssetTabKey);
                } else {
                  setMoreSheetSelection(undefined);
                }
                setMoreSheetOpen(true);
                return;
              }
              dispatch(uiActions.updateAssetTabScreen({ assetTabKey: key as unknown as AssetTabKey }));
            }}
          />
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
        }
        RightComponent={
          <Row itemsCenter style={{ gap: 8 }}>
            <FeeRateIcon />
            <SwitchNetworkBar />
            <SidePanelExpand />
          </Row>
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
        {screen === 'home' && (
          <RgbRecoveryConflictModal
            key={`${chain.enum}:${currentAccount.address}`}
            enabled={isRgbActive}
          />
        )}
        {screen === 'assets' && moreSheetOpen ? (
          <MoreActionSheet
            currentSelection={moreSheetSelection}
            onClose={() => setMoreSheetOpen(false)}
            onSelect={(selection) => {
              setMoreSheetOpen(false);
              dispatch(
                uiActions.updateAssetTabScreen({
                  assetTabKey: AssetTabKey.MORE,
                  moreAssetTabKey: selection
                })
              );
            }}
          />
        ) : null}
        {rgbActivationOpen && (
          <RgbFeatureActivationModal
            loading={rgbActivationLoading}
            recoveryAvailable={rgbRemoteRecoveryAvailable}
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
