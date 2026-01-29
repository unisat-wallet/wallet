import { Button, Column, Content, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { spacing } from '@/ui/theme/spacing';
import { useTxSuccessScreenLogic } from '@unisat/wallet-state';

export default function TxSuccessScreen() {
  const { onClickExploreTx, onClickDone, t } = useTxSuccessScreenLogic();

  return (
    <Layout>
      <Header />

      <Content style={{ gap: spacing.small }}>
        <Column justifyCenter mt="xxl" gap="xl">
          <Row justifyCenter>
            <Icon icon="success" size={50} style={{ alignSelf: 'center' }} />
          </Row>

          <Text preset="title" text={t('tx_sent_title')} textCenter />
          <Text preset="sub" text={t('tx_sent_desc')} color="textDim" textCenter />

          <Row justifyCenter onClick={onClickExploreTx}>
            <Icon icon="eye" color="textDim" />
            <Text preset="regular-bold" text={t('view_on_block_explorer')} color="textDim" />
          </Row>
        </Column>
      </Content>
      <Footer>
        <Button full text={t('done')} onClick={onClickDone} data-testid="tx-success-done-button" />
      </Footer>
    </Layout>
  );
}
