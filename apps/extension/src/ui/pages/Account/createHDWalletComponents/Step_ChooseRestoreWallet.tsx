import { Button, Column, Row, Text } from '@/ui/components';
import { ContextData, UpdateContextDataParams } from '@/ui/pages/Account/createHDWalletComponents/types';
import { colors } from '@/ui/theme/colors';
import { RESTORE_WALLETS } from '@unisat/wallet-shared';
import { useI18n } from '@unisat/wallet-state';

import { getRestoreWalletSwitchState } from './restoreWalletPolicy';

export function Step_ChooseRestoreWallet({
  contextData,
  updateContextData
}: {
  contextData: ContextData;
  updateContextData: (params: UpdateContextDataParams) => void;
}) {
  const { t } = useI18n();
  return (
    <Column gap="lg" data-testid="create-hd-wallet-step-0">
      <Text
        text={t('choose_a_wallet_you_want_to_restore_from')}
        preset="title"
        color="textDim"
        style={{ fontSize: 13 }}
      />
      {RESTORE_WALLETS.map((item, index) => {
        return (
          <Row key={item.value}>
            <Button
              preset="default"
              mt="sm"
              style={{
                flex: 1,
                minHeight: 55,
                justifyContent: 'flex-start',
                padding: 15,
                borderRadius: 10,
                borderWidth: 1,
                backgroundColor: colors.black_dark,
                borderColor: colors.white_light2
              }}
              onClick={() => {
                updateContextData(getRestoreWalletSwitchState(item.value, contextData.wordsType));
              }}
              data-testid={`restore-wallet-type-option-${index}`}
            >
              <Text text={item.i18nKey ? t(item.i18nKey) : item.name} />
            </Button>
          </Row>
        );
      })}
    </Column>
  );
}
