import { useCallback, useState } from 'react';

import {
  Button,
  Card,
  Column,
  Content,
  Footer,
  Header,
  Icon,
  Layout,
  Loading,
  Row,
  Text,
  TransferAmountCard,
  TransferAmountSection
} from '@/ui/components';
import { BRC20Ticker } from '@/ui/components/BRC20Ticker';
import { BtcUsd } from '@/ui/components/BtcUsd';
import { Empty } from '@/ui/components/Empty';
import { FeeRateBar } from '@/ui/components/FeeRateBar';
import InscriptionPreview from '@/ui/components/InscriptionPreview';
import { OutputValueBar } from '@/ui/components/OutputValueBar';
import { RBFBar } from '@/ui/components/RBFBar';
import { TickUsdWithoutPrice, TokenType } from '@/ui/components/TickUsd';
import { Tooltip } from '@/ui/components/Tooltip';
import WebsiteBar from '@/ui/components/WebsiteBar';
import { fontSizes } from '@/ui/theme/font';
import { spacing } from '@/ui/theme/spacing';
import { amountToSatoshis, showLongNumber } from '@/ui/utils';
import { paramsUtils } from '@unisat/base-utils';
import { InscribeOrder, RawTxInfo, TokenBalance, TokenInfo } from '@unisat/wallet-shared';
import {
  BRC20InscribeTransferParams,
  useBRC20InscribeTransferLogic,
  useBRC20InscribeTransferLogicStep1,
  useBRC20InscribeTransferLogicStep2,
  useBRC20InscribeTransferLogicStep3,
  useBRC20InscribeTransferLogicStep4
} from '@unisat/wallet-state';

import SignPsbt from './SignPsbt';

interface Props {
  params: {
    data: {
      ticker: string;
      amount: string;
    };
    session: {
      origin: string;
      icon: string;
      name: string;
    };
  };
}

enum Step {
  STEP1,
  STEP2,
  STEP3,
  STEP4
}

interface ContextData {
  step: Step;
  ticker: string;
  session?: any;
  tokenBalance?: TokenBalance;
  order?: InscribeOrder;
  rawTxInfo?: RawTxInfo;
  amount?: string;
  isApproval: boolean;
  tokenInfo?: TokenInfo;
  amountEditable?: boolean;
  enableRBF: boolean;
}

interface UpdateContextDataParams {
  step?: Step;
  ticket?: string;
  session?: any;
  tokenBalance?: TokenBalance;
  order?: InscribeOrder;
  rawTxInfo?: RawTxInfo;
  amount?: string;
  tokenInfo?: TokenInfo;
  amountEditable?: boolean;
  enableRBF?: boolean;
}

export default function InscribeTransfer({ params: { data, session } }: Props) {
  const [contextData, setContextData] = useState<ContextData>({
    step: Step.STEP1,
    ticker: data.ticker,
    amount: data.amount,
    session,
    isApproval: true,
    enableRBF: true
  });
  const updateContextData = useCallback(
    (params: UpdateContextDataParams) => {
      setContextData(Object.assign({}, contextData, params));
    },
    [contextData, setContextData]
  );

  if (contextData.step === Step.STEP1) {
    return <Step1 contextData={contextData} updateContextData={updateContextData} />;
  } else if (contextData.step === Step.STEP2) {
    return <Step2 contextData={contextData} updateContextData={updateContextData} />;
  } else if (contextData.step === Step.STEP3) {
    return <Step3 contextData={contextData} updateContextData={updateContextData} />;
  } else {
    return <Step4 contextData={contextData} updateContextData={updateContextData} />;
  }
}

export function InscribeTransferScreen() {
  const { contextData, updateContextData } = useBRC20InscribeTransferLogic();

  if (contextData.step === Step.STEP1) {
    return <Step1 contextData={contextData} updateContextData={updateContextData} />;
  } else if (contextData.step === Step.STEP2) {
    return <Step2 contextData={contextData} updateContextData={updateContextData} />;
  } else if (contextData.step === Step.STEP3) {
    return <Step3 contextData={contextData} updateContextData={updateContextData} />;
  } else {
    return <Step4 contextData={contextData} updateContextData={updateContextData} />;
  }
}

