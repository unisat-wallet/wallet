import { Button, Content, Header, Input, Layout } from '@/ui/components';
import { useEditAccountNameScreenLogic } from '@unisat/wallet-state';
import { MAX_ALIAS_NAME_LENGTH } from '@unisat/wallet-shared';

export default function EditAccountNameScreen() {
  const { onInputChange, onClickBack, handleOnClick, handleOnKeyUp, isValidName, truncatedTitle, account, t } =
    useEditAccountNameScreenLogic();
  return (
    <Layout>
      <div style={{ position: 'relative' }}>
        <Header onBack={onClickBack} title={truncatedTitle} />
      </div>
      <Content>
        <Input
          placeholder={account.alianName}
          defaultValue={account.alianName}
          onChange={onInputChange}
          onKeyUp={handleOnKeyUp}
          autoFocus={true}
          maxLength={MAX_ALIAS_NAME_LENGTH}
          data-testid="edit-account-name-input"
        />
        <Button
          disabled={!isValidName}
          text={t('change_account_name')}
          preset="primary"
          onClick={handleOnClick}
          data-testid="edit-account-name-confirm-button"
        />
      </Content>
    </Layout>
  );
}
