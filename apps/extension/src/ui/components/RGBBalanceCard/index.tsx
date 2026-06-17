import { useRGBBalanceCardLogic, type RGBBalanceCardProps } from '@unisat/wallet-state';

import { Card } from '../Card';
import { Column } from '../Column';
import { RGBAssetIcon } from '../RGBAssetIcon';
import { Row } from '../Row';
import { RunesTicker } from '../RunesTicker';
import { Text } from '../Text';
import { TokenBalancePrice } from '../TokenBalancePrice';

export default function RGBBalanceCard(props: RGBBalanceCardProps) {
  const { onClick, ticker, name, balance, balanceStr, showPrice, price, iconInfo } = useRGBBalanceCardLogic(props);

  return (
    <Card
      style={{
        backgroundColor: '#1E1F24',
        borderColor: 'rgba(255,255,255,0.1)',
        borderRadius: 12
      }}
      fullX
      onClick={onClick}
      data-testid={props['data-testid']}
    >
      <Column full py="zero" gap="zero">
        <Row fullY justifyBetween justifyCenter>
          <Column onClick={onClick}>
            <RGBAssetIcon iconInfo={iconInfo} size={32} />
          </Column>

          <Column justifyCenter style={{ marginRight: 'auto' }} fullX gap="zero">
            <RunesTicker tick={name} />
            <Row itemsCenter justifyBetween>
              <Text text={ticker} size="xs" color="white_muted" />
              <Row itemsCenter fullY gap="zero">
                <Text text={balanceStr} size="xs" />
                <Text text={ticker} size="xs" mx="sm" />
              </Row>
            </Row>
          </Column>
        </Row>
        <TokenBalancePrice showPrice={showPrice} price={price} balance={balance.toString()} />
      </Column>
    </Card>
  );
}
