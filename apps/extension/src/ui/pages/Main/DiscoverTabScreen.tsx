import { useEffect, useState } from 'react';

import { Button, Card, Carousel, Column, Content, Footer, Header, Icon, Image, Layout, Row, Text, Tooltip } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { NavTabBar } from '@/ui/components/NavTabBar';
import { SwitchNetworkBar } from '@/ui/components/SwitchNetworkBar';
import { TabBar } from '@/ui/components/TabBar';
import { colors } from '@/ui/theme/colors';
import { fontSizes } from '@/ui/theme/font';
import { SearchBar } from '@/ui/pages/Main/DiscoverTabComponents/SearchBar';
import { getAddressType } from '@/ui/utils/bitcoin-utils';
import { openSafeUrl } from '@/ui/utils/openSafeUrl';
import { AppDisclaimer, AppInfo } from '@unisat/wallet-shared';
import {
  discoveryActions,
  useAppDispatch,
  useAppList,
  useBannerList,
  useChainType,
  useCurrentAddress,
  useHasNewBanner,
  useI18n,
  useLastFetchInfo,
  useNetworkType,
  useReadApp,
  useTools,
  useWallet
} from '@unisat/wallet-state';

import { AddressType, ChainType } from '@unisat/wallet-types';
import { useNavigate } from '../MainRoute';
import { SwitchChainModal } from '../Settings/SwitchChainModal';

const APP_ID_BABYLON_STAKING = 1103;

function BannerItem({ img, link }: { img: string; link: string }) {
  return (
    <Row
      justifyCenter
      onClick={() => {
        openSafeUrl(link);
      }}>
      <Image
        src={img}
        width={'100%'}
        height={'auto'}
        style={{
          maxWidth: '512px'
        }}
      />
    </Row>
  );
}

function DiscoverAppDisclaimerModal({
  disclaimer,
  onClose,
  onContinue
}: {
  disclaimer: AppDisclaimer;
  onClose: () => void;
  onContinue: () => void;
}) {
  const { t } = useI18n();

  return (
    <BottomModal onClose={onClose}>
      <Column>
        <Row justifyBetween itemsCenter style={{ height: 20 }}>
          <Row />
          <Text text={disclaimer?.title || t('disclaimer')} textCenter size="md" />
          <Row onClick={onClose}>
            <Icon icon="close" size={12} />
          </Row>
        </Row>

        <Row fullX style={{ borderTopWidth: 1, borderColor: colors.border }} my="md" />

        <Column
          justifyCenter
          mb="lg"
          style={{
            maxHeight: '40vh',
            overflow: 'auto'
          }}>
          <Text
            style={{
              fontSize: fontSizes.sm,
              lineHeight: 2,
              whiteSpace: 'pre-line'
            }}
            wrap
            text={disclaimer?.content}
          />
        </Column>

        <Row full>
          <Button text={disclaimer?.cancelText || t('cancel')} preset="defaultV2" full onClick={onClose} />
          <Button text={disclaimer?.confirmText || t('continue')} preset="primaryV2" full onClick={onContinue} />
        </Row>
      </Column>
    </BottomModal>
  );
}

function AppItem({ info, onClick }: { info: AppInfo; onClick: (info: AppInfo) => void }) {
  const { t } = useI18n();

  const currentAddress = useCurrentAddress();
  const networkType = useNetworkType();

  // todo: Temporary handling plan, should change to control by config
  if (info.id === APP_ID_BABYLON_STAKING) {
    const addressType = getAddressType(currentAddress, networkType);
    if (addressType == AddressType.P2SH_P2WPKH || addressType == AddressType.P2PKH) {
      return <></>;
    }
  }

  return (
    <Card
      preset="style1"
      style={{
        backgroundColor: 'rgba(30, 31, 36, 1)',
        borderRadius: 16
      }}
      onClick={() => {
        onClick(info);
      }}>
      <Row full>
        <Column justifyCenter>
          <Image src={info.logo} size={48} />
        </Column>

        <Column justifyCenter gap="zero">
          <Row itemsCenter>
            <Text text={info.title} />
            {info.new && <Text text={t('new')} color="red" />}
          </Row>

          <Tooltip
            title={info.desc}
            overlayStyle={{
              fontSize: '10px',
              lineHeight: '14px'
            }}>
            <div>
              <Text text={info.desc} preset="sub" max2Lines />
            </div>
          </Tooltip>
        </Column>
      </Row>
    </Card>
  );
}

