import { useEffect, useMemo, useState } from 'react';

import { Row } from '@/ui/components';
import { Button, ButtonProps } from '@/ui/components/Button';
import { BuyBTCModal } from '@/ui/pages/BuyBTC/BuyBTCModal';
import { TypeChain } from '@unisat/wallet-shared';
import {
  useChainType,
  useCurrentAddress,
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
  priority: number;
  overflowPreset?: ButtonProps['preset'];
  dataTestId: string;
};

const MAX_PRIMARY_ACTIONS = 4;
const ACTION_BUTTON_SIZE = 64;
const actionButtonStyle = {
  minWidth: ACTION_BUTTON_SIZE,
  minHeight: ACTION_BUTTON_SIZE,
  width: ACTION_BUTTON_SIZE
};
const actionButtonTextStyle = {
  fontSize: 10,
  lineHeight: '14px'
};

export const WalletActions = ({ chain }: WalletActionsProps) => {
  const [showOverflowActions, setShowOverflowActions] = useState(false);
  const isFractal = chain.isFractal;
  const nav = useNavigation();
  const resetUiTxCreateScreen = useResetUiTxCreateScreen();
  const resetFeeRateBar = useResetFeeRateBar();
  const chainType = useChainType();
  const [buyBtcModalVisible, setBuyBtcModalVisible] = useState(false);
  const walletConfig = useWalletConfig();
  const address = useCurrentAddress();
  const { t } = useI18n();

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

  const onHistoryClick = () => {
    nav.navToExplorerAddress(address);
  };

  const buyDisabled = chainType !== ChainType.BITCOIN_MAINNET && chainType !== ChainType.FRACTAL_BITCOIN_MAINNET;

  const actionItems = useMemo<WalletActionItem[]>(() => {
    const items: WalletActionItem[] = [
      {
        key: 'receive',
        label: t('receive'),
        icon: 'receive',
        onClick: onReceiveClick,
        priority: 1,
        dataTestId: 'receive-button'
      },
      {
        key: 'send',
        label: t('send'),
        icon: 'send',
        onClick: onSendClick,
        priority: 2,
        dataTestId: 'send-button'
      }
    ];

    items.push({
      key: 'history',
      label: t('history'),
      icon: 'history',
      onClick: () => onHistoryClick(),
      priority: 4,
      overflowPreset: 'homeGold',
      dataTestId: 'history-button'
    });

    items.push({
      key: 'buy',
      label: t('buy'),
      icon: isFractal ? 'fb' : 'bitcoin',
      onClick: () => setBuyBtcModalVisible(true),
      disabled: buyDisabled,
      priority: 5,
      overflowPreset: 'homeGold',
      dataTestId: 'buy-button'
    });

    if (!walletConfig.disableUtxoTools) {
      items.push({
        key: 'utxo',
        label: t('utxo').toUpperCase(),
        icon: 'utxo',
        onClick: handleUtxoClick,
        priority: 6,
        overflowPreset: 'homeGold',
        dataTestId: 'utxo-button'
      });
    }

    return items;
  }, [buyDisabled, handleUtxoClick, isFractal, t, walletConfig.disableUtxoTools]);

  const { primaryActions, overflowActions } = useMemo(() => {
    const items = actionItems.sort((a, b) => a.priority - b.priority);
    let primaryActions: WalletActionItem[] = [];
    let overflowActions: WalletActionItem[] = [];
    if (items.length <= MAX_PRIMARY_ACTIONS) {
      primaryActions = items;
    } else {
      primaryActions = items.slice(0, MAX_PRIMARY_ACTIONS - 1);
      overflowActions = items.slice(MAX_PRIMARY_ACTIONS - 1);
    }

    return {
      primaryActions,
      overflowActions
    };
  }, [actionItems]);

  useEffect(() => {
    setShowOverflowActions(false);
  }, [chain.enum, overflowActions.length]);

  const renderActionButton = (action: WalletActionItem, location: 'primary' | 'overflow') => (
    <Button
      key={action.key}
      text={action.label}
      preset={location === 'overflow' ? action.overflowPreset || 'home' : 'home'}
      icon={action.icon}
      onClick={action.onClick}
      disabled={action.disabled}
      style={actionButtonStyle}
      textStyle={actionButtonTextStyle}
      max2Lines
      data-testid={action.dataTestId}
    />
  );

  return (
    <>
      <Row justifyCenter mt="md" style={{ flexWrap: 'wrap' }}>
        {primaryActions.map((action) => renderActionButton(action, 'primary'))}
        {overflowActions.length > 0 && (
          <Button
            text={t('more')}
            preset={showOverflowActions ? 'homeGold' : 'home'}
            icon="more"
            onClick={() => setShowOverflowActions((prev) => !prev)}
            style={actionButtonStyle}
            textStyle={actionButtonTextStyle}
            max2Lines
            data-testid="more-button"
          />
        )}
      </Row>

      {showOverflowActions && overflowActions.length > 0 && (
        <Row justifyCenter mt="md" style={{ flexWrap: 'wrap' }}>
          {/* add empty action place to align the overflow button to the right*/}
          {MAX_PRIMARY_ACTIONS - overflowActions.length > 0 && (
            <Button preset="homeGold" style={{ ...actionButtonStyle, opacity: 0 }}></Button>
          )}
          {MAX_PRIMARY_ACTIONS - overflowActions.length > 1 && (
            <Button preset="homeGold" style={{ ...actionButtonStyle, opacity: 0 }}></Button>
          )}
          {MAX_PRIMARY_ACTIONS - overflowActions.length > 2 && (
            <Button preset="homeGold" style={{ ...actionButtonStyle, opacity: 0 }}></Button>
          )}

          {overflowActions.map((action) => renderActionButton(action, 'overflow'))}
        </Row>
      )}

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
