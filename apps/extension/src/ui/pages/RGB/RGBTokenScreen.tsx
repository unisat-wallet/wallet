import { useMemo } from 'react';

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
import { BRC20Ticker } from '@/ui/components/BRC20Ticker';
import { TabBar } from '@/ui/components/TabBar';
import { colors } from '@/ui/theme/colors';
import { fontSizes } from '@/ui/theme/font';
import { RGBTokenScreenTabKey, useRGBTokenScreenLogic } from '@unisat/wallet-state';

import { RGBTokenDetail } from './components/RGBTokenDetail';
import { RGBTokenHistory } from './components/RGBTokenHistory';

export default function RGBTokenScreen() {
  const {
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
    onClickSend,
    enableTransfer,
    activeTab,
    setActiveTab,
    tabItems
  } = useRGBTokenScreenLogic();

  const tokenSummaryAny = tokenSummary as Record<string, unknown> | undefined;
  const tokenInfo = (tokenSummaryAny?.tokenInfo || tokenSummaryAny) as Record<string, any> | undefined;
  const tokenBalance = (tokenSummaryAny?.tokenBalance || tokenInfo) as Record<string, any> | undefined;
  const ticker = tokenInfo?.ticker || 'RGB';
  const name = tokenInfo?.name || ticker;
  const assetId = tokenInfo?.assetId || '';
  const spendable = tokenBalance?.spendable ?? '--';

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
        activityItems={activityItems}
        activityTotal={activityTotal}
        activityLoading={activityLoading}
        activityHasMore={activityHasMore}
        onLoadMoreActivity={onLoadMoreActivity}
        onRefreshActivity={onRefreshActivity}
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
          <Column justifyCenter itemsCenter>
            <RGBAssetIcon
              iconInfo={iconInfo || { iconUrl: '', iconShortName: ticker.slice(0, 2).toUpperCase() }}
              size={52}
            />
            <Row justifyCenter itemsCenter>
              <BRC20Ticker tick={ticker} displayName={name} preset="md" showOrigin color={'ticker_color2'} />
            </Row>
            <Column itemsCenter fullX justifyCenter>
              <Text text={spendable} preset="bold" textCenter size="xxl" wrap digital color="white" />
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
              onClick={onClickReceive}
              full
              data-testid="rgb-receive-button"
            />

            <Button
              text={t('send')}
              preset="brc20-action"
              icon="send"
              onClick={onClickSend}
              disabled={!enableTransfer}
              full
              data-testid="rgb-send-button"
            />
          </Row>
        </Column>
      </Footer>
    </Layout>
  );
}
