import { useEffect, useState } from 'react';

import { Row, Text } from '@/ui/components';
import { Button } from '@/ui/components/Button';
import { Icon } from '@/ui/components/Icon';
import { BuyBTCModal } from '@/ui/pages/BuyBTC/BuyBTCModal';
import { TypeChain } from '@unisat/wallet-shared';
import {
  useAddressExplorerUrl,
  useChainType,
  useI18n,
  useNavigation,
  useResetFeeRateBar,
  useResetUiTxCreateScreen,
  useWalletConfig
} from '@unisat/wallet-state';
import { ChainType } from '@unisat/wallet-types';

interface WalletActionsProps {
  chain: TypeChain;
  address: string;
}

export const WalletActions = ({ chain, address }: WalletActionsProps) => {
  const [moreExpanded, setMoreExpanded] = useState(false);
  const [utxoClicked, setUtxoClicked] = useState(false);
  const isFractal = chain.isFractal;
  const nav = useNavigation();
  const resetUiTxCreateScreen = useResetUiTxCreateScreen();
  const resetFeeRateBar = useResetFeeRateBar();
  const chainType = useChainType();
  const addressExplorerUrl = useAddressExplorerUrl(address);
  const [buyBtcModalVisible, setBuyBtcModalVisible] = useState(false);
  const walletConfig = useWalletConfig();
  const { t } = useI18n();

  const shouldUseMoreExpandedLayout = () => {
    if (walletConfig.disableUtxoTools) return false;
    return true;
  };

  useEffect(() => {
    const checkUtxoClicked = async () => {
      const hasClickedUtxo = localStorage.getItem('utxo_clicked');
      if (hasClickedUtxo === 'true') {
        setUtxoClicked(true);
      }
    };
    checkUtxoClicked();
  }, []);

  // Reset moreExpanded state when chain changes
  useEffect(() => {
    setMoreExpanded(false);
  }, [chain.enum]);

  const handleUtxoClick = () => {
    setUtxoClicked(true);
    localStorage.setItem('utxo_clicked', 'true');
    nav.navToUtxoTools();
  };

  const onHistoryClick = () => {
    nav.navToExplorerAddress(address);
  };

  const onReceiveClick = () => {
    nav.navigate('ReceiveScreen');
  };

  const onSendClick = () => {
    resetUiTxCreateScreen();
    resetFeeRateBar();
    nav.navigate('TxCreateScreen');
  };

  const NewBadge = ({ top = -16, right = -14 }: { top?: number; right?: number }) => (
    <div
      style={{
        position: 'absolute',
        top,
        right,
        padding: '0px 5px',
        borderRadius: 4,
        backgroundColor: 'rgba(176, 37, 37, 0.25)',
        zIndex: 10
      }}>
      <Text text={t('new')} color="red_light2" size="xxs" />
    </div>
  );

  return (
    <>
      {!shouldUseMoreExpandedLayout() ? (
        <Row justifyCenter mt="md">
          <Button
            text={t('receive')}
            preset="home"
            icon="receive"
            onClick={(e) => {
              nav.navigate('ReceiveScreen');
            }}
            data-testid="receive-button"
          />

          <Button
            text={t('send')}
            preset="home"
            icon="send"
            onClick={(e) => {
              resetUiTxCreateScreen();
              nav.navigate('TxCreateScreen');
            }}
            data-testid="send-button"
          />
          <Button
            text={t('history')}
            preset="home"
            icon="history"
            onClick={(e) => {
              if (chain.isViewTxHistoryInternally) {
                nav.navigate('HistoryScreen');
              } else {
                window.open(addressExplorerUrl);
              }
            }}
            data-testid="history-button"
          />
          <Button
            text={t('buy')}
            preset="home"
            icon={chain.isFractal ? 'fb' : 'bitcoin'}
            onClick={(e) => {
              setBuyBtcModalVisible(true);
            }}
            disabled={chainType !== ChainType.BITCOIN_MAINNET && chainType !== ChainType.FRACTAL_BITCOIN_MAINNET}
            data-testid="buy-button"
          />
        </Row>
      ) : (
        <>
          <Row justifyCenter mt="md">
            <Button
              text={t('receive')}
              preset="home"
              icon="receive"
              onClick={onReceiveClick}
              data-testid="receive-button"
            />

            <Button text={t('send')} preset="home" icon="send" onClick={onSendClick} data-testid="send-button" />
            <Button
              text={t('history')}
              preset="home"
              icon="history"
              onClick={onHistoryClick}
              data-testid="history-button"
            />
            {/* Custom div used to avoid Button component's style merging issues with toggle states */}
            <div
              style={{
                display: 'flex',
                minWidth: 64,
                minHeight: 64,
                flexDirection: 'column',
                borderRadius: 16,
                border: moreExpanded ? '1px solid rgba(244, 182, 44, 0.25)' : '1px solid #FFFFFF4D',
                background: moreExpanded ? 'rgba(244, 182, 44, 0.10)' : '#2a2626',
                padding: 5,
                marginRight: 5,
                marginLeft: 5,
                justifyContent: 'center',
                alignItems: 'center',
                cursor: 'pointer',
                position: 'relative'
              }}
              onClick={() => setMoreExpanded(!moreExpanded)}>
              {!moreExpanded && (
                <>
                  {!utxoClicked && <NewBadge />}

                  <div
                    style={{
                      position: 'absolute',
                      top: -12,
                      right: -12,
                      zIndex: 5
                    }}>
                    <Icon icon="utxobg" size={32} />
                  </div>
                </>
              )}
              <Icon icon="more" />
              <Text text={t('more')} color="white" size="xs" style={{ marginTop: 4 }} />
            </div>
          </Row>

          {moreExpanded && (
            <Row justifyCenter mt="md">
              <div style={{ display: 'flex', width: '100%', maxWidth: 300, justifyContent: 'space-between' }}>
                <Button preset="home" style={{ opacity: 0 }}></Button>
                <Button preset="home" style={{ opacity: 0 }}></Button>
                <div style={{ position: 'relative', marginRight: 7, marginLeft: 8 }}>
                  <Button text="UTXO" preset="homeGold" icon="utxo" onClick={handleUtxoClick} />
                  {!utxoClicked && <NewBadge top={-5} right={-5} />}
                </div>
                <Button
                  text={t('buy')}
                  preset="homeGold"
                  icon={isFractal ? 'fb' : 'bitcoin'}
                  onClick={() => setBuyBtcModalVisible(true)}
                  disabled={chainType !== ChainType.BITCOIN_MAINNET && chainType !== ChainType.FRACTAL_BITCOIN_MAINNET}
                  data-testid="buy-button"
                />
              </div>
            </Row>
          )}
        </>
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
