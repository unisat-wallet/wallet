import { useMemo, useState } from 'react';

import {
  BottomSheetHeader,
  Button,
  Column,
  Content,
  Footer,
  Header,
  Icon,
  Layout,
  Loading,
  RGBAssetIcon,
  Row,
  Text
} from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { TabBar } from '@/ui/components/TabBar';
import { colors } from '@/ui/theme/colors';
import { fontSizes } from '@/ui/theme/font';
import { formatRgbUsdtValue, isConfiguredRgbUsdt } from '@/ui/utils/rgbUsdtPrice';
import { EllipsisOutlined } from '@ant-design/icons';
import {
  RGBTokenScreenTabKey,
  getRgbTokenPrecision,
  getRgbTotalAtomicAmount,
  toRgbDisplayAmount,
  useChain,
  useRGBTokenScreenLogic,
  useWalletConfig
} from '@unisat/wallet-state';

import { RgbReceiveSelectorModal } from '../Main/WalletTabScreen/RgbReceiveSelectorModal';
import { RGBTokenDetail } from './components/RGBTokenDetail';
import { RGBTokenHistory } from './components/RGBTokenHistory';
import { useRgbWriteLeaseGuard } from './components/useRgbWriteLeaseGuard';

export default function RGBTokenScreen() {
  const chain = useChain();
  const configuredUsdtAssetId = useWalletConfig().rgbUsdtAssetId;
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const [receiveSelectorOpen, setReceiveSelectorOpen] = useState(false);
  const [actionMenuVisible, setActionMenuVisible] = useState(false);
  const {
    assetId: routeAssetId,
    tokenSummary,
    loading,
    iconInfo,
    t,
    activityItems = [],
    activityTotal = activityItems.length,
    activityLoading = false,
    activityHasMore = false,
    onLoadMoreActivity,
    onRefreshActivity,
    onClickReceive,
    onClickViewInvoices,
    onClickSend,
    onClickBurn,
    enableReceive,
    enableTransfer,
    activeTab,
    setActiveTab,
    tabItems
  } = useRGBTokenScreenLogic();

  const tokenSummaryAny = tokenSummary as Record<string, unknown> | undefined;
  const tokenInfo = (tokenSummaryAny?.tokenInfo || tokenSummaryAny) as Record<string, any> | undefined;
  const tokenBalance = (tokenSummaryAny?.tokenBalance || tokenInfo) as Record<string, any> | undefined;
  const ticker = tokenInfo?.ticker || tokenBalance?.ticker || 'RGB';
  const name = tokenInfo?.name || tokenBalance?.name || ticker;
  const assetId = routeAssetId || tokenInfo?.assetId || '';
  const precision = getRgbTokenPrecision(tokenBalance) || getRgbTokenPrecision(tokenInfo);
  const totalAtomicAmount = getRgbTotalAtomicAmount(tokenBalance);
  const totalBalance =
    totalAtomicAmount === undefined ? '--' : toRgbDisplayAmount(totalAtomicAmount, precision);
  const spendable =
    tokenBalance?.spendable === undefined ? '--' : toRgbDisplayAmount(tokenBalance.spendable, precision);
  const lockedAmount = toRgbDisplayAmount(tokenBalance?.lockedAmount, precision);
  const pendingAmount = toRgbDisplayAmount(tokenBalance?.pending, precision);
  const balanceSize = totalBalance.length > 24 ? 'lg' : totalBalance.length > 16 ? 'xl' : 'xxl';
  const isBfa = String(tokenInfo?.schema || tokenBalance?.schema || '').toUpperCase() === 'BFA';
  const showUsdtPrice =
    chain.showPrice && isConfiguredRgbUsdt(assetId, configuredUsdtAssetId) && totalBalance !== '--';

  const renderTabChildren = useMemo(() => {
    if (activeTab === RGBTokenScreenTabKey.DETAILS) {
      return (
        <RGBTokenDetail
          assetId={assetId}
          name={name}
          ticker={ticker}
          tokenInfo={tokenInfo}
          tokenBalance={tokenBalance}
        />
      );
    }

    return (
      <RGBTokenHistory
        ticker={ticker}
        displayName={name}
        precision={precision}
        activityItems={activityItems}
        activityTotal={activityTotal}
        activityLoading={activityLoading}
        activityHasMore={activityHasMore}
        onLoadMoreActivity={onLoadMoreActivity}
        onRefreshActivity={onRefreshActivity}
        showDirectionIcon
      />
    );
  }, [
    activeTab,
    activityHasMore,
    activityItems,
    activityLoading,
    activityTotal,
    assetId,
    name,
    onLoadMoreActivity,
    onRefreshActivity,
    precision,
    ticker,
    tokenBalance,
    tokenInfo
  ]);

  if (loading) {
    return (
      <Layout>
        <Content itemsCenter justifyCenter>
          <Icon size={fontSizes.xxxl} color="gold">
            <Loading />
          </Icon>
        </Content>
      </Layout>
    );
  }

  return (
    <Layout>
      <Header
        onBack={() => {
          window.history.go(-1);
        }}
        RightComponent={
          isBfa ? (
            <Icon
              style={{ fontSize: 24, color: 'rgba(255, 255, 255, 0.65)' }}
              onClick={() => setActionMenuVisible(true)}
              data-testid="rgb-token-more-button">
              <EllipsisOutlined />
            </Icon>
          ) : null
        }
      />
      {tokenSummary ? (
        <Content>
          <Column justifyCenter itemsCenter fullX>
            <RGBAssetIcon
              iconInfo={iconInfo || { iconUrl: '', iconShortName: (name || ticker).slice(0, 2).toUpperCase() }}
              ticker={ticker}
              name={name}
              size={52}
            />
            <Column itemsCenter gap="xs" fullX px="lg" style={{ minWidth: 0 }}>
              <Text text={name} size="sm" color="ticker_color2" textCenter max2Lines style={{ width: '100%' }} />
              <Text
                text={`(ticker: ${ticker})`}
                size="xs"
                color="textDim"
                textCenter
                ellipsis
                style={{ width: '100%' }}
              />
            </Column>
            <Column itemsCenter fullX justifyCenter>
              <Text text={t('total_balance')} size="xxs" color="textDim" textCenter />
              <Text
                text={totalBalance}
                preset="bold"
                textCenter
                size={balanceSize}
                max2Lines
                disableTranslate
                color="white"
                style={{ width: '100%', overflowWrap: 'anywhere' }}
              />
              {showUsdtPrice ? (
                <Column itemsCenter gap="zero">
                  <Text text={formatRgbUsdtValue(totalBalance)} size="md" color="textDim" textCenter disableTranslate />
                </Column>
              ) : null}
              <Text
                text={`${t('available_balance')}: ${spendable}`}
                size="xs"
                color="textDim"
                textCenter
                wrap
              />
              {Number(tokenBalance?.pending || 0) > 0 ? (
                <Text text={`${t('pending')}: ${pendingAmount}`} size="xs" color="gold" textCenter wrap />
              ) : null}
              {Number(tokenBalance?.lockedAmount || 0) > 0 ? (
                <Text text={`${t('rgb_amount_locking')}: ${lockedAmount}`} size="xs" color="gold" textCenter wrap />
              ) : null}
            </Column>
          </Column>

          <TabBar
            defaultActiveKey={activeTab}
            activeKey={activeTab}
            items={tabItems}
            preset="style3"
            onTabClick={(key) => {
              setActiveTab(key as RGBTokenScreenTabKey);
            }}
          />

          {renderTabChildren}
        </Content>
      ) : (
        <Content itemsCenter justifyCenter>
          <Text text={t('protocol_data_unavailable')} preset="sub" />
        </Content>
      )}

      <Footer
        style={{
          borderTopWidth: 1,
          borderColor: colors.border2
        }}>
        <Column gap="sm" fullX>
          <Row gap="sm" mt="sm" mb="md">
            <Button
              text={t('receive')}
              preset="brc20-action"
              icon="receive"
              onClick={() => setReceiveSelectorOpen(true)}
              disabled={!enableReceive}
              full
              textStyle={{ fontSize: 14 }}
              data-testid="rgb-receive-button"
            />

            <Button
              text={t('send')}
              preset="brc20-action"
              icon="send"
              onClick={() => void requestWrite(onClickSend)}
              disabled={!enableTransfer}
              full
              textStyle={{ fontSize: 14 }}
              data-testid="rgb-send-button"
            />
          </Row>
        </Column>
      </Footer>
      {actionMenuVisible ? (
        <BottomModal onClose={() => setActionMenuVisible(false)} bodyStyle={{ padding: 0 }}>
          <Column fullX gap="zero">
            <BottomSheetHeader title={t('more')} onClose={() => setActionMenuVisible(false)} />
            <Row
              fullX
              itemsCenter
              gap="md"
              onClick={() => {
                if (!enableTransfer) return;
                setActionMenuVisible(false);
                void requestWrite(onClickBurn);
              }}
              style={{ padding: '0 20px 24px', boxSizing: 'border-box', opacity: enableTransfer ? 1 : 0.45 }}
              data-testid="rgb-burn-menu-item">
              <Text text={t('rgb_burn')} size="sm" />
            </Row>
          </Column>
        </BottomModal>
      ) : null}
      {receiveSelectorOpen && (
        <RgbReceiveSelectorModal
          assetId={assetId}
          onClose={() => setReceiveSelectorOpen(false)}
          onViewInvoices={() => {
            setReceiveSelectorOpen(false);
            onClickViewInvoices();
          }}
          onCreateInvoice={() => {
            setReceiveSelectorOpen(false);
            void requestWrite(onClickReceive);
          }}
        />
      )}
      {writeLeaseModal}
    </Layout>
  );
}
