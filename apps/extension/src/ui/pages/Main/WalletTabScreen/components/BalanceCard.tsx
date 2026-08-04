import { Column, Icon, Image, Row, Text, Tooltip } from '@/ui/components';
import { BtcUsd } from '@/ui/components/BtcUsd';
import { RefreshButton } from '@/ui/components/RefreshButton';
import { fontSizes } from '@/ui/theme/font';
import { KeyringType } from '@unisat/keyring-service/types';
import { useBalanceCardLogic, useCurrentKeyring } from '@unisat/wallet-state';

import { BtcDisplay } from './BtcDisplay';

const GOLD_THEME = {
  background: 'linear-gradient(117deg, #ffda8d 1.38%, #bf630f 94.19%)',
  expanded: '#F1CC9F',
  divider: 'rgba(109, 65, 0, 0.15)',
  label: 'rgba(0,0,0,0.55)',
  icon: 'black_muted' as const,
  usd: 'black_muted' as const,
  detailLabel: 'black_65' as const,
  variant: 'gold' as const
};

/** Premium grey for watch-only — read-only tracker, not a spendable vault card */
const WATCH_GREY_THEME = {
  background: 'linear-gradient(125deg, #4a4a4e 0%, #2c2c30 48%, #1a1a1c 100%)',
  expanded: '#2a2a2e',
  divider: 'rgba(255, 255, 255, 0.12)',
  label: 'rgba(255,255,255,0.55)',
  icon: 'white_muted2' as const,
  usd: 'white_muted2' as const,
  detailLabel: 'white_muted2' as const,
  variant: 'grey' as const
};

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

  const currentKeyring = useCurrentKeyring();
  const isWatchOnly = currentKeyring?.type === KeyringType.WatchAddressKeyring;
  const theme = isWatchOnly ? WATCH_GREY_THEME : GOLD_THEME;

  const backgroundImage = chain.isFractal
    ? './images/icons/artifacts/balance-bg-fb.png'
    : './images/icons/artifacts/balance-bg-btc.png';

  const stopCardToggle = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  return (
    <Column
      style={{
        background: theme.background,
        borderRadius: 16,
        padding: 8,
        position: 'relative',
        boxShadow: isWatchOnly ? 'inset 0 1px 0 rgba(255,255,255,0.08)' : undefined
      }}
      onClick={() => {
        handleExpandToggle();
      }}>
      <Column style={{ padding: 8 }} gap={'md'}>
        <Image
          src={backgroundImage}
          size={64}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            opacity: isWatchOnly ? 0.35 : 1,
            filter: isWatchOnly ? 'grayscale(1) brightness(1.4)' : undefined
          }}
        />
        <Row itemsCenter>
          <Text size="sm" text={t('total_balance')} style={{ color: theme.label }} />
          {isWatchOnly ? (
            <Text size="xs" text={t('watch_only') || 'Watch only'} style={{ color: theme.label, marginLeft: 6 }} />
          ) : null}
          <Row itemsCenter gap="sm">
            <Row
              style={{ padding: 6, margin: -6 }}
              onClick={(event) => {
                stopCardToggle(event);
                handleHiddenToggle();
              }}>
              <Icon color={theme.icon} icon={isBalanceHidden ? 'balance-eyes-closed' : 'balance-eyes'} size={20} />
            </Row>
            <RefreshButton onClick={refreshBalance as any} hideText />
          </Row>
        </Row>

        <Row itemsCenter>
          <BtcDisplay balance={balanceValue} hideBalance={isBalanceHidden} variant={theme.variant} />
          <Icon color={theme.icon} size={16} icon={isDetailExpanded ? 'up' : 'down'} />
        </Row>

        {isCurrentChainBalance && (
          <BtcUsd color={theme.usd} sats={totalBalance} size={'md'} hideBalance={isBalanceHidden} />
        )}
      </Column>

      {isDetailExpanded && isCurrentChainBalance && (
        <Row
          style={{
            width: '100%',
            padding: 12,
            backgroundColor: theme.expanded,
            borderRadius: 16,
            gap: 8,
            alignItems: 'flex-start'
          }}>
          <Column style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }} gap="xs">
            <Row itemsCenter gap="xs" style={{ height: 20 }}>
              <Text
                color={theme.detailLabel}
                size="xs"
                text={t('available')}
                style={{ fontWeight: 500, lineHeight: '16px', opacity: isWatchOnly ? 0.7 : 1 }}
              />
              <div style={{ width: 16, height: 16, flexShrink: 0 }} />
            </Row>
            <BtcDisplay preset="sub" balance={availableAmount} hideBalance={isBalanceHidden} variant={theme.variant} />
          </Column>

          <div
            style={{
              width: 1,
              alignSelf: 'stretch',
              backgroundColor: theme.divider,
              flexShrink: 0
            }}
          />

          <Column style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }} gap="xs">
            <Row itemsCenter gap="xs" style={{ height: 20 }}>
              <Text
                color={theme.detailLabel}
                size="xs"
                text={t('unavailable')}
                style={{ fontWeight: 500, lineHeight: '16px', opacity: isWatchOnly ? 0.7 : 1 }}
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
            <BtcDisplay
              preset="sub"
              balance={unavailableAmount}
              hideBalance={isBalanceHidden}
              variant={theme.variant}
            />
          </Column>

          {showUtxoToolButton && !isWatchOnly ? (
            <Tooltip
              title={`${t('unlock')} ->`}
              overlayStyle={{
                fontSize: fontSizes.sm,
                marginTop: 5
              }}>
              <Icon
                style={{ cursor: 'pointer', flexShrink: 0, alignSelf: 'center' }}
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
