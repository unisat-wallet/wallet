import { Button, Card, Column, Content, Footer, Header, Layout, Row, Text } from '@/ui/components';
import ColdWalletSignPsbt from '@/ui/components/ColdWallet/ColdWalletSignPsbt';
import { ContractPopover } from '@/ui/components/ContractPopover';
import LoadingPage from '@/ui/components/LoadingPage';
import { PhishingDetection } from '@/ui/components/PhishingDetection';
import { SignPsbtWithRisksPopover } from '@/ui/components/SignPsbtWithRisksPopover';
import WebsiteBar from '@/ui/components/WebsiteBar';
import KeystoneSignScreen from '@/ui/pages/Wallet/KeystoneSignScreen';
import { KeystoneSignEnum } from '@unisat/keyring-service/types';
import { SignPsbtProps, useI18n, useSignPsbtLogic } from '@unisat/wallet-state';

import { fontSizes } from '@/ui/theme/font';
import VirtualList, { ListRef } from 'rc-virtual-list';
import { forwardRef, useEffect, useRef } from 'react';
import ActionOverviewSection from './components/ActionOverviewSection';
import AssetOverviewSection from './components/AssetOverviewSection';
import { InputsList } from './components/InputsList';
import MultiSignDisclaimerModal from './components/MultiSignDisclaimerModal';
import { OutputsList } from './components/OutputsList';
import PsbtDataSection from './components/PsbtDataSection';
import { SignPsbtSection } from './components/Section';
const ITEM_HEIGHT = 64 + 8; // item height + margin top

function TransactionItem(
  {
    index,
    title,
    buttonText,
    buttonPreset,
    onClick
  }: {
    index: number;
    title: string;
    buttonText: string;
    buttonPreset: string;
    onClick: () => void;
  },
  ref: any
) {
  const { t } = useI18n();
  return (
    <Card style={{ height: ITEM_HEIGHT - 8, marginTop: 8 }}>
      <Row justifyBetween fullX>
        <Column>
          <Text text={`${t('transaction')} ${index + 1}`} preset="bold" />
          <Text text={title} wrap />
        </Column>
        <Column>
          <Button
            preset={buttonPreset as any}
            textStyle={{ fontSize: fontSizes.sm }}
            text={buttonText}
            onClick={onClick}
            style={{ width: 80, height: 25 }}
          />
        </Column>
      </Row>
    </Card>
  );
}

