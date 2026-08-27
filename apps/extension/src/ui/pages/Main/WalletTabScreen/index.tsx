import { useEffect, useMemo, useState } from 'react';

import { Card, Column, Content, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
import AccountSelect from '@/ui/components/AccountSelect';
import { spacingGap } from '@/ui/theme/spacing';
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
  useSupportedAssets,
  useVersionInfo,
  useWalletView,
  useRGBListLogic,
  useRGBTransfersLogic,
  WalletView,
  useWallet
} from '@unisat/wallet-state';

import { useNavigate } from '../../MainRoute';
import { SwitchChainModal } from '../../Settings/SwitchChainModal';
import { MoreActionSheet } from './MoreActionSheet';
import { MoreTab } from './MoreTab';
import { OrdinalsTab } from './OrdinalsTab';
import { RGBHomeTabs } from './RGBHomeTabs';
import { RGBTransferNotificationPanel } from '../../RGB/components/RGBTransferNotificationPanel';
import { RunesList } from './RunesList';
import { SidePanelExpand } from './SidePanelExpand';
import { AnnouncementCard } from './components/AnnouncementCard';
import { BalanceCardCarousel } from './components/BalanceCardCarousel';
import { HomeTips } from './components/HomeTips';
import { WalletActions } from './components/WalletActions';

const STORAGE_VERSION_KEY = 'version_detail';

export default function WalletTabScreen() {
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
  const walletView = useWalletView();

  const versionInfo = useVersionInfo();

  const [showSafeNotice, setShowSafeNotice] = useState(false);
  const [showVersionNotice, setShowVersionNotice] = useState<VersionDetail | null>(null);

  const nav = useNavigation();
  const mainRouteState = nav.getRouteState<'MainScreen'>();
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
  const isRgbView = walletView === WalletView.RGB && supportedAssets.assets.rgb;
  const rgbList = useRGBListLogic({ autoRefresh: true, enabled: isRgbView });
  const rgbTransfers = useRGBTransfersLogic({ enabled: isRgbView });

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

    if (supportedAssets.assets.runes) {
      items.push({
        key: AssetTabKey.RUNES,
        label: t('runes'),
        children: <RunesList />
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
  }, [supportedAssets.key, t, assetTabKey]);

  const finalAssetTabKey = useMemo(() => {
    if (!supportedAssets.tabKeys.includes(assetTabKey)) {
      return AssetTabKey.ORDINALS;
    }
    return assetTabKey;
  }, [assetTabKey, supportedAssets.key]);

  const [switchChainModalVisible, setSwitchChainModalVisible] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [rgbHomeTab, setRgbHomeTab] = useState<'assets' | 'transfers'>(mainRouteState?.rgbHomeTab || 'assets');

  useEffect(() => {
    if (mainRouteState?.rgbHomeTab) setRgbHomeTab(mainRouteState.rgbHomeTab);
  }, [mainRouteState?.rgbHomeTab]);
  const [moreSheetSelection, setMoreSheetSelection] = useState<MoreAssetTabKey | undefined>(undefined);

  const homeContent = (
    <>
      <AccountSelect />

      <Column mt="md" gap="zero">
        <Column gap="lg2">
          <HomeTips />

          <BalanceCardCarousel rgbList={rgbList} />
          <WalletActions chain={chain} walletView={isRgbView ? WalletView.RGB : WalletView.BITCOIN} />

          {!isRgbView ? <AnnouncementCard /> : null}
        </Column>

        <Column style={{ marginTop: spacingGap.lg2 }}>
          {isRgbView ? (
            <RGBHomeTabs initialTab={rgbHomeTab} transfers={rgbTransfers} list={rgbList} />
          ) : (
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
          )}
        </Column>
      </Column>
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
            {!isRgbView ? <SwitchNetworkBar /> : null}
            <SidePanelExpand />
          </Row>
        }
      />

      <Content>
        {homeContent}
        {isRgbView ? (
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
        {!isRgbView && moreSheetOpen ? (
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
        {showSafeNotice && (
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

        {showVersionNotice && (
          <VersionNotice
            notice={showVersionNotice}
            onClose={() => {
              setShowVersionNotice(null);
            }}
          />
        )}
      </Content>
      <Footer px="zero" py="zero">
        <NavTabBar tab="home" />
      </Footer>
    </Layout>
  );
}
