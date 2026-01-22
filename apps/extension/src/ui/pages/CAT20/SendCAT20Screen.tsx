import { Button, Column, Content, Header, Input, Layout, Loading, Row, Text } from '@/ui/components';
import { BRC20Ticker } from '@/ui/components/BRC20Ticker';
import { FeeRateBar } from '@/ui/components/FeeRateBar';
import { MergeBTCPopover } from '@/ui/components/MergeBTCPopover';
import { TickUsdWithoutPrice, TokenType } from '@/ui/components/TickUsd';
import { colors } from '@/ui/theme/colors';
import { showLongNumber } from '@/ui/utils';
import { bnUtils } from '@unisat/base-utils';
import { SendCAT20ScreenStep, useSendCAT20ScreenLogic } from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';

export default function SendCAT20Screen() {
  const {
    // info
    cat20Info,
    cat20Balance,
    availableTokenAmount,
    toInfo,
    setToInfo,
    inputAmount,
    setInputAmount,
    error,
    disabled,
    step,
    showMergeBTCUTXOPopover,
    setShowMergeBTCUTXOPopover,
    shouldShowMerge,

    // actions
    onClickNext,
    onClickBack,

    // sign commit psbt actions
    onSignCommitPsbtHandleConfirm,
    onSignCommitPsbtHandleCancel,
    onSignCommitPsbtHandleBack,
    signCommitPsbtParams,

    // sign reveal psbt actions
    onSignRevealPsbtHandleConfirm,
    onSignRevealPsbtHandleCancel,
    onSignRevealPsbtHandleBack,
    signRevealPsbtParams,

    // merge UTXO action
    onClickMergeUTXO,

    // tools
    t
  } = useSendCAT20ScreenLogic();

  if (step == SendCAT20ScreenStep.SIGN_COMMIT) {
    return (
      <SignPsbt
        header={<Header title={t('step_12')} onBack={onSignCommitPsbtHandleBack} />}
        params={signCommitPsbtParams}
        handleCancel={onSignCommitPsbtHandleCancel}
        handleConfirm={onSignCommitPsbtHandleConfirm}
      />
    );
  } else if (step == SendCAT20ScreenStep.WAITING) {
    return <Loading />;
  } else if (step == SendCAT20ScreenStep.SIGN_REVEAL) {
    return (
      <SignPsbt
        header={<Header title={t('step_22')} onBack={onSignRevealPsbtHandleBack} />}
        params={signRevealPsbtParams}
        handleCancel={onSignRevealPsbtHandleCancel}
        handleConfirm={onSignRevealPsbtHandleConfirm}
      />
    );
  }

  return (
    <Layout>
      <Header onBack={onClickBack} title={t('send_cat20')} />
      <Content>
        <Text text={cat20Info.name} preset="title-bold" textCenter size="xxl" color="gold" />
        <Row itemsCenter fullX justifyCenter>
          <Text
            text={`${bnUtils.toDecimalAmount(cat20Balance.amount, cat20Balance.decimals)}`}
            preset="bold"
            textCenter
            size="xxl"
            wrap
            digital
          />
          <BRC20Ticker tick={cat20Info.symbol} preset="lg" />
        </Row>

        <Row justifyCenter fullX>
          <TickUsdWithoutPrice
            tick={cat20Info.tokenId}
            balance={bnUtils.toDecimalAmount(cat20Balance.amount, cat20Balance.decimals)}
            type={TokenType.CAT20}
            size={'md'}
          />
        </Row>

        <Column mt="lg">
          <Input
            preset="address"
            addressInputData={toInfo}
            onAddressInputChange={(val) => {
              setToInfo(val);
            }}
            recipientLabel={<Text text={t('recipient')} preset="regular" color="textDim" />}
            autoFocus={true}
          />
        </Column>

        <Column mt="lg">
          <Row justifyBetween>
            <Text text={t('balance')} color="textDim" />
            <TickUsdWithoutPrice tick={cat20Info.tokenId} balance={inputAmount} type={TokenType.CAT20} />
            <Row
              itemsCenter
              onClick={() => {
                setInputAmount(bnUtils.toDecimalAmount(availableTokenAmount, cat20Balance.decimals));
              }}>
              <Text text={t('max')} preset="sub" style={{ color: colors.white_muted }} />
              <Text
                text={`${showLongNumber(bnUtils.toDecimalAmount(availableTokenAmount, cat20Balance.decimals))}`}
                preset="bold"
                size="sm"
                wrap
              />
              <BRC20Ticker tick={cat20Info.symbol} preset="sm" />
            </Row>
          </Row>
          <Input
            preset="amount"
            placeholder={t('amount')}
            value={inputAmount.toString()}
            runesDecimal={cat20Balance.decimals}
            onAmountInputChange={(amount) => {
              setInputAmount(amount);
            }}
          />

          {shouldShowMerge && (
            <Column style={{ borderWidth: 1, borderRadius: 10, borderColor: 'rgba(255,255,255,0.3)' }}>
              <Column mx="md" my="md">
                <Text
                  text={t('to_send_a_larger_amount_please_merge_your_utxos_to_increase_the_available_balance')}
                  size="xs"
                  color="textDim"
                />

                <Text
                  text={t('merge_utxos_to_increase_the_available_balance')}
                  size="xs"
                  color="gold"
                  onClick={onClickMergeUTXO}
                />
              </Column>
            </Column>
          )}
        </Column>

        <Column mt="lg">
          <FeeRateBar />
        </Column>

        {error && <Text text={error} color="error" />}

        <Button disabled={disabled} preset="primary" text={t('next')} onClick={onClickNext}></Button>

        {showMergeBTCUTXOPopover && (
          <MergeBTCPopover
            onClose={() => {
              setShowMergeBTCUTXOPopover(false);
            }}
          />
        )}
      </Content>
    </Layout>
  );
}
