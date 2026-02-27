import { Column, Icon, Image, Row, Text } from '@/ui/components';
import { BtcUsd } from '@/ui/components/BtcUsd';
import { RefreshButton } from '@/ui/components/RefreshButton';
import { useBalanceCardLogic } from '@unisat/wallet-state';

import { BtcDisplay } from './BtcDisplay';

export function BalanceCard() {
  const {
    totalBalance,
    availableAmount,
    unavailableAmount,

    balanceValue,
    chain,
    t,
    isCurrentChainBalance,
    showUtxoToolButton,

    handleUnlock,

    isDetailExpanded,
    handleExpandToggle,

    isBalanceHidden,
    handleHiddenToggle,

    refreshBalance
  } = useBalanceCardLogic();

  const backgroundImage = chain.isFractal
    ? './images/artifacts/balance-bg-fb.png'
    : './images/artifacts/balance-bg-btc.png';

  return (
    <Column
      style={{
        background: 'linear-gradient(117deg, #ffda8d 1.38%, #bf630f 94.19%)',
        borderRadius: 16,
        padding: 8,
        position: 'relative'
      }}>
      <Column style={{ padding: 8 }} gap={'md'}>
        <Image src={backgroundImage} size={64} style={{ position: 'absolute', top: 0, right: 0 }} />
        <Row>
          <Text size="sm" text={t('total_balance')} style={{ color: 'rgba(0,0,0,0.55)' }} />
          <Row
            onClick={() => {
              handleHiddenToggle();
            }}>
            <Icon color={'black_muted'} icon={isBalanceHidden ? 'balance-eyes-closed' : 'balance-eyes'} size={20} />
          </Row>
          <RefreshButton onClick={refreshBalance as any} hideText />
        </Row>

        <Row itemsCenter>
          <BtcDisplay balance={balanceValue} hideBalance={isBalanceHidden} />
          <Icon
            color={'black_muted'}
            size={16}
            icon={isDetailExpanded ? 'up' : 'down'}
            onClick={() => {
              handleExpandToggle();
            }}
          />
        </Row>

        {isCurrentChainBalance && (
          <BtcUsd color={'black_muted'} sats={totalBalance} size={'md'} hideBalance={isBalanceHidden} />
        )}
      </Column>

      {isDetailExpanded && isCurrentChainBalance && (
        <Row
          justifyBetween
          style={{
            width: '100%',
            padding: 12,
            backgroundColor: '#F1CC9F',
            borderRadius: 16,
            alignItems: 'center'
          }}>
          <Column style={{ flex: 1 }} gap={'md'}>
            <Text color={'black_65'} size="xs" text={t('available')} style={{ fontWeight: 500 }}></Text>
            <BtcDisplay small balance={availableAmount} hideBalance={isBalanceHidden} />
          </Column>

          <div
            style={{
              width: 1,
              borderWidth: 1,
              height: '100%',
              borderColor: 'rgba(109, 65, 0, 0.15)'
            }}
          />

          <Row style={{ flex: 1 }} itemsCenter gap="zero">
            <Column style={{ flex: 1 }} gap={'md'}>
              <Row itemsCenter>
                <Text color={'black_65'} size="xs" text={t('unavailable')} style={{ fontWeight: 500 }}></Text>
                {showUtxoToolButton ? (
                  <Row
                    onClick={() => {
                      handleUnlock();
                    }}>
                    <Row
                      style={{
                        height: 16,
                        paddingLeft: 4,
                        paddingRight: 4,
                        borderRadius: 14,
                        backgroundColor: '#000',
                        alignItems: 'center',
                        gap: 4
                      }}>
                      <Text text={t('unlock')} size="xxs" />
                      <Icon icon={'right'} size={14} />
                    </Row>
                  </Row>
                ) : null}
              </Row>
              <BtcDisplay small balance={unavailableAmount} hideBalance={isBalanceHidden} />
            </Column>
          </Row>
        </Row>
      )}
    </Column>
  );
}
