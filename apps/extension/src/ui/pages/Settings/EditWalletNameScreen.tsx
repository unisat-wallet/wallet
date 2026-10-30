import { Button, Content, Header, Input, Layout } from '@/ui/components';
import { useEditWalletNameScreenLogic } from '@unisat/wallet-state';
import { MAX_ALIAS_NAME_LENGTH } from '@unisat/wallet-shared';

export default function EditWalletNameScreen() {
  const { truncatedTitle, keyring, isValidName, handleOnClick, handleOnKeyUp, onInputChange, t } =
    useEditWalletNameScreenLogic();

  return (
    <Layout>
      <div style={{ position: 'relative' }}>
        <Header
          onBack={() => {
            window.history.go(-1);
          }}
          title={truncatedTitle}
        />
      </div>
      <Content>
        <Input
          placeholder={keyring.alianName}
          defaultValue={keyring.alianName}
          onChange={(e) => onInputChange(e)}
          onKeyUp={(e) => handleOnKeyUp(e)}
          autoFocus={true}
          maxLength={MAX_ALIAS_NAME_LENGTH}
          data-testid="edit-wallet-name-input"
        />
        <Button
          disabled={!isValidName}
          text={t('change_wallet_name')}
          preset="primary"
          data-testid="edit-wallet-name-confirm-button"
          onClick={(e) => handleOnClick()}
        />
      </Content>
    </Layout>
  );
}