export default function SignPsbt(props: SignPsbtProps) {
  const {
    showLoading,
    isPsbtRiskPopoverVisible,
    contractPopoverData,
    setContractPopoverData,

    t,
    brc20PriceMap,
    runesPriceMap,
    session,

    // data
    toSignDatas,
    currentToSignData,
    currentDecodedPsbt,

    // signing state
    isKeystoneSigning,
    isColdWalletSigning,
    showMultiSignView,

    disclaimerVisible,

    // state
    isAllSigned,
    signedCount,
    multiSignList,

    isValid,
    networkFee,
    hasRisk,
    showFeeSection,
    isScammer,
    allowQuickMultiSign,

    // actions
    onClickBack,
    onClickSign,
    onQuickMultiSign,
    onTryMultiSign,

    onKeystoneSigningSuccess,
    onKeystoneSigningBack,

    onColdWalletSigningSuccess,
    onColdWalletSigningBack,

    onRiskPopoverConfirm,
    onRiskPopoverClose,

    onDisclaimerModalClose
  } = useSignPsbtLogic(props as any);
  let header = props.header;

  const isValidData = isValid && currentDecodedPsbt;

  const ForwardTransactionItem = forwardRef(TransactionItem);
  const refList = useRef<ListRef>(null);
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (refList.current && signedCount >= 1) {
        refList.current?.scrollTo({ index: signedCount - 1, align: 'top' });
      }
    });

    return () => clearTimeout(timeoutId);
  }, [signedCount]);

  if (!header && session) {
    header = (
      <Header>
        <WebsiteBar session={session} />
      </Header>
    );
  }

  // condition render
  if (showLoading) {
    return <LoadingPage />;
  }

  if (isScammer) {
    return <PhishingDetection handleCancel={onClickBack} />;
  }

  if (isKeystoneSigning && currentToSignData) {
    return (
      <KeystoneSignScreen
        type={KeystoneSignEnum.PSBT}
        data={currentToSignData.psbtHex}
        isFinalize={currentToSignData.autoFinalized !== false}
        onSuccess={onKeystoneSigningSuccess}
        onBack={onKeystoneSigningBack}
      />
    );
  }

  // cold-wallet signing
  if (isColdWalletSigning && currentToSignData) {
    return (
      <ColdWalletSignPsbt
        psbtHex={currentToSignData.psbtHex}
        onSuccess={onColdWalletSigningSuccess}
        onCancel={onColdWalletSigningBack}
        header={header}
      />
    );
  }

  if (showMultiSignView) {
    const layoutHeight = Math.ceil((window.innerHeight - 64) / ITEM_HEIGHT) * ITEM_HEIGHT;

    return (
      <Layout>
        {header}
        <Content>
          <Text text={t('sign_multiple_transactions')} preset="title-bold" textCenter mt="lg" />
          <VirtualList
            data={multiSignList}
            data-id="list"
            height={layoutHeight}
            itemHeight={ITEM_HEIGHT}
            itemKey={(item) => 'psbt_' + item.index}
            ref={refList}>
            {(item, index) => (
              <ForwardTransactionItem
                title={item.title}
                buttonText={item.buttonText}
                buttonPreset={item.buttonPreset}
                onClick={item.onClick}
                index={index}
              />
            )}
          </VirtualList>
        </Content>

        <Footer>
          <Row full>
            <Button preset="default" text={t('reject_all')} onClick={onClickBack} full />

            {allowQuickMultiSign ? (
              <Button
                preset="primary"
                text={isAllSigned ? t('submit') : `(${signedCount}/${toSignDatas.length}) ${t('signed')}`}
                icon={isAllSigned ? undefined : 'alert'}
                onClick={onTryMultiSign}
                full
              />
            ) : (
              <Button
                preset="primary"
                text={isAllSigned ? t('submit') : `(${signedCount}/${toSignDatas.length}) ${t('signed')}`}
                onClick={onClickSign}
                full
                disabled={isAllSigned == false}
              />
            )}
          </Row>
        </Footer>

        {disclaimerVisible && (
          <MultiSignDisclaimerModal
            txCount={toSignDatas.length}
            onContinue={onQuickMultiSign}
            onClose={onDisclaimerModalClose}
          />
        )}
      </Layout>
    );
  }

  return (
    <Layout>
      {header}
      <Content>
        <Column gap="xl">
          <ActionOverviewSection decodedPsbt={currentDecodedPsbt} action={currentToSignData.action!} />

          <AssetOverviewSection
            decodedPsbt={currentDecodedPsbt}
            runesPriceMap={runesPriceMap}
            brc20PriceMap={brc20PriceMap}
            networkFee={networkFee}
          />
          <SignPsbtSection title={t('transaction_details')}>
            {isValidData && (
              <Column gap="md" mt="zero">
                <InputsList
                  decodedPsbt={currentDecodedPsbt}
                  toSignData={currentToSignData}
                  runesPriceMap={runesPriceMap}
                  setContractPopoverData={setContractPopoverData}
                />

                <OutputsList
                  decodedPsbt={currentDecodedPsbt}
                  runesPriceMap={runesPriceMap}
                  setContractPopoverData={setContractPopoverData}
                />
              </Column>
            )}
          </SignPsbtSection>

          {/* PSBT data */}
          <PsbtDataSection toSignData={currentToSignData} />
        </Column>
      </Content>

      {/* footer buttons */}
      <Footer>
        <Row full>
          <Button preset="default" text={t('reject')} onClick={onClickBack} full />
          <Button
            preset="primary"
            icon={hasRisk ? 'risk' : undefined}
            text={t('sign')}
            onClick={onClickSign}
            disabled={!isValid}
            full
            data-testid="sign-psbt-button"
          />
        </Row>
      </Footer>

      {/* popup component */}
      {isPsbtRiskPopoverVisible && (
        <SignPsbtWithRisksPopover
          decodedPsbt={currentDecodedPsbt}
          onClose={onRiskPopoverClose}
          onConfirm={onRiskPopoverConfirm}
        />
      )}

      {contractPopoverData && (
        <ContractPopover contract={contractPopoverData} onClose={() => setContractPopoverData(undefined)} />
      )}
    </Layout>
  );
}
