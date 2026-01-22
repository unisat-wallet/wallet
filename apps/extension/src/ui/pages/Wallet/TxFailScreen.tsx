import { Column, Content, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { colors } from '@/ui/theme/colors';
import { useTxFailScreenLogic } from '@unisat/wallet-state';

export default function TxFailScreen() {
  const { error, t, onClickBack } = useTxFailScreenLogic();

  return (
    <Layout>
      <Header onBack={onClickBack} />
      <Content>
        <Column justifyCenter mt="xxl" gap="xl">
          <Row justifyCenter>
            <Icon icon="delete" size={50} />
          </Row>

          <Text preset="title" text={t('payment_failed')} textCenter />
          <Text preset="sub" style={{ color: colors.red }} text={error} textCenter />
        </Column>
      </Content>
    </Layout>
  );
}