export default function DiscoverTabScreen() {
  const chainType = useChainType();
  const { locale, t } = useI18n();

  const [tabKey, setTabKey] = useState(0);

  const bannerList = useBannerList();
  const appList = useAppList();
  const lastFetchInfo = useLastFetchInfo();
  const hasNewBanner = useHasNewBanner();

  const [switchChainModalVisible, setSwitchChainModalVisible] = useState(false);
  const [disclaimerApp, setDisclaimerApp] = useState<AppInfo | null>(null);
  const [disclaimer, setDisclaimer] = useState<AppDisclaimer | null>(null);

  const wallet = useWallet();
  const readApp = useReadApp();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const tools = useTools();

  const openApp = (info: AppInfo) => {
    if (info.route) {
      navigate(info.route as any);
      return;
    }

    if (info.url) {
      openSafeUrl(info.url);
      return;
    }

    readApp(info.id);
  };

  const onAppClick = async (info: AppInfo) => {
    if (info.extraInfo?.disclaimer?.enabled) {
      tools.showLoading(true);
      try {
        const appExtra = await wallet.getAppExtra(info.id, locale);
        if (appExtra.disclaimer?.content) {
          setDisclaimer(appExtra.disclaimer);
          setDisclaimerApp(info);
          return;
        }
        tools.toastError('Failed to load app notice');
      } catch (e) {
        tools.toastError((e as any).message);
      } finally {
        tools.showLoading(false);
      }

      return;
    }

    openApp(info);
  };

  useEffect(() => {
    if (lastFetchInfo.lasfFetchChainType === chainType && Date.now() - lastFetchInfo.lastFetchTime < 1000 * 60 * 1) {
      return;
    }
    const fetchTime = Date.now();
    wallet
      .getBannerList()
      .then((data) => {
        dispatch(
          discoveryActions.setBannerList({
            bannerList: data,
            chainType,
            fetchTime
          })
        );
      })
      .catch((e) => {
        dispatch(
          discoveryActions.setBannerList({
            bannerList: [],
            chainType,
            fetchTime
          })
        );
      });

    wallet
      .getAppList()
      .then((data) => {
        dispatch(
          discoveryActions.setAppList({
            appList: data,
            chainType,
            fetchTime
          })
        );
      })
      .catch((e) => {
        dispatch(
          discoveryActions.setAppList({
            appList: [],
            chainType,
            fetchTime
          })
        );
      });
  }, [chainType, lastFetchInfo.lasfFetchChainType, lastFetchInfo.lastFetchTime]);

  useEffect(() => {
    if (hasNewBanner) {
      dispatch(discoveryActions.clearNewBannerFlag(null));
    }
  }, [hasNewBanner, dispatch]);

  useEffect(() => {
    if (tabKey > appList.length - 1) {
      setTabKey(0);
    }
  }, [appList, tabKey]);

  const tabItems = appList.map((v, index) => {
    return {
      key: index,
      label: v.tab,
      children: (
        <Column gap="lg">
          {v.items.map((w) => (
            <AppItem key={w.id} info={w} onClick={onAppClick} />
          ))}
        </Column>
      )
    };
  });

  const hasBanner = bannerList && bannerList.length > 0;

  return (
    <Layout>
      <Header
        type="home"
        LeftComponent={
          <Row>
            <Text preset="title-bold" text={t('dapp_center')} />
          </Row>
        }
        RightComponent={<SwitchNetworkBar />}
      />
      <Content data-testid="discover-screen">
        <Column justifyCenter>
          {(chainType === ChainType.FRACTAL_BITCOIN_MAINNET || chainType === ChainType.BITCOIN_MAINNET) && (
            <>
              <SearchBar />
              <Row mt="md" />
            </>
          )}
          {hasBanner ? (
            <Carousel autoplay>
              {bannerList.map((v) => (
                <BannerItem key={v.img} img={v.img} link={v.link} />
              ))}
            </Carousel>
          ) : null}

          {hasBanner ? <Row mt="md" /> : null}

          {tabItems.length > 1 ? (
            <TabBar
              defaultActiveKey={tabKey}
              activeKey={tabKey}
              items={tabItems}
              preset="style1"
              onTabClick={(key) => {
                setTabKey(key);
              }}
            />
          ) : null}

          {tabItems[tabKey] ? tabItems[tabKey].children : null}
        </Column>

        {switchChainModalVisible && (
          <SwitchChainModal
            onClose={() => {
              setSwitchChainModalVisible(false);
            }}
          />
        )}

        {disclaimerApp && disclaimer && (
          <DiscoverAppDisclaimerModal
            disclaimer={disclaimer}
            onClose={() => {
              setDisclaimerApp(null);
              setDisclaimer(null);
            }}
            onContinue={() => {
              const app = disclaimerApp;
              setDisclaimerApp(null);
              setDisclaimer(null);
              openApp(app);
            }}
          />
        )}
      </Content>
      <Footer px="zero" py="zero">
        <NavTabBar tab="discover" />
      </Footer>
    </Layout>
  );
}
