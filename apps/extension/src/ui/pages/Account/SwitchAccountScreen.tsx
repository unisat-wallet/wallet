import VirtualList from 'rc-virtual-list';
import { forwardRef, useMemo, useState } from 'react';

import { Card, Column, Content, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { colors } from '@/ui/theme/colors';
import { copyToClipboard, shortAddress } from '@/ui/utils';
import { CopyOutlined, EditOutlined, EllipsisOutlined, KeyOutlined, PlusCircleOutlined } from '@ant-design/icons';
import { KeyringType } from '@unisat/keyring-service/types';
import { Account, getAccountDerivationPath } from '@unisat/wallet-shared';
import {
  accountActions,
  useAppDispatch,
  useCurrentAccount,
  useCurrentKeyring,
  useI18n,
  useNavigation,
  useTools,
  useWallet
} from '@unisat/wallet-state';

import { useNavigate } from '../MainRoute';

export interface ItemData {
  key: string;
  account?: Account;
}

interface MyItemProps {
  account?: Account;
  autoNav?: boolean;
}
const ITEM_HEIGHT = 64;
const PRIVATE_KEY_EXPORTABLE_ACCOUNT_TYPES = [KeyringType.HdKeyring, KeyringType.SimpleKeyring];
const ACCOUNT_CREATABLE_KEYRING_TYPES = [KeyringType.HdKeyring, KeyringType.KeystoneKeyring];
const DERIVED_PATH_VISIBLE_KEYRING_TYPES = [KeyringType.HdKeyring, KeyringType.KeystoneKeyring];

export function MyItem({ account, autoNav }: MyItemProps, ref) {
  const navigate = useNavigate();
  const currentAccount = useCurrentAccount();
  const selected = currentAccount.pubkey == account?.pubkey;
  const wallet = useWallet();
  const dispatch = useAppDispatch();
  const keyring = useCurrentKeyring();
  const { t } = useI18n();
  if (!account) {
    return <div style={{ height: ITEM_HEIGHT }} />;
  }
  const [optionsVisible, setOptionsVisible] = useState(false);
  const canExportPrivateKey = PRIVATE_KEY_EXPORTABLE_ACCOUNT_TYPES.includes(account.type as KeyringType);
  let path = '';
  if (DERIVED_PATH_VISIBLE_KEYRING_TYPES.includes(keyring.type as KeyringType)) {
    path = ` (${getAccountDerivationPath(keyring.hdPath, account.index ?? 0, keyring.accountIndexDerivation)})`;
  }

  const tools = useTools();

  return (
    <Card
      justifyBetween
      style={{
        height: ITEM_HEIGHT - 8,
        marginTop: 8,
        borderColor: 'rgba(244,182,44,0.5)',
        borderWidth: selected ? 1 : 0,
        backgroundColor: selected ? 'rgba(244,182,44,0.1)' : colors.black_dark,
        marginLeft: 10,
        marginRight: 10
      }}
      data-testid={`account-item-${account.address}`}
    >
      <Row>
        <Column style={{ width: 20 }} selfItemsCenter>
          {selected ? <Icon icon="circle-check" color="gold" /> : <Icon icon="circle-check" color="white_muted2" />}
        </Column>
        <Column
          onClick={async (e) => {
            if (currentAccount.pubkey !== account.pubkey) {
              await wallet.changeKeyring(keyring, account.index);
              const _currentAccount = await wallet.getCurrentAccount();
              dispatch(accountActions.setCurrent(_currentAccount));
            }
            if (autoNav) navigate('MainScreen');
          }}
          style={{ height: 40 }}
        >
          <Text text={shortAddress(account.alianName, 8)} ellipsis />
          <Text text={`${shortAddress(account.address)}${path}`} preset="sub" />
        </Column>
      </Row>
      <Column relative>
        {optionsVisible && (
          <div
            style={{
              position: 'fixed',
              zIndex: 10,
              left: 0,
              right: 0,
              top: 0,
              bottom: 0
            }}
            onTouchStart={(e) => {
              setOptionsVisible(false);
            }}
            onMouseDown={(e) => {
              setOptionsVisible(false);
            }}
          ></div>
        )}

        <Icon
          onClick={async (e) => {
            setOptionsVisible(!optionsVisible);
          }}
        >
          <EllipsisOutlined />
        </Icon>

        {optionsVisible && (
          <Column
            style={{
              backgroundColor: colors.black,
              width: 160,
              position: 'absolute',
              right: 0,
              padding: 5,
              zIndex: 10
            }}
          >
            <Row
              onClick={() => {
                navigate('EditAccountNameScreen', { account });
              }}
            >
              <EditOutlined />
              <Text text={t('edit_name')} size="sm" />
            </Row>
            <Row
              onClick={() => {
                copyToClipboard(account.address);
                tools.toastSuccess(t('copied'));
                setOptionsVisible(false);
              }}
            >
              <CopyOutlined />
              <Text text={t('copy_address')} size="sm" />
            </Row>
            {/* <Row
              onClick={() => {
                copyToClipboard(account.pubkey);
                tools.toastSuccess(t('copied'));
                setOptionsVisible(false);
              }}>
              <CopyOutlined />
              <Text text={t('copy_publickey')} size="sm" />
            </Row> */}
            {canExportPrivateKey && (
              <Row
                onClick={() => {
                  navigate('ExportPrivateKeyScreen', { account });
                }}
              >
                <KeyOutlined />
                <Text text={t('export_private_key')} size="sm" />
              </Row>
            )}
          </Column>
        )}
      </Column>
    </Card>
  );
}

export default function SwitchAccountScreen() {
  const nav = useNavigation();
  const keyring = useCurrentKeyring();
  const { t } = useI18n();
  const items = useMemo(() => {
    const _items: ItemData[] = keyring.accounts.map((v) => {
      return {
        key: v.address,
        account: v
      };
    });
    for (let i = 0; i < 2; i++) {
      _items.push({
        key: 'dummy_' + i,
        account: undefined
      });
    }

    return _items;
  }, [keyring.accounts]);

  const ForwardMyItem = forwardRef(MyItem);
  const layoutHeight = Math.ceil((window.innerHeight - 64) / ITEM_HEIGHT) * ITEM_HEIGHT;
  // No auto scrollTo — avoids rc-virtual-list "max limitation" warning.
  const canCreateAccount = ACCOUNT_CREATABLE_KEYRING_TYPES.includes(keyring.type as KeyringType);

  return (
    <Layout>
      <Header
        onBack={() => {
          window.history.go(-1);
        }}
        title={t('switch_account')}
        RightComponent={
          canCreateAccount ? (
            <Icon
              onClick={() => {
                nav.navigate('CreateAccountScreen', {});
              }}
              data-testid="add-account-button"
            >
              <PlusCircleOutlined />
            </Icon>
          ) : null
        }
      />
      <Content style={{ padding: 5 }}>
        <VirtualList
          data={items}
          data-id="list"
          height={layoutHeight}
          itemHeight={ITEM_HEIGHT}
          itemKey={(item) => item.key}
        >
          {(item, index) => <ForwardMyItem account={item.account} autoNav={true} />}
        </VirtualList>
      </Content>
    </Layout>
  );
}