function Step1(params: BRC20InscribeTransferParams) {
  const { contextData, updateContextData } = params;
  const {
    onClickInscribe,
    loading,
    t,
    nav,
    inputAmount,
    inputError,
    setInputAmount,
    inputDisabled,
    inputErrorAvailable,
    defaultOutputValue,
    setOutputValue,
    disabled,
    enableRBF,
    setEnableRBF,
    loadingOnly,
    handleCancel
  } = useBRC20InscribeTransferLogicStep1(params);

  const { tokenBalance } = contextData;

  return (
    <Layout>
      {contextData.isApproval ? (
        <Header>
          <WebsiteBar session={contextData.session} />
        </Header>
      ) : (
        <Header
          onBack={() => {
            window.history.go(-1);
          }}
        />
      )}
      <Content>
        <Column full>
          <Column gap="lg" full>
            <Text text={t('inscribe_transfer')} preset="title-bold" textCenter my="lg" />

            <TransferAmountSection
              title={t('amount')}
              titleExtra={
                <TickUsdWithoutPrice tick={contextData.ticker} balance={inputAmount} type={TokenType.BRC20} />
              }>
              <TransferAmountCard
                amount={inputAmount}
                onAmountChange={setInputAmount}
                placeholder="0"
                readOnly={inputDisabled}
                showMax={Boolean(tokenBalance) && !inputDisabled}
                onMaxClick={() => {
                  if (tokenBalance) {
                    setInputAmount(tokenBalance.availableBalanceSafe);
                  }
                }}
                availableAmount={tokenBalance ? tokenBalance.availableBalanceSafe : t('loading')}
                unit={tokenBalance?.displayName || tokenBalance?.ticker || contextData.ticker}
                runesDecimal={contextData.tokenInfo?.decimal}
                inputTestId="inscribe-transfer-amount-input"
                availableExtra={
                  tokenBalance && tokenBalance.availableBalanceUnSafe !== '0' ? (
                    <Tooltip
                      title={`${tokenBalance.availableBalanceUnSafe} ${tokenBalance.ticker} ${t(
                        'is_unconfirmed_please_wait_for_confirmation'
                      )}`}
                      overlayStyle={{
                        fontSize: fontSizes.xs
                      }}>
                      <Row itemsCenter gap="xs">
                        <Text
                          text={` + ${showLongNumber(tokenBalance.availableBalanceUnSafe)}`}
                          color="textDim"
                          size="xs"
                          digital
                        />
                        <Icon icon="circle-question" color="textDim" size={12} />
                      </Row>
                    </Tooltip>
                  ) : null
                }
              />
            </TransferAmountSection>
            {inputError ? <Text text={inputError} color="error" /> : null}
            {inputErrorAvailable ? <Text text={inputErrorAvailable} color="error" /> : null}

            <Column mt="lg">
              <Text text={t('output_value')} preset="regular" />

              <OutputValueBar
                defaultValue={defaultOutputValue}
                minValue={defaultOutputValue}
                onChange={(val) => {
                  setOutputValue(val);
                }}
              />
            </Column>

            <Column mt="lg">
              <FeeRateBar />
            </Column>

            <Column mt="lg">
              <RBFBar value={enableRBF} onChange={setEnableRBF} />
            </Column>
          </Column>
        </Column>
      </Content>

      {contextData.isApproval ? (
        <Footer>
          <Row full>
            <Button text={t('cancel')} preset="default" onClick={handleCancel} full />
            <Button data-testid="brc20-next-button" text={t('next')} preset="primary" onClick={onClickInscribe} full disabled={disabled} />
          </Row>
        </Footer>
      ) : (
        <Footer>
          <Row full>
            <Button data-testid="brc20-next-button" text={t('next')} preset="primary" onClick={onClickInscribe} full disabled={disabled} />
          </Row>
        </Footer>
      )}
    </Layout>
  );
}

function Step2(params: BRC20InscribeTransferParams) {
  const { contextData, updateContextData } = params;
  const {
    t,
    btcUnit,
    networkFee,
    outputValue,
    minerFee,
    serviceFee,
    originServiceFee,
    isEmpty,
    amount,
    tokenBalance,
    totalFee
  } = useBRC20InscribeTransferLogicStep2(params);

  if (isEmpty) {
    return <Empty />;
  }
  return (
    <Layout>
      {contextData.isApproval ? (
        <Header>
          <WebsiteBar session={contextData.session} />
        </Header>
      ) : (
        <Header
          onBack={() => {
            updateContextData({
              step: Step.STEP1,
              amountEditable: true
            });
          }}
        />
      )}
      <Content>
        <Column full>
          <Column gap="lg" full>
            <Text text={t('inscribe_transfer')} preset="title-bold" textCenter mt="lg" />

            <Column justifyCenter style={{ height: 250 }}>
              <Row itemsCenter justifyCenter>
                <Text text={`${amount}`} preset="title-bold" size="xxl" textCenter wrap digital />
                <BRC20Ticker tick={tokenBalance.ticker} displayName={tokenBalance.displayName} preset="lg" />
              </Row>
              <Row itemsCenter justifyCenter>
                <TickUsdWithoutPrice tick={tokenBalance.ticker} balance={amount + ''} type={TokenType.BRC20} />
              </Row>
              <Column mt="xxl">
                <Text text={t('preview')} preset="sub-bold" />
                <Card preset="style2">
                  <Text
                    text={`{"p":"brc-20","op":"transfer","tick":"${
                      tokenBalance.ticker
                    }","amt":"${paramsUtils.formatAmount(amount)}"}`}
                    size="xs"
                    wrap
                  />
                </Card>
              </Column>
            </Column>

            <Column>
              <Row justifyBetween>
                <Text text={t('payment_network_fee')} color="textDim" />
                <Text text={`${networkFee} ${btcUnit}`} />
              </Row>

              <Row justifyBetween>
                <Text text={t('inscription_output_value')} color="textDim" />
                <Text text={`${outputValue} ${btcUnit}`} />
              </Row>

              <Row justifyBetween>
                <Text text={t('inscription_network_fee')} color="textDim" />
                <Text text={`${minerFee} ${btcUnit}`} />
              </Row>

              <Row justifyBetween>
                <Text text={t('service_fee')} color="textDim" />
                {originServiceFee != serviceFee ? (
                  <Column>
                    <Text
                      text={`${originServiceFee} ${btcUnit}`}
                      style={{ textDecorationLine: 'line-through' }}
                      color="textDim"
                    />
                    <Text text={`${serviceFee} ${btcUnit}`} />
                  </Column>
                ) : (
                  <Text text={`${serviceFee} ${btcUnit}`} />
                )}
              </Row>
              <Row justifyBetween>
                <Text text={t('total')} color="gold" />
                <Text text={`${totalFee} ${btcUnit}`} color="gold" />
              </Row>
              <Row justifyBetween>
                <div></div>
                <BtcUsd sats={amountToSatoshis(totalFee)} />
              </Row>
            </Column>
          </Column>
        </Column>
      </Content>
      {contextData.isApproval ? (
        <Footer>
          <Row full>
            <Button
              text={t('back')}
              preset="default"
              onClick={() => {
                updateContextData({
                  step: Step.STEP1,
                  amountEditable: true
                });
              }}
              full
            />
            <Button
              text={t('next')}
              preset="primary"
              onClick={() => {
                updateContextData({
                  step: Step.STEP3
                });
                // onClickConfirm();
              }}
              full
            />
          </Row>
        </Footer>
      ) : (
        <Footer>
          <Row full>
            <Button
              text={t('next')}
              preset="primary"
              onClick={() => {
                updateContextData({
                  step: Step.STEP3
                });
                // onClickConfirm();
              }}
              full
            />
          </Row>
        </Footer>
      )}
    </Layout>
  );
}

