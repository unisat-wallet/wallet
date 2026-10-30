import BigNumber from 'bignumber.js';
import { useMemo } from 'react';

import { Button, Checkbox, Column, Content, Header, Icon, Input, Layout, Row, Text } from '@/ui/components';
import BRC20Preview from '@/ui/components/BRC20Preview';
import { BRC20Ticker } from '@/ui/components/BRC20Ticker';
import { FeeRateBar } from '@/ui/components/FeeRateBar';
import { RBFBar } from '@/ui/components/RBFBar';
import { RefreshButton } from '@/ui/components/RefreshButton';
import { TabBar } from '@/ui/components/TabBar';
import { TickUsdWithoutPrice, TokenType } from '@/ui/components/TickUsd';
import { fontSizes } from '@/ui/theme/font';
import { showLongNumber } from '@/ui/utils';
import { getUiType } from '@/ui/web';
import { TokenBalance } from '@unisat/wallet-shared';
import {
  BRC20SendStepParams,
  BRC20SendTabKey,
  useBRC20SendScreenLogic,
  useBRC20SendScreenLogicStep1,
  useBRC20SendScreenLogicStep2,
  useBRC20SendScreenLogicStep3,
  useI18n,
  useNavigation,
  useTransferableListLogic,
  useWallet
} from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';

function Step1({ contextData, updateContextData }: BRC20SendStepParams) {
  const { t, disabled, tokenBalance, onClickNext } = useBRC20SendScreenLogicStep1({ contextData, updateContextData });

  return (
    <Content pt="lg">
      <Column full>
        <Column gap="lg" full>
          <Column>
            <TransferableList contextData={contextData} updateContextData={updateContextData} />
          </Column>

          <Row justifyCenter>
            <Column style={{ width: '100%' }}>
              <InscribeTransferButton tokenBalance={tokenBalance} />
            </Column>
          </Row>
        </Column>

        <Button data-testid="brc20-next-button" text={t('next')} preset="primary" onClick={onClickNext} disabled={disabled} />
      </Column>
    </Content>
  );
}

const InscribeTransferButton = ({ tokenBalance }: { tokenBalance: TokenBalance }) => {
  const { t } = useI18n();
  const nav = useNavigation();
  const isSafeBalanceZero = tokenBalance.availableBalanceSafe != '0';

  return (
    <Column fullX>
      <Button
        data-testid="brc20-transfer-inscribe-button"
        preset="default"
        onClick={() => {
          nav.navigate('InscribeTransferScreen', { ticker: tokenBalance.ticker });
        }}
        style={{
          width: '100%',
          background: '#1C1C1E',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          padding: '16px 14px',
          height: '72px',
          position: 'relative'
        }}>
        <Column style={{ width: '100%' }}>
          <Row style={{ width: '100%' }} justifyBetween itemsCenter>
            <Text text={t('inscribe_transfer')} preset="bold" size="sm" style={{ whiteSpace: 'nowrap' }} />
            <div style={{ opacity: 0.6 }}>
              <Icon icon="arrow-right" size="sm" />
            </div>
          </Row>
          <Row style={{ width: '100%' }} justifyBetween>
            <Text text={t('available')} preset="regular" size="sm" />
            <Row itemsCenter gap="sm">
              <Text text={`${tokenBalance.availableBalanceSafe}  `} color="white" preset="bold" digital />
              {!isSafeBalanceZero && (
                <Text text={` + ${tokenBalance.availableBalanceUnSafe}`} color="textDim" digital />
              )}
            </Row>
          </Row>
        </Column>
      </Button>
      <Row style={{ width: '100%' }} justifyCenter mt="md">
        <Text text={t('to_send_brc20_you_have_to_inscribe_a_transfer_inscription_first')} preset="sub" textCenter />
      </Row>
    </Column>
  );
};

