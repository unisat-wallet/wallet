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
      data-testid="balance-card"
      fullX
      style={{
        background: 'linear-gradient(117deg, #ffda8d 1.38%, #bf630f 94.19%)',
        borderRadius: 16,
        padding: 8,
        position: 'relative',
        minHeight: isDetailExpanded ? 180 : 118,
        height: '100%',
        boxSizing: 'border-box',
        justifyContent: 'space-between'
      }}
      onClick={() => {
        handleExpandToggle();
      }}>
      <Column style={{ padding: 8 }} gap={'md'}>
        <Image src={backgroundImage} size={64} style={{ position: 'absolute', top: 0, right: 0 }} />
        <Row itemsCenter>
          <Text size="sm" text={t('total_balance')} style={{ color: 'rgba(0,0,0,0.55)' }} />
          <div data-card-action="true">
            <Row itemsCenter gap="sm">
              <Row
                style={{ padding: 6, margin: -6, cursor: 'pointer' }}
                onClick={(event) => {
                  stopCardToggle(event);
                  handleHiddenToggle();
                }}>
                <Icon color={'black_muted'} icon={isBalanceHidden ? 'balance-eyes-closed' : 'balance-eyes'} size={20} />
              </Row>
              <RefreshButton onClick={refreshBalance as any} hideText />
            </Row>
          </div>
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
          data-testid="balance-breakdown"
          style={{
            width: '100%',
            padding: 12,
            backgroundColor: '#F1CC9F',
            borderRadius: 16,
            gap: 8,
            alignItems: 'center',
            marginTop: 'auto'
          }}>
          <Column style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }} gap="xs">
            <Row itemsCenter gap="xs" style={{ height: 20 }}>
              <Text
                color={'black_65'}
                size="xs"
                text={t('available')}
                style={{ fontWeight: 500, lineHeight: '16px' }}
              />
              <div style={{ width: 16, height: 16, flexShrink: 0 }} />
            </Row>
            <BtcDisplay preset="sub" balance={availableAmount} hideBalance={isBalanceHidden} />
          </Column>

          <div
            style={{
              width: 1,
              alignSelf: 'stretch',
              backgroundColor: 'rgba(109, 65, 0, 0.15)',
              flexShrink: 0
            }}
          />

          <Column style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }} gap="xs">
            <Row itemsCenter gap="xs" style={{ height: 20 }}>
              <Text
                color={'black_65'}
                size="xs"
                text={t('unavailable')}
                style={{ fontWeight: 500, lineHeight: '16px' }}
              />
              <Tooltip
                title={unavailableTipText}
                overlayStyle={{
                  fontSize: fontSizes.xs
                }}>
                <div style={{ display: 'flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0 }}>
                  <Icon icon="balance-question" size={16} containerStyle={{ display: 'block', marginTop: -1 }} />
                </div>
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
              <div
                data-card-action="true"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  alignSelf: 'center'
                }}>
                <Icon
                  style={{ cursor: 'pointer', display: 'block' }}
                  icon={'unlock'}
                  size={28}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleUnlock();
                  }}
                />
              </div>
            </Tooltip>
          ) : null}
        </Row>
      )}
    </Column>
  );
}