function Step3(params: BRC20InscribeTransferParams) {
  const { contextData } = params;
  const { onHeaderBack, signPsbtParams, onSignPsbtHandleConfirm } = useBRC20InscribeTransferLogicStep3(params);
  return (
    <SignPsbt
      header={
        contextData.isApproval ? (
          <Header>
            <WebsiteBar session={contextData.session} />
          </Header>
        ) : (
          <Header onBack={onHeaderBack} />
        )
      }
      params={signPsbtParams}
      handleConfirm={onSignPsbtHandleConfirm}
    />
  );
}

function Step4(params: BRC20InscribeTransferParams) {
  const { contextData } = params;
  const { t, onClickConfirm, result } = useBRC20InscribeTransferLogicStep4(params);

  if (!contextData.order || !contextData.tokenBalance) {
    return <Empty />;
  }

  if (!result) {
    return (
      <Layout>
        {contextData.isApproval ? (
          <Header>
            <WebsiteBar session={contextData.session} />
          </Header>
        ) : (
          <Header />
        )}
        <Content data-testid="brc20-inscribing-screen" style={{ gap: spacing.small }}>
          <Column justifyCenter mt="xxl" gap="xl">
            <Row justifyCenter>
              <Icon icon="success" size={72} style={{ alignSelf: 'center' }} />
            </Row>

            <Text preset="title" text={t('tx_sent_title')} textCenter />
            <Text preset="sub" text={t('tx_sent_desc')} color="textDim" textCenter />

            <Column justifyCenter itemsCenter>
              <Column mt="lg">
                <Loading text={t('inscribing')} />
              </Column>
            </Column>
          </Column>
        </Content>
      </Layout>
    );
  }

  return (
    <Layout>
      {contextData.isApproval ? (
        <Header>
          <WebsiteBar session={contextData.session} />
        </Header>
      ) : (
        <Header />
      )}
      <Content data-testid="brc20-inscribe-success-screen" style={{ gap: spacing.small }}>
        <Column justifyCenter mt="xxl" gap="xl">
          <Text text={t('inscribe_success')} preset="title-bold" textCenter />
          <Column justifyCenter itemsCenter style={{ width: '100%', alignItems: 'center' }}>
            <div style={{ width: '120px' }}>
              <InscriptionPreview data={result.inscription} preset="medium" />
            </div>

            <Column mt="lg">
              <Text text={t('the_transferable_and_available_balance_of_brc20_wi')} textCenter />
            </Column>
          </Column>
        </Column>
      </Content>
      {contextData.isApproval ? (
        <Footer>
          <Row full>
            <Button
              data-testid="brc20-inscribe-done-button"
              text={t('done')}
              preset="primary"
              onClick={() => {
                onClickConfirm();
              }}
              full
            />
          </Row>
        </Footer>
      ) : (
        <Footer>
          <Row full>
            <Button
              data-testid="brc20-inscribe-done-button"
              text={t('done')}
              preset="primary"
              onClick={() => {
                onClickConfirm();
              }}
              full
            />
          </Row>
        </Footer>
      )}
    </Layout>
  );
}
