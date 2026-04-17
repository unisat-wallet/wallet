import { Column, Icon, Image, Row, Text, Tooltip } from '@/ui/components';
import { BtcUsd } from '@/ui/components/BtcUsd';
import { RefreshButton } from '@/ui/components/RefreshButton';
import { fontSizes } from '@/ui/theme/font';
import { useBalanceCardLogic } from '@unisat/wallet-state';

import { BtcDisplay } from './BtcDisplay';

export function BalanceCard() {
  const {
    totalBalance,
    availableAmount,
    unavailableAmount,
    unavailableTipText,
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
    ? './images/icons/artifacts/balance-bg-fb.png'
    : './images/icons/artifacts/balance-bg-btc.png';

  const stopCardToggle = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  return (
    <Column
      style={{
        background: 'linear-gradient(117deg, #ffda8d 1.38%, #bf630f 94.19%)',
        borderRadius: 16,
        padding: 8,
        position: 'relative'
      }}
      onClick={() => {
        handleExpandToggle();
      }}>
      <Column style={{ padding: 8 }} gap={'md'}>
        <Image src={backgroundImage} size={64} style={{ position: 'absolute', top: 0, right: 0 }} />
        <Row itemsCenter>
          <Text size="sm" text={t('total_balance')} style={{ color: 'rgba(0,0,0,0.55)' }} />
          <Row
            style={{ padding: 6, margin: -6 }}
            onClick={(event) => {
              stopCardToggle(event);
              handleHiddenToggle();
            }}>
            <Icon color={'black_muted'} icon={isBalanceHidden ? 'balance-eyes-closed' : 'balance-eyes'} size={20} />
          </Row>
          <RefreshButton onClick={refreshBalance as any} hideText />
        </Row>

        <Row itemsCenter>
          <BtcDisplay balance={balanceValue} hideBalance={isBalanceHidden} />
          <Icon color={'black_muted'} size={16} icon={isDetailExpanded ? 'up' : 'down'} />
        </Row>

        {isCurrentChainBalance && (
          <BtcUsd color={'black_muted'} sats={totalBalance} size={'md'} hideBalance={isBalanceHidden} />
        )}
      </Column>

      {isDetailExpanded && isCurrentChainBalance && (
        <Row
          justifyBetween
          itemsCenter
          style={{
            width: '100%',
            padding: 12,
            backgroundColor: '#F1CC9F',
            borderRadius: 16
          }}>
          <Column style={{ flex: 1 }} gap={'zero'}>
            <Row>
              <Text color={'black_65'} size="xs" text={t('available')} style={{ fontWeight: 500 }}></Text>
              <Row style={{ height: 20 }} />
            </Row>
            <BtcDisplay preset="sub" balance={availableAmount} hideBalance={isBalanceHidden} />
          </Column>

          <div
            style={{
              width: 1,
              borderWidth: 1,
              height: '100%',
              borderColor: 'rgba(109, 65, 0, 0.15)',
              marginRight: 5
            }}
          />

          <Column style={{ flex: 1 }} gap={'zero'}>
            <Row itemsCenter>
              <Text color={'black_65'} size="xs" text={t('unavailable')} style={{ fontWeight: 500 }}></Text>
              <Tooltip
                title={unavailableTipText}
                overlayStyle={{
                  fontSize: fontSizes.xs
                }}>
                <Icon
                  icon="balance-question"
                  size={20}
                  style={{
                    marginBottom: 10
                  }}
                />
              </Tooltip>
            </Row>
            <BtcDisplay preset="sub" balance={unavailableAmount} hideBalance={isBalanceHidden} />
          </Column>

          {showUtxoToolButton ? (
            <Tooltip
              title={`${t('unlock')} ->`}
              overlayStyle={{
                fontSize: fontSizes.sm,
                marginTop: 5
              }}>
              <Icon
                style={{ flex: 1, cursor: 'pointer' }}
                icon={'unlock'}
                size={28}
                onClick={() => {
                  handleUnlock();
                }}
              />
            </Tooltip>
          ) : null}
        </Row>
      )}
    </Column>
  );
}
