import { useEffect, useState } from 'react';

import {
  useChain,
  useCurrentAccount,
  useFeeRateBar,
  useFetchUtxosCallback,
  useI18n,
  useNavigation,
  usePrepareSendBTCCallback,
  useSafeBalance,
  useUtxos,
  useWallet
} from '@unisat/wallet-state';

import { amountToSatoshis } from '@/ui/utils';
import { useTools } from '@unisat/wallet-state';
import { Button } from '../Button';
import { Column } from '../Column';
import { FeeRateBar } from '../FeeRateBar';
import { Popover } from '../Popover';
import { RBFBar } from '../RBFBar';
import { Row } from '../Row';
import { Text } from '../Text';

export const MergeBTCPopover = ({ onClose }: { onClose: () => void }) => {
  const prepareSendBTC = usePrepareSendBTCCallback();
  const { t } = useI18n();

  const currentAccount = useCurrentAccount();

  const fetchUtxos = useFetchUtxosCallback();

  const tools = useTools();

  const safeBalance = useSafeBalance();

  const safeUTXOs = useUtxos();
  useEffect(() => {
    tools.showLoading(true);
    fetchUtxos().finally(() => {
      tools.showLoading(false);
    });
  }, []);

  const { feeRate } = useFeeRateBar();
  const isFeeRateValid = Number.isFinite(feeRate) && feeRate > 0;
  const [enableRBF, setEnableRBF] = useState(true);
  const wallet = useWallet();

  useEffect(() => {
    wallet.getEnableRBF().then(enableRBF => {
      setEnableRBF(enableRBF);
    });
  }, [wallet]);

  const onEnableRBFChange = (value: boolean) => {
    setEnableRBF(value);
    wallet.setEnableRBF(value);
  };

  const chain = useChain();
  const nav = useNavigation();
  const onConfirm = async () => {
    if (!isFeeRateValid) return;

    try {
      const toSignData = await prepareSendBTC({
        toAddressInfo: {
          address: currentAccount.address
        },
        toAmount: amountToSatoshis(safeBalance),
        feeRate,
        enableRBF
      });

      nav.navigate('TxConfirmScreen', { toSignData });
    } catch (e) {
      tools.toastError(t('merge_utxos_failed'));
      console.error('Merge UTXOs failed:', e);
    }
  };
  return (
    <Popover onClose={onClose}>
      <Column justifyCenter itemsCenter>
        <Column mt="lg">
          <Text preset="bold" text={`${t('merge_utxos1')} ${chain.unit} UTXOs`} textCenter />
        </Column>

        <Column style={{ marginTop: 8 }} mx="md">
          <Text
            preset="regular"
            text={`${t('your_balance_have_to_be_merged')} ${chain.unit} ${t(
              'this_process_will_merge_your_utxos_into_one'
            )}`}
          />
          <Text preset="regular" text={`${t('merging_utxos')}: ${safeUTXOs.length}`} />
          <Text preset="regular" text={`${t('merging_amount')}: ${safeBalance} ${chain.unit} `} />
        </Column>

        <FeeRateBar />
        <RBFBar value={enableRBF} onChange={onEnableRBFChange} />

        <Row full mt="lg">
          <Button
            text={t('cancel')}
            full
            onClick={(e) => {
              if (onClose) {
                onClose();
              }
            }}
          />

          <Button
            text={t('confirm')}
            disabled={!isFeeRateValid}
            full
            preset="primary"
            onClick={(e) => {
              onConfirm();
            }}
          />
        </Row>
      </Column>
    </Popover>
  );
};
