import { IMAGE_SOURCE_MAP } from '@/shared/constant';
import { Button, Column, Content, Header, Image, Input, Layout, Row, Text, TransferAmountCard, TransferAmountSection, TransferAmountUnavailableRow } from '@/ui/components';
import { BtcUsd } from '@/ui/components/BtcUsd';
import { FeeRateBar } from '@/ui/components/FeeRateBar';
import { RBFBar } from '@/ui/components/RBFBar';
import { useNavigation, useTxCreateScreenLogic } from '@unisat/wallet-state';

export default function TxCreateScreen() {
  const nav = useNavigation();
  const {
    headerTitle,
    chain,

    toInfo,
    onAddressInputChange,

    toSatoshis,
    inputAmount,
    onAmountInputChange,
    onAmountMaxClick,
    enableRBF,
    onRBFChange,

    showUnavailable,
    availableAmount,
    unavailableAmount,
    unavailableTipText,
    btcUnit,
    t,

    walletConfig,

    error,
    disabled,

    onClickNext
  } = useTxCreateScreenLogic();

  return (
    <Layout>
      <Header
        onBack={() => {
          window.history.go(-1);
        }}
        title={headerTitle}
      />
      <Content style={{ padding: '0px 16px 24px' }}>
        <Column>
          <Row justifyCenter>
            <Image src={IMAGE_SOURCE_MAP[chain.icon]} size={50} />
          </Row>

          <Column mt="lg">
            <Input
              preset="address"
              addressInputData={toInfo}
              onAddressInputChange={onAddressInputChange}
              autoFocus={true}
              networkType={chain.enum}
              data-testid="recipient-address-input"
            />
          </Column>

          <Column mt="lg">
            <TransferAmountSection titleExtra={<BtcUsd sats={toSatoshis} />}>
              <TransferAmountCard
                amount={inputAmount}
                onAmountChange={onAmountInputChange}
                showMax
                onMaxClick={onAmountMaxClick}
                availableAmount={availableAmount}
                unit={btcUnit}
                inputTestId="transfer-amount-input"
                footer={
                  showUnavailable ? (
                    <TransferAmountUnavailableRow
                      amount={unavailableAmount}
                      unit={btcUnit}
                      tipText={unavailableTipText}
                      showUnlock={!walletConfig.disableUtxoTools}
                      onUnlock={() => {
                        nav.navToUtxoTools();
                      }}
                    />
                  ) : null
                }
              />
            </TransferAmountSection>
          </Column>

          <Column mt="lg">
            <FeeRateBar />
          </Column>
          <Column mt="lg">
            <RBFBar value={enableRBF} onChange={onRBFChange} />
          </Column>

          {error && <Text data-testid="tx-create-error" text={error} color="error" />}

          <Button
            disabled={disabled}
            preset="primary"
            text={t('next')}
            onClick={onClickNext}
            data-testid="tx-next-button"></Button>
        </Column>
      </Content>
    </Layout>
  );
}
