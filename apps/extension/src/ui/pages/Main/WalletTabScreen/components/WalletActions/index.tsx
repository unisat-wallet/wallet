import { useEffect, useMemo, useState } from 'react';

import { Column, Row } from '@/ui/components';
import { Button, ButtonProps } from '@/ui/components/Button';
import { BuyBTCModal } from '@/ui/pages/BuyBTC/BuyBTCModal';
import { TypeChain } from '@unisat/wallet-shared';
import {
  useChainType,
  useCurrentAccountCapabilities,
  useCurrentAddress,
  useI18n,
  useNavigation,
  useResetFeeRateBar,
  useResetUiTxCreateScreen,
  useWallet,
  useWalletConfig,
  WalletView
} from '@unisat/wallet-state';
import { ChainType } from '@unisat/wallet-types';

interface WalletActionsProps {
  chain: TypeChain;
  walletView?: WalletView;
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

function findUsdtToken(items: Array<{ assetId?: string; ticker?: string; name?: string; [key: string]: unknown }>) {
  return items.find((item) => {
    const ticker = (item.ticker || '').toUpperCase();
    const name = (item.name || '').toUpperCase();
    return ticker === 'USDT' || name === 'USDT';
  });
}

export const WalletActions = ({ chain, walletView = WalletView.BITCOIN }: WalletActionsProps) => {
  const [showOverflowActions, setShowOverflowActions] = useState(false);
  const isFractal = chain.isFractal;
  const nav = useNavigation();
  const resetUiTxCreateScreen = useResetUiTxCreateScreen();
  const resetFeeRateBar = useResetFeeRateBar();
  const chainType = useChainType();
  const [buyBtcModalVisible, setBuyBtcModalVisible] = useState(false);
  const walletConfig = useWalletConfig();
  const wallet = useWallet();
  const address = useCurrentAddress();
  const { t } = useI18n();
  const accountCapabilities = useCurrentAccountCapabilities();
  const isRgbView = walletView === WalletView.RGB;
  const canSendRgbUsdtToken = chain.enum === ChainType.BITCOIN_MAINNET;

  const handleUtxoClick = () => {
    nav.navToUtxoTools();
  };

  const onReceiveClick = () => {
    if (isRgbView) {
      nav.navigate('RGBReceiveScreen', {});
      return;
    }

    nav.navigate('ReceiveScreen');
  };

  const onSendClick = async () => {
    if (isRgbView) {
      const fallbackToken = {
        assetId: '',
        ticker: 'USDT',
        name: 'USDT',
        spendable: '0',
        balance: '0',
        amount: '0'
      };
      let tokenBalance = fallbackToken;
      try {
        const { list } = await wallet.getRGBList('', 1, 20, { skipSync: true });
        const usdtToken = findUsdtToken(list || []);
        if (usdtToken) {
          tokenBalance = usdtToken as typeof fallbackToken;
        }
      } catch {
        // Keep the USDT fallback when the lightweight list fetch fails.
      }
      nav.navigate('SendRGBScreen', {
        assetId: tokenBalance.assetId || '',
        tokenBalance
      });
      return;
    }

    resetUiTxCreateScreen();
    resetFeeRateBar();
    nav.navigate('TxCreateScreen');
  };

  const onHistoryClick = () => {
    if (isRgbView) {
      nav.navigate('RGBHistoryScreen');
      return;
    }

    nav.navToExplorerAddress(address);
  };

  const onIssueClick = () => {
    nav.navigate('RGBIssueScreen');
  };

  const buyDisabled = chainType !== ChainType.BITCOIN_MAINNET && chainType !== ChainType.FRACTAL_BITCOIN_MAINNET;

  const actionItems = useMemo<WalletActionItem[]>(() => {
    if (isRgbView) {
      const items: WalletActionItem[] = [
        {
          key: 'receive-rgb',
          label: t('receive'),
          icon: 'rgb',
          onClick: onReceiveClick,
          priority: 1,
          dataTestId: 'receive-rgb-button'
        },
        {
          key: 'issue',
          label: t('issue'),
          icon: 'issue',
          onClick: onIssueClick,
          priority: 4,
          overflowPreset: 'homeGold',
          dataTestId: 'issue-button'
        }
      ];

      if (canSendRgbUsdtToken) {
        items.splice(1, 0, {
          key: 'send-usdt',
          label: t('send'),
          icon: 'usdt',
          onClick: onSendClick,
          priority: 2,
          dataTestId: 'send-usdt-button'
        });
      }

      return items;
    }

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
        disabled: !accountCapabilities.canCreateSigningRequest,
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
        disabled: !accountCapabilities.canCreateSigningRequest,
        priority: 6,
        overflowPreset: 'homeGold',
        dataTestId: 'utxo-button'
      });
    }

    return items;
  }, [
    accountCapabilities.canCreateSigningRequest,
    buyDisabled,
    canSendRgbUsdtToken,
    handleUtxoClick,
    isFractal,
    isRgbView,
    onHistoryClick,
    onIssueClick,
    onReceiveClick,
    onSendClick,
    t,
    wallet,
    walletConfig.disableUtxoTools
  ]);

  const { primaryActions, overflowActions } = useMemo(() => {
    const items = [...actionItems].sort((a, b) => a.priority - b.priority);
    if (items.length <= MAX_PRIMARY_ACTIONS) {
      return {
        primaryActions: items,
        overflowActions: []
      };
    }

    return {
      primaryActions: items.slice(0, MAX_PRIMARY_ACTIONS - 1),
      overflowActions: items.slice(MAX_PRIMARY_ACTIONS - 1)
    };
  }, [actionItems]);

  useEffect(() => {
    setShowOverflowActions(false);
  }, [chain.enum, overflowActions.length, walletView]);

  const renderActionButton = (action: WalletActionItem, location: 'primary' | 'overflow') => {
    return (
      <Button
        key={action.key}
        text={action.label}
        preset={location === 'overflow' ? action.overflowPreset || 'home' : 'home'}
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
          {primaryActions.map((action) => renderActionButton(action, 'primary'))}
          {overflowActions.length > 0 && (
            <Button
              text={t('more')}
              preset="home"
              icon="more"
              onClick={() => setShowOverflowActions((prev) => !prev)}
              full
              style={actionButtonStyle}
              textStyle={actionButtonTextStyle}
              max2Lines
              data-testid="more-button"
            />
          )}
        </Row>

        {showOverflowActions && overflowActions.length > 0 && (
          <Row fullX style={actionRowStyle}>
            {MAX_PRIMARY_ACTIONS - overflowActions.length > 0 && (
              <Button preset="home" full style={{ ...actionButtonStyle, opacity: 0 }}></Button>
            )}
            {MAX_PRIMARY_ACTIONS - overflowActions.length > 1 && (
              <Button preset="home" full style={{ ...actionButtonStyle, opacity: 0 }}></Button>
            )}
            {MAX_PRIMARY_ACTIONS - overflowActions.length > 2 && (
              <Button preset="home" full style={{ ...actionButtonStyle, opacity: 0 }}></Button>
            )}

            {overflowActions.map((action) => renderActionButton(action, 'overflow'))}
          </Row>
        )}
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
