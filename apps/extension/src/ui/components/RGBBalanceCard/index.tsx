import { useI18n, useRGBBalanceCardLogic, type RGBBalanceCardProps } from '@unisat/wallet-state';

import { Card } from '../Card';
import { RGBAssetIcon } from '../RGBAssetIcon';
import { Row } from '../Row';
import { RunesTicker } from '../RunesTicker';
import { Text } from '../Text';
import { getTokenBalanceCardStyle, TokenBalanceCardLayout } from '../TokenBalanceCardLayout';

export default function RGBBalanceCard(props: RGBBalanceCardProps) {
  const {
    onClick,
    ticker,
    name,
    balance,
    balanceStr,
    pendingBalance,
    pendingBalanceStr,
    lockedBalance,
    lockedBalanceStr,
    showPrice,
    price,
    iconInfo
  } = useRGBBalanceCardLogic(props);
  const { t } = useI18n();
  const hasPendingBalance = pendingBalance.gt(0);
  const hasLockedBalance = lockedBalance.gt(0);
  const displayedBalance = balance.isZero() && hasLockedBalance ? lockedBalanceStr : balanceStr;
  const pendingOnly = balance.isZero() && hasPendingBalance && !hasLockedBalance;

  return (
    <Card fullX onClick={onClick} data-testid={props['data-testid']} style={getTokenBalanceCardStyle()}>
      <TokenBalanceCardLayout
        icon={<RGBAssetIcon iconInfo={iconInfo} ticker={ticker} name={name} size={32} />}
        onIconClick={onClick}
        title={<RunesTicker tick={name} truncate />}
        quantity={
          pendingOnly ? (
            <Row itemsCenter gap="sm">
              <Text text={pendingBalanceStr} size="xs" color="gold" digital />
              <Text text={`(${t('pending')})`} size="xxs" color="gold" />
            </Row>
          ) : (
            <Row itemsCenter gap="sm">
              <Text text={displayedBalance} size="xs" digital />
              {hasPendingBalance ? (
                <Text text={`(${t('pending')})`} size="xxs" color="gold" />
              ) : null}
              {hasLockedBalance ? (
                <Text
                  text={`(${t('rgb_amount_locking')})`}
                  size="xxs"
                  color="gold"
                />
              ) : null}
            </Row>
          )
        }
        showPrice={showPrice}
        price={price}
        balance={balance.toString()}
      />
    </Card>
  );
}
