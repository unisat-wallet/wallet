import { useMemo, useState } from 'react';

import { Button, Column, Content, Footer, Header, Layout, Row, Text } from '@/ui/components';
import { BRC20Ticker } from '@/ui/components/BRC20Ticker';
import { TabBar } from '@/ui/components/TabBar';
import { TickUsdWithoutPrice, TokenType } from '@/ui/components/TickUsd';
import { TokenScreenIcon } from '@/ui/components/TokenScreenIcon';
import { colors } from '@/ui/theme/colors';
import { BRC20TokenScreenTabKey, useBRC20TokenScreenLogic, useNavigation } from '@unisat/wallet-state';

import { BRC20InSwapMoreSheet } from './components/BRC20InSwapMoreSheet';
import { BRC20OutWalletBalance, type BRC20OutWalletBalanceItem } from './components/BRC20OutWalletBalance';
import { BRC20TokenDetail } from './components/BRC20TokenDetail';
import { BRC20TokenHistory } from './components/BRC20TokenHistory';

export default function BRC20TokenScreen() {
  const nav = useNavigation();
  const [isInSwapMoreOpen, setIsInSwapMoreOpen] = useState(false);
  const [isProgMoreOpen, setIsProgMoreOpen] = useState(false);
  const screenLogic = useBRC20TokenScreenLogic() as ReturnType<typeof useBRC20TokenScreenLogic> & {
    outWalletBalanceItems: BRC20OutWalletBalanceItem[];
    onClickAddLiquidityInSwap: () => void;
    onClickRemoveLiquidityInSwap: () => void;
  };
  const outWalletCardStyle = {
    backgroundColor: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: '12px 10px',
    gap: 13
  } as const;
  const outWalletActionButtonStyle = {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0,
    borderRadius: 8,
    minHeight: 48,
    marginLeft: 0,
    marginRight: 0,
    paddingTop: 8,
    paddingBottom: 8
  } as const;
  const {
    totalBalance,
    onSwapBalance,
    onProgBalance,
    outWalletBalanceItems,
    hasOutWalletBalance,
    enableHistory,
    enableTrade,
    enableMint,
    enableTransfer,
    loading,
    tokenSummary,
    deployInscription,
    activeTab,
    setActiveTab,
    tabItems,
    t,
    ticker,
    chain,
    iconInfo,
    isBrc20Prog,
    onClickWrapBrc20Prog,
    onClickUnwrapBrc20Prog,
    onClickSendBrc20Prog,

    onClickSwapInSwap,
    onClickAddLiquidityInSwap,
    onClickRemoveLiquidityInSwap,
    onClickWrapInSwap,
    onClickUnwrapInSwap,
    onClickSendInSwap,

    onClickMint,
    onClickSend,
    onClickTrade,
    onClickSingleStepSend
  } = screenLogic;

  const renderTabChildren = useMemo(() => {
    if (activeTab === BRC20TokenScreenTabKey.HISTORY && enableHistory) {
      return <BRC20TokenHistory ticker={ticker} displayName={tokenSummary?.tokenBalance?.displayName} />;
    }

    if (activeTab === BRC20TokenScreenTabKey.DETAILS) {
      return <BRC20TokenDetail ticker={ticker} tokenSummary={tokenSummary!} deployInscription={deployInscription!} />;
    }
  }, [activeTab, deployInscription, enableHistory, tokenSummary]);

  const handleOpenInSwapMore = () => {
    setIsInSwapMoreOpen(true);
  };

  const handleCloseInSwapMore = () => {
    setIsInSwapMoreOpen(false);
  };

  const handleOpenProgMore = () => {
    setIsProgMoreOpen(true);
  };

  const handleCloseProgMore = () => {
    setIsProgMoreOpen(false);
  };

  const runInSwapMoreAction = (action: () => void) => {
    setIsInSwapMoreOpen(false);
    action();
  };

  const runProgMoreAction = (action: () => void) => {
    setIsProgMoreOpen(false);
    action();
  };

  return (
    <Layout>
      <Header hideLogo onBack={() => nav.goBack()} />

      {tokenSummary && (
        <Content mt="zero">
          <Column justifyCenter itemsCenter>
            <TokenScreenIcon iconInfo={iconInfo} />
            <Row justifyCenter itemsCenter>
              <BRC20Ticker
                tick={ticker}
                displayName={tokenSummary.tokenBalance.displayName}
                preset="md"
                showOrigin
                color={'ticker_color2'}
              />
              <Row style={{ backgroundColor: 'rgba(244, 182, 44, 0.15)', borderRadius: 4 }} px="md" py="sm">
                {isBrc20Prog ? (
                  <Text text={'brc2.0'} style={{ color: 'rgba(244, 182, 44, 0.85)' }} />
                ) : (
                  <Text text={'brc-20'} style={{ color: 'rgba(244, 182, 44, 0.85)' }} />
                )}
              </Row>
            </Row>
            <Column itemsCenter fullX justifyCenter>
              <Text text={`${totalBalance}`} preset="bold" textCenter size="xxl" wrap digital color="white" />
            </Column>
            <Row justifyCenter fullX>
              <TickUsdWithoutPrice tick={ticker} balance={totalBalance} type={TokenType.BRC20} size={'md'} />
            </Row>
          </Column>

          {hasOutWalletBalance ? (
            <Column mb="md" style={outWalletCardStyle}>
              <BRC20OutWalletBalance items={outWalletBalanceItems} />
              {onSwapBalance && onSwapBalance !== '0' ? (
                <Row gap="sm">
                  <Button
                    text={t('swap_wrap')}
                    preset="swap"
                    icon="swap_wrap"
                    onClick={onClickWrapInSwap}
                    style={outWalletActionButtonStyle}
                    iconSize={{
                      width: 12,
                      height: 12
                    }}
                    full
                  />
                  <Button
                    text={t('swap_unwrap')}
                    preset="swap"
                    icon="swap_unwrap"
                    onClick={onClickUnwrapInSwap}
                    style={outWalletActionButtonStyle}
                    iconSize={{
                      width: 12,
                      height: 12
                    }}
                    full
                  />
                  <Button
                    text={t('more')}
                    preset="swap"
                    icon="more"
                    onClick={handleOpenInSwapMore}
                    style={outWalletActionButtonStyle}
                    iconSize={{
                      width: 12,
                      height: 12
                    }}
                    full
                  />
                </Row>
              ) : null}

              {onProgBalance && onProgBalance !== '0' ? (
                <Row gap="sm">
                  <Button
                    text={t('swap_wrap')}
                    preset="swap"
                    icon="swap_wrap"
                    onClick={onClickWrapBrc20Prog}
                    style={outWalletActionButtonStyle}
                    iconSize={{
                      width: 12,
                      height: 12
                    }}
                    full
                  />
                  <Button
                    text={t('swap_unwrap')}
                    preset="swap"
                    icon="swap_unwrap"
                    onClick={onClickUnwrapBrc20Prog}
                    style={outWalletActionButtonStyle}
                    iconSize={{
                      width: 12,
                      height: 12
                    }}
                    full
                  />
                  <Button
                    text={t('more')}
                    preset="swap"
                    icon="more"
                    onClick={handleOpenProgMore}
                    style={outWalletActionButtonStyle}
                    iconSize={{
                      width: 12,
                      height: 12
                    }}
                    full
                  />
                </Row>
              ) : null}
            </Column>
          ) : null}

          <TabBar
            defaultActiveKey={enableHistory ? activeTab : BRC20TokenScreenTabKey.DETAILS}
            activeKey={enableHistory ? activeTab : BRC20TokenScreenTabKey.DETAILS}
            items={tabItems}
            preset="style3"
            onTabClick={(key) => {
              setActiveTab(key as BRC20TokenScreenTabKey);
            }}
          />

          {renderTabChildren}
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
              text={t('mint')}
              preset="brc20-action"
              style={!enableMint ? { backgroundColor: 'rgba(255,255,255,0.15)' } : {}}
              disabled={!enableMint}
              icon="mint_action"
              onClick={onClickMint}
              full
            />

            <Button
              text={t('send')}
              preset="brc20-action"
              icon="send"
              disabled={!enableTransfer}
              onClick={onClickSend}
              style={{
                width: chain.enableBrc20SingleStep && !enableTrade ? '75px' : 'auto'
              }}
              full
            />

            <Button
              text={t('trade')}
              preset="brc20-action"
              icon="trade"
              disabled={!enableTrade}
              onClick={onClickTrade}
              full
            />
          </Row>

          {chain.enableBrc20SingleStep ? (
            <Button
              text={t('single_step_transfer')}
              preset="home"
              icon="brc20-single-step"
              style={{
                background: 'linear-gradient(113deg, #EABB5A 5.41%, #E78327 92.85%)',
                color: 'black',
                width: enableTrade ? 'auto' : '328px',
                minHeight: '42px',
                borderRadius: '12px',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                padding: '0 8px'
              }}
              textStyle={{
                color: 'black'
              }}
              disabled={!enableTransfer}
              onClick={onClickSingleStepSend}
            />
          ) : null}
        </Column>
      </Footer>
      {isInSwapMoreOpen ? (
        <BRC20InSwapMoreSheet
          onClose={handleCloseInSwapMore}
          actions={[
            {
              key: 'add-liquidity',
              label: t('add_liquidity'),
              icon: 'add_liquidity',
              onClick: () => runInSwapMoreAction(onClickAddLiquidityInSwap)
            },
            {
              key: 'swap',
              label: t('swap_swap'),
              icon: 'swap_more',
              onClick: () => runInSwapMoreAction(onClickSwapInSwap)
            },
            {
              key: 'send',
              label: t('send'),
              icon: 'send_grey',
              onClick: () => runInSwapMoreAction(onClickSendInSwap)
            }
          ]}
          t={t}
        />
      ) : null}
      {isProgMoreOpen ? (
        <BRC20InSwapMoreSheet
          onClose={handleCloseProgMore}
          actions={[
            {
              key: 'send',
              label: t('send'),
              icon: 'send_grey',
              onClick: () => runProgMoreAction(onClickSendBrc20Prog)
            }
          ]}
          t={t}
        />
      ) : null}
    </Layout>
  );
}
