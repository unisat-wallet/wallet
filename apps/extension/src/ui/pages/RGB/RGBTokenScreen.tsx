import { useMemo, useState } from 'react';

import {
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
import { TabBar } from '@/ui/components/TabBar';
import { colors } from '@/ui/theme/colors';
import { fontSizes } from '@/ui/theme/font';
import { RgbReceiveSelectorModal } from '../Main/WalletTabScreen/RgbReceiveSelectorModal';
import {
  getRgbTokenPrecision,
  RGBTokenScreenTabKey,
  toRgbDisplayAmount,
  useRGBTokenScreenLogic
} from '@unisat/wallet-state';

import { RGBTokenDetail } from './components/RGBTokenDetail';
import { RGBTokenHistory } from './components/RGBTokenHistory';
import { useRgbWriteLeaseGuard } from './components/useRgbWriteLeaseGuard';

export default function RGBTokenScreen() {
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const [receiveSelectorOpen, setReceiveSelectorOpen] = useState(false);
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
  const spendable =
    tokenBalance?.spendable === undefined ? '--' : toRgbDisplayAmount(tokenBalance.spendable, precision);
  const lockedAmount = toRgbDisplayAmount(tokenBalance?.lockedAmount, precision);
  const pendingAmount = toRgbDisplayAmount(tokenBalance?.pending, precision);
  const displayBalance =
    lockedAmount
      ? spendable === '0'
        ? `${lockedAmount} (${t('rgb_amount_locking')})`
        : `${spendable} (${lockedAmount} ${t('rgb_amount_locking')})`
      : spendable;
  const balanceSize = displayBalance.length > 24 ? 'lg' : displayBalance.length > 16 ? 'xl' : 'xxl';

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
              <Text
                text={name}
                size="sm"
                color="ticker_color2"
                textCenter
                max2Lines
                style={{ width: '100%' }}
              />
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
              <Text
                text={displayBalance}
                preset="bold"
                textCenter
                size={balanceSize}
                max2Lines
                disableTranslate
                color="white"
                style={{ width: '100%', overflowWrap: 'anywhere' }}
              />
              {Number(tokenBalance?.pending || 0) > 0 ? (
                <Text
                  text={`${pendingAmount} (${t('pending')})`}
                  size="xs"
                  color="gold"
                  textCenter
                  wrap
                />
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
