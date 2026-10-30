import { Button, Column, Content, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { spacing } from '@/ui/theme/spacing';
import { useChain, useTxSuccessScreenLogic } from '@unisat/wallet-state';

const TEXT_COLOR = 'rgba(255, 255, 255, 0.85)';

const footerButtonStyle = {
  minHeight: 48,
  height: 48,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.45)'
};

const footerButtonTextStyle = {
  fontSize: 15,
  fontWeight: 500,
  lineHeight: '16px',
  color: TEXT_COLOR
};

export default function TxSuccessScreen() {
  const { onClickExploreTx, onClickDone, t } = useTxSuccessScreenLogic();
  const chain = useChain();

  return (
    <Layout>
      <Header />

      <Content data-testid="tx-success-screen" style={{ gap: spacing.small }}>
        <Column justifyCenter mt="xxl" gap="xl">
          <Row justifyCenter>
            <Icon icon="success" size={72} style={{ alignSelf: 'center' }} />
          </Row>

          <Column gap="md">
            <Text preset="title" text={t('tx_sent_title')} textCenter style={{ color: TEXT_COLOR }} />
            <Text preset="sub" text={t('tx_sent_desc')} textCenter style={{ color: 'rgba(255, 255, 255, 0.65)' }} />
          </Column>
        </Column>
      </Content>
      <Footer>
        <Row full style={{ gap: 14 }}>
          <Button
            full
            preset="default"
            text={t(chain.unisatExplorerUrl ? 'view_on_uniscan' : 'view_on_explorer')}
            onClick={onClickExploreTx}
            style={footerButtonStyle}
            textStyle={footerButtonTextStyle}
          />
          <Button
            full
            preset="default"
            text={t('done')}
            onClick={onClickDone}
            data-testid="tx-success-done-button"
            style={footerButtonStyle}
            textStyle={footerButtonTextStyle}
          />
        </Row>
      </Footer>
    </Layout>
  );
}
