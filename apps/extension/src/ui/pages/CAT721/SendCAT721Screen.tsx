import { Button, Column, Content, Header, Input, Layout, Row, Text } from '@/ui/components';
import CAT721Preview from '@/ui/components/CAT721Preview';
import { FeeRateBar } from '@/ui/components/FeeRateBar';
import { MergeBTCPopover } from '@/ui/components/MergeBTCPopover';
import { SendCAT721ScreenStep, useSendCAT721ScreenLogic } from '@unisat/wallet-state';

import { Loading } from '@/ui/components/ActionComponent/Loading';
import { SignPsbt } from '../Approval/components';

export default function SendCAT721Screen() {
  const {
    // info
    version,
    localId,
    collectionInfo,
    toInfo,
    setToInfo,
    error,
    disabled,
    step,
    showMergeBTCUTXOPopover,
    setShowMergeBTCUTXOPopover,

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

    // tools
    t
  } = useSendCAT721ScreenLogic();

  if (step == SendCAT721ScreenStep.SIGN_COMMIT) {
    return (
      <SignPsbt
        header={<Header title={t('step_12')} onBack={onSignCommitPsbtHandleBack} />}
        params={signCommitPsbtParams}
        handleCancel={onSignCommitPsbtHandleCancel}
        handleConfirm={onSignCommitPsbtHandleConfirm}
      />
    );
  } else if (step == SendCAT721ScreenStep.WAITING) {
    return <Loading />;
  } else if (step == SendCAT721ScreenStep.SIGN_REVEAL) {
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
      <Header onBack={onClickBack} title={t('send_cat721')} />
      <Content>
        <Text text={collectionInfo.name} preset="title-bold" textCenter size="xxl" color="gold" />

        <Row justifyCenter>
          <CAT721Preview
            version={version}
            preset="medium"
            collectionId={collectionInfo.collectionId}
            contentType={collectionInfo.contentType}
            localId={localId}
          />
        </Row>

        <Column mt="lg">
          <Input
            preset="address"
            addressInputData={toInfo}
            onAddressInputChange={(val) => {
              setToInfo(val);
            }}
            autoFocus={true}
            recipientLabel={<Text text={t('recipient')} preset="regular" color="textDim" />}
          />
        </Column>

        <Column mt="lg">
          <FeeRateBar />
        </Column>

        {error && <Text text={error} color="error" />}

        <Button disabled={disabled} preset="primary" text={t('next')} onClick={onClickNext} />

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
