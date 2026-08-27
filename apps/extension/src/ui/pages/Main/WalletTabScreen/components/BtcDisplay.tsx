import { Column, Row, Text } from '@/ui/components';
import { useBtcDisplayLogic, useBTCUnit, useChainType } from '@unisat/wallet-state';

type Presets = keyof typeof $viewPresets;

const $viewPresets = {
  main: {
    mainPartSize: 28,
    subPartSize: 18,
    unitPartSize: 18,
    mainPartColor: '#000',
    subPartColor: 'rgba(0, 0, 0, 0.5)',
    unitPartColor: '#000',
    subPartMarginBottom: 2
  },
  sub: {
    mainPartSize: 12,
    subPartSize: 12,
    unitPartSize: 12,
    mainPartColor: '#000',
    subPartColor: 'rgba(0, 0, 0, 0.5)',
    unitPartColor: '#000',
    subPartMarginBottom: 0
  }
};

export function BtcDisplay({
  balance,
  hideBalance,
  preset
}: {
  balance: string;
  hideBalance?: boolean;
  preset?: Presets;
}) {
  const chainType = useChainType();
  const btcUnit = useBTCUnit();
  const $style = preset ? $viewPresets[preset] : $viewPresets['main'];

  const { totalAmountMainPart, totalAmountSubPart } = useBtcDisplayLogic(balance);

  const hiddenComponent = (
    <Column justifyCenter>
      <Text
        text={'****'}
        preset="title-bold"
        size="xxl"
        style={{
          fontSize: $style.mainPartSize,
          color: $style.mainPartColor
        }}
      />
    </Column>
  );

  const unitComponent = (
    <Column justifyCenter mx="sm">
      <Text
        text={btcUnit}
        preset="title-bold"
        textCenter
        style={{
          fontSize: $style.unitPartSize,
          color: $style.unitPartColor,
          marginBottom: $style.subPartMarginBottom
        }}
      />
    </Column>
  );
  if (hideBalance) {
    return (
      <Row itemsCenter>
        {hiddenComponent}
        {preset !== 'sub' && unitComponent}
      </Row>
    );
  }

  return (
    <Row itemsEnd gap="zero">
      <Text
        text={totalAmountMainPart}
        preset="title-bold"
        style={{
          fontSize: $style.mainPartSize,
          color: $style.mainPartColor
        }}
      />
      <Text
        text={totalAmountSubPart}
        preset="title-bold"
        style={{
          fontSize: $style.subPartSize,
          color: $style.subPartColor,
          marginBottom: $style.subPartMarginBottom
        }}
      />
      {preset !== 'sub' && unitComponent}
    </Row>
  );
}
