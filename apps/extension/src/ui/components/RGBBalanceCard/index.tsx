import { useI18n, useRGBBalanceCardLogic, useWalletConfig, type RGBBalanceCardProps } from '@unisat/wallet-state';

import { formatRgbUsdtValue, isConfiguredRgbUsdt } from '@/ui/utils/rgbUsdtPrice';

import { Card } from '../Card';
import { RGBAssetIcon } from '../RGBAssetIcon';
import { Row } from '../Row';
import { Text } from '../Text';
import { TruncatedAssetName } from '../TruncatedAssetName';
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
  const configuredUsdtAssetId = useWalletConfig().rgbUsdtAssetId;
  const showUsdtPrice = showPrice && isConfiguredRgbUsdt(props.tokenBalance?.assetId || '', configuredUsdtAssetId);
  const hasPendingBalance = pendingBalance.gt(0);
  const hasLockedBalance = lockedBalance.gt(0);

  return (
    <Card fullX onClick={onClick} data-testid={props['data-testid']} style={getTokenBalanceCardStyle()}>
      <TokenBalanceCardLayout
        icon={<RGBAssetIcon iconInfo={iconInfo} ticker={ticker} name={name} size={32} />}
        onIconClick={onClick}
        title={<TruncatedAssetName text={name || ticker || ''} size="sm" color="white" />}
        quantity={
          <Row itemsCenter gap="sm">
            <Text text={balanceStr} size="xs" digital />
            {hasPendingBalance ? (
              <Text text={`${pendingBalanceStr} (${t('pending')})`} size="xxs" color="gold" />
            ) : null}
            {hasLockedBalance ? (
              <Text text={`${lockedBalanceStr} (${t('rgb_amount_locking')})`} size="xxs" color="gold" />
            ) : null}
          </Row>
        }
        showPrice={showPrice}
        price={price}
        priceContent={showUsdtPrice ? (
          <Row justifyBetween itemsCenter>
            <Text text="$1.00" color="textDim" size="xs" />
            <Text text={formatRgbUsdtValue(balance.toString())} color="textDim" size="xs" />
          </Row>
        ) : undefined}
        balance={balance.toString()}
      />
    </Card>
  );
}
