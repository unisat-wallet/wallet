import { useMemo } from 'react';

import { shortAddress } from '@/ui/utils';
import { faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { WalletKeyring } from '@unisat/wallet-shared';
import {
  accountActions,
  keyringsActions,
  useAppDispatch,
  useI18n,
  useNavigation,
  useWallet
} from '@unisat/wallet-state';

import { Button } from '../Button';
import { Card } from '../Card';
import { Column } from '../Column';
import { Popover } from '../Popover';
import { Row } from '../Row';
import { Text } from '../Text';

export const RemoveWalletPopover = ({ keyring, onClose }: { keyring: WalletKeyring; onClose: () => void }) => {
  const wallet = useWallet();
  const nav = useNavigation();
  const dispatch = useAppDispatch();
  const displayAddress = useMemo(() => {
    if (!keyring.accounts[0]) {
      return 'Invalid';
    }
    const address = keyring.accounts[0].address;
    return shortAddress(address);
  }, []);
  const { t } = useI18n();

  return (
    <Popover onClose={onClose}>
      <Column justifyCenter itemsCenter>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: '1.5rem',
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'row',
            backgroundColor: '#CC3333',
            justifyContent: 'center'
          }}>
          <FontAwesomeIcon icon={faTrashCan} style={{ height: '1rem' }} />
        </div>

        <Card preset="style2" style={{ width: 200 }}>
          <Column>
            <Text text={keyring.alianName} textCenter />
            <Text text={displayAddress} preset="sub" textCenter />
          </Column>
        </Card>
        <Text text={t('please_pay_attention_to_whether_you_have_backed_up')} textCenter />

        <Text text={t('this_action_is_not_reversible')} color="danger" />
        <Row full>
          <Button
            text={t('cancel')}
            full
            data-testid="remove-wallet-cancel-button"
            onClick={(e) => {
              if (onClose) {
                onClose();
              }
            }}
          />
          <Button
            text={t('remove')}
            preset="danger"
            full
            data-testid="remove-wallet-confirm-button"
            onClick={async () => {
              const nextKeyring = await wallet.removeKeyring(keyring);
              const keyrings = await wallet.getKeyrings();
              dispatch(keyringsActions.setKeyrings(keyrings));

              if (nextKeyring) {
                dispatch(accountActions.setCurrent(nextKeyring.accounts[0]));
                return;
              }

              if (keyrings[0]) {
                dispatch(keyringsActions.setCurrent(keyrings[0]));
                return;
              }

              nav.navigate('WelcomeScreen');
            }}
          />
        </Row>
      </Column>
    </Popover>
  );
};