function TransferableList({ contextData, updateContextData }: BRC20SendStepParams) {
  const {
    // data
    items,
    selectedCount,
    allSelected,

    // actions
    onClickItem,
    onCheckBoxChange,
    onClickRefresh,

    // tools
    t
  } = useTransferableListLogic({ contextData, updateContextData });

  return (
    <Column>
      <Column>
        <Text text={t('transfer_amount')} color="textDim" />
        <Row justifyCenter itemsCenter>
          <Text
            text={`${showLongNumber(contextData.transferAmount)}`}
            size="xxl"
            textCenter
            my="lg"
            digital
            style={{
              maxWidth: '85%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              wordBreak: 'break-all',
              fontSize: new BigNumber(contextData.transferAmount).gte(1000000) ? fontSizes.xl : fontSizes.xxl
            }}
          />
          <BRC20Ticker tick={contextData.tokenBalance.ticker} displayName={contextData.tokenBalance.displayName} />
        </Row>
        <Row justifyCenter itemsCenter style={{ marginTop: -12 }}>
          <TickUsdWithoutPrice
            tick={contextData.tokenBalance.ticker}
            balance={contextData.transferAmount}
            type={TokenType.BRC20}
            size={'md'}
          />
        </Row>
      </Column>

      {items.length > 0 ? (
        <Column style={{ marginTop: 16 }}>
          <Row justifyBetween>
            <Text text={`${t('transfer_inscriptions')} (${selectedCount}/${items.length})`} color="textDim" />
          </Row>

          <Row overflowX gap="lg" pb="md">
            {items.map((v, index) => (
              <BRC20Preview
                key={v.inscriptionId}
                tick={v.ticker}
                balance={v.amount}
                inscriptionNumber={v.inscriptionNumber}
                timestamp={v.timestamp}
                selected={contextData.inscriptionIdSet.has(v.inscriptionId)}
                type="TRANSFER"
                onClick={() => onClickItem(v)}
              />
            ))}
          </Row>

          <Row justifyEnd>
            <Row mx="md">
              <RefreshButton onClick={onClickRefresh} />
            </Row>

            <Checkbox onChange={onCheckBoxChange} checked={allSelected} style={{ fontSize: fontSizes.sm }}>
              <Text text={t('select_all')} preset="sub" color="white" />
            </Checkbox>
          </Row>
        </Column>
      ) : (
        <Column>
          <Row justifyBetween>
            <Text text={t('transfer_inscriptions_0')} color="textDim" />
            <RefreshButton onClick={onClickRefresh} />
          </Row>
        </Column>
      )}
    </Column>
  );
}

function Step2({ contextData, updateContextData }: BRC20SendStepParams) {
  const { t, disabled, onStep2ClickNext } = useBRC20SendScreenLogicStep2({ contextData, updateContextData });
  const wallet = useWallet();
  return (
    <Content mt="lg">
      <Column full>
        <Column>
          <Row justifyBetween>
            <Text text={t('send')} preset="regular" />
            <TickUsdWithoutPrice
              tick={contextData.tokenBalance.ticker}
              balance={contextData.transferAmount}
              type={TokenType.BRC20}
              size={'sm'}
            />
          </Row>
          <Input
            preset="text"
            value={`${showLongNumber(contextData.transferAmount)} ${contextData.tokenBalance.ticker}`}
            disabled
          />
        </Column>

        <Column>
          <Input
            preset="address"
            data-testid="brc20-recipient-address-input"
            addressInputData={{
              address: '',
              domain: ''
            }}
            autoFocus={true}
            onAddressInputChange={(val) => {
              updateContextData({ receiver: val.address });
            }}
          />
        </Column>
        <Column>
          <FeeRateBar />
        </Column>
        <Column mt="lg">
          <RBFBar
            value={contextData.enableRBF}
            onChange={(val) => {
              updateContextData({ enableRBF: val });
              wallet.setEnableRBF(val);
            }}
          />
        </Column>
      </Column>

      <Button data-testid="brc20-next-button" text={t('next')} preset="primary" onClick={onStep2ClickNext} disabled={disabled} />
    </Content>
  );
}

function Step3(props: BRC20SendStepParams) {
  const { signPsbtParams, onSignPsbtConfirm } = useBRC20SendScreenLogicStep3(props);
  return <SignPsbt params={signPsbtParams} handleConfirm={onSignPsbtConfirm} />;
}

export default function BRC20SendScreen() {
  const { contextData, updateContextData, onHeaderBack, onTabClick } = useBRC20SendScreenLogic();

  const component = useMemo(() => {
    if (contextData.tabKey === BRC20SendTabKey.STEP1) {
      return <Step1 contextData={contextData} updateContextData={updateContextData} />;
    } else if (contextData.tabKey === BRC20SendTabKey.STEP2) {
      return <Step2 contextData={contextData} updateContextData={updateContextData} />;
    } else {
      return <Step3 contextData={contextData} updateContextData={updateContextData} />;
    }
  }, [contextData.tabKey, contextData, updateContextData]);

  const { t } = useI18n();

  const nav = useNavigation();
  const { isSidePanel } = getUiType();

  return (
    <Layout>
      <Header onBack={onHeaderBack} title={t('send')} />
      <Column bg={isSidePanel ? 'black' : 'transparent'} style={{ flex: 1 }}>
        <Row justifyCenter>
          <TabBar
            progressEnabled
            defaultActiveKey={BRC20SendTabKey.STEP1}
            activeKey={contextData.tabKey}
            items={[
              { key: BRC20SendTabKey.STEP1, label: t('step1') },
              { key: BRC20SendTabKey.STEP2, label: t('step2') }
              // { key: TabKey.STEP3, label: 'Step3' }
            ]}
            onTabClick={onTabClick}
          />
        </Row>

        <Column style={{ flex: 1 }}>{component}</Column>
      </Column>
    </Layout>
  );
}
