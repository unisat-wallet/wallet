import { Button, Column, Content, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { spacing } from '@/ui/theme/spacing';
import { useRGBSendCompleteScreenLogic } from '@unisat/wallet-state';

export default function RGBSendCompleteScreen() {
  const { txid, onClickExploreTx, onClickDone, t } = useRGBSendCompleteScreenLogic();

  return (
    <Layout>
      <Header />
      <Content style={{ gap: spacing.small }}>
        <Column justifyCenter mt="xxl" gap="xl">
          <Row justifyCenter>
            <Icon icon="success" size={50} style={{ alignSelf: 'center' }} />
          </Row>

          <Text preset="title" text={t('rgb_sent')} textCenter />
          <Text preset="sub" text={t('rgb_transfer_submitted')} color="textDim" textCenter />

          {txid ? (
            <Row justifyCenter itemsCenter onClick={onClickExploreTx}>
              <Icon icon="eye" color="textDim" />
              <Text preset="regular-bold" text={t('view_on_block_explorer')} color="textDim" />
            </Row>
          ) : null}
        </Column>
      </Content>
      <Footer>
        <Button full text={t('done')} onClick={onClickDone} data-testid="rgb-send-complete-done-button" />
      </Footer>
    </Layout>
  );
}
