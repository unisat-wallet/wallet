import { useMemo, useState } from 'react';

import { Column, Row } from '@/ui/components';
import { Button, ButtonProps } from '@/ui/components/Button';
import { BuyBTCModal } from '@/ui/pages/BuyBTC/BuyBTCModal';
import { TypeChain } from '@unisat/wallet-shared';
import {
  useChainType,
  useCurrentAccountCapabilities,
  useI18n,
  useNavigation,
  useResetFeeRateBar,
  useResetUiTxCreateScreen,
  useWalletConfig
} from '@unisat/wallet-state';
import { ChainType } from '@unisat/wallet-types';

interface WalletActionsProps {
  chain: TypeChain;
}

type WalletActionItem = {
  key: string;
  label: string;
  icon: NonNullable<ButtonProps['icon']>;
  onClick: NonNullable<ButtonProps['onClick']>;
  disabled?: boolean;
  dataTestId: string;
};

const ACTION_BUTTON_HEIGHT = 60;
const ACTION_BUTTON_GAP = 12;
const ACTION_ICON_TEXT_GAP = 6;
const actionButtonStyle = {
  flex: 1,
  minWidth: 0,
  minHeight: ACTION_BUTTON_HEIGHT,
  height: ACTION_BUTTON_HEIGHT,
  borderRadius: 12,
  gap: ACTION_ICON_TEXT_GAP - 4,
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'rgba(255, 255, 255, 0.1)',
  boxSizing: 'border-box' as const,
  marginLeft: 0,
  marginRight: 0
};
const actionRowStyle = {
  width: '100%',
  gap: ACTION_BUTTON_GAP
};
const actionButtonTextStyle = {
  fontSize: 10,
  lineHeight: '14px'
};

export const WalletActions = ({ chain }: WalletActionsProps) => {
  const isFractal = chain.isFractal;
  const nav = useNavigation();
  const resetUiTxCreateScreen = useResetUiTxCreateScreen();
  const resetFeeRateBar = useResetFeeRateBar();
  const chainType = useChainType();
  const [buyBtcModalVisible, setBuyBtcModalVisible] = useState(false);
  const walletConfig = useWalletConfig();
  const { t } = useI18n();
  const accountCapabilities = useCurrentAccountCapabilities();

  const handleUtxoClick = () => {
    nav.navToUtxoTools();
  };

  const onReceiveClick = () => {
    nav.navigate('ReceiveScreen');
  };

  const onSendClick = () => {
    resetUiTxCreateScreen();
    resetFeeRateBar();
    nav.navigate('TxCreateScreen');
  };

  const buyDisabled = chainType !== ChainType.BITCOIN_MAINNET && chainType !== ChainType.FRACTAL_BITCOIN_MAINNET;

  const actionItems = useMemo<WalletActionItem[]>(() => {
    const items: WalletActionItem[] = [
      {
        key: 'receive',
        label: t('receive'),
        icon: 'receive',
        onClick: onReceiveClick,
        dataTestId: 'receive-button'
      },
      {
        key: 'send',
        label: t('send'),
        icon: 'send',
        onClick: onSendClick,
        disabled: !accountCapabilities.canCreateSigningRequest,
        dataTestId: 'send-button'
      }
    ];

    if (!walletConfig.disableUtxoTools) {
      items.push({
        key: 'utxo',
        label: t('utxo').toUpperCase(),
        icon: 'utxo',
        onClick: handleUtxoClick,
        disabled: !accountCapabilities.canCreateSigningRequest,
        dataTestId: 'utxo-button'
      });
    }

    items.push({
      key: 'buy',
      label: t('buy'),
      icon: isFractal ? 'fb' : 'bitcoin',
      onClick: () => setBuyBtcModalVisible(true),
      disabled: buyDisabled,
      dataTestId: 'buy-button'
    });

    return items;
  }, [
    accountCapabilities.canCreateSigningRequest,
    buyDisabled,
    handleUtxoClick,
    isFractal,
    onReceiveClick,
    onSendClick,
    t,
    walletConfig.disableUtxoTools
  ]);

  const renderActionButton = (action: WalletActionItem) => {
    return (
      <Button
        key={action.key}
        text={action.label}
        preset="home"
        icon={action.icon}
        onClick={action.onClick}
        disabled={action.disabled}
        full
        style={actionButtonStyle}
        textStyle={actionButtonTextStyle}
        max2Lines
        data-testid={action.dataTestId}
      />
    );
  };

  return (
    <>
      <Column fullX mt="md" style={{ gap: ACTION_BUTTON_GAP }}>
        <Row fullX style={actionRowStyle}>
          {actionItems.map(renderActionButton)}
        </Row>
      </Column>

      {buyBtcModalVisible && (
        <BuyBTCModal
          onClose={() => {
            setBuyBtcModalVisible(false);
          }}
        />
      )}
    </>
  );
};
