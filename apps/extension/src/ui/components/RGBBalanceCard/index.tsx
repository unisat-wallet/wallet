import {
  findRgbAssetPolicy,
  useI18n,
  useRGBBalanceCardLogic,
  useWalletConfig,
  type RGBBalanceCardProps
} from '@unisat/wallet-state';

import { formatRgbUsdtValue, isOfficialRgbUsdt } from '@/ui/utils/rgbUsdtPrice';

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
    lockedBalance,
    showPrice,
    price,
    iconInfo
  } = useRGBBalanceCardLogic(props);
  const { t } = useI18n();
  const walletConfig = useWalletConfig();
  const configuredUsdtAssetId = walletConfig.rgbUsdtAssetId;
  const assetPolicy = findRgbAssetPolicy(props.tokenBalance?.assetId, walletConfig);
  const showUsdtPrice =
    showPrice && isOfficialRgbUsdt(props.tokenBalance?.assetId || '', configuredUsdtAssetId, assetPolicy);
  const hasPendingBalance = pendingBalance.gt(0);
  const hasLockedBalance = lockedBalance.gt(0);

  return (
    <Card fullX onClick={onClick} data-testid={props['data-testid']} style={getTokenBalanceCardStyle()}>
      <TokenBalanceCardLayout
        icon={<RGBAssetIcon iconInfo={iconInfo} ticker={ticker} name={name} size={32} />}
        onIconClick={onClick}
        title={
          <Row itemsCenter gap="xs">
            <TruncatedAssetName text={name || ticker || ''} size="sm" color="white" />
            {assetPolicy?.status === 'deprecated' ? (
              <Text
                text={t('rgb_asset_deprecated')}
                size="xxs"
                color="gold"
                style={{ padding: '2px 6px', borderRadius: 6, background: 'rgba(244,182,44,0.12)' }}
              />
            ) : null}
          </Row>
        }
        quantity={
          <Row itemsCenter gap="sm">
            <Text text={balanceStr} size="xs" digital />
            {hasPendingBalance || hasLockedBalance ? (
              <Text text={`(${t('rgb_balance_processing')})`} size="xxs" color="gold" />
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
