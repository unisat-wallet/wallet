import { Card, Column, Content, Header, Layout, Text } from '@/ui/components';
import { useDeveloperMode, useDevice, useI18n, useNavigation } from '@unisat/wallet-state';

const isDevelopment = process.env.NODE_ENV === 'development';

export default function AddKeyringScreen() {
  const nav = useNavigation();
  const { t } = useI18n();
  const developerMode = useDeveloperMode();

  const { isExtensionInExpandView } = useDevice();

  return (
    <Layout>
      <Header onBack={() => nav.goBack()} title={t('create_a_new_wallet')} />
      <Content>
        <Column>
          <Text text={t('create_wallet')} preset="regular-bold" />

          <Card
            justifyCenter
            onClick={(e) => {
              nav.navigate('CreateHDWalletScreen', { isImport: false });
            }}
            data-testid="create-wallet-with-mnemonics-option">
            <Column full justifyCenter>
              <Text text={t('create_with_mnemonics_12words') || 'Create with mnemonics (12 or 24 words)'} size="sm" />
            </Column>
          </Card>

          <Text text={t('restore_wallet')} preset="regular-bold" mt="lg" />

          <Card
            justifyCenter
            onClick={(e) => {
              nav.navigate('CreateHDWalletScreen', { isImport: true });
            }}
            data-testid="restore-from-mnemonics-option">
            <Column full justifyCenter>
              <Text text={t('restore_from_mnemonics_12words24words')} size="sm" />
            </Column>
          </Card>

          <Card
            justifyCenter
            onClick={(e) => {
              nav.navigate('CreateSimpleWalletScreen');
            }}
            data-testid="restore-from-private-key-option">
            <Column full justifyCenter>
              <Text text={t('restore_from_single_private_key')} size="sm" />
            </Column>
          </Card>

          <Text text={t('connect_to_hardware_wallet')} preset="regular-bold" mt="lg" />

          <Card
            justifyCenter
            onClick={() => {
              if (isExtensionInExpandView) {
                nav.navigate('CreateKeystoneWalletScreen', {});
              } else {
                window.open('#/account/create-keystone-wallet');
              }
            }}
            data-testid="connect-hardware-wallet-option">
            <Column full justifyCenter>
              <Text text={t('keystone_wallet')} size="sm" />
            </Column>
          </Card>

          {developerMode && (
            <>
              <Text text={t('connect_to_readonly_wallet')} preset="regular-bold" mt="lg" />

              <Card
                justifyCenter
                onClick={() => {
                  nav.navigate('CreateReadonlyWalletScreen');
                }}>
                <Column full justifyCenter>
                  <Text text={t('readonly_wallet')} size="sm" />
                </Column>
              </Card>

              <Text text={t('cold_wallet')} preset="regular-bold" mt="lg" />

              <Card
                justifyCenter
                onClick={() => {
                  nav.navigate('CreateColdWalletScreen', {});
                }}>
                <Column full justifyCenter>
                  <Text text={t('create_cold_wallet')} size="sm" />
                </Column>
              </Card>
            </>
          )}

          {isDevelopment && (
            <>
              <Text text={t('watch_address_wallet')} preset="regular-bold" mt="lg" />

              <Card
                justifyCenter
                onClick={() => {
                  nav.navigate('CreateWatchWalletScreen');
                }}>
                <Column full justifyCenter>
                  <Text text={t('watch_address_wallet')} size="sm" />
                </Column>
              </Card>
            </>
          )}
        </Column>
      </Content>
    </Layout>
  );
}
