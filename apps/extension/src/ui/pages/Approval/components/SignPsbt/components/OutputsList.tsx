import { Card, Column, Text } from '@/ui/components';
import { DecodedPsbt, TickPriceItem } from '@unisat/wallet-shared';
import { useI18n } from '@unisat/wallet-state';
import { InputItem } from './InputItem';

export function OutputsList({
  decodedPsbt,
  runesPriceMap,
  setContractPopoverData
}: {
  decodedPsbt: DecodedPsbt;
  runesPriceMap: { [key: string]: TickPriceItem } | undefined;
  setContractPopoverData: (data: any) => void;
}) {
  const { t } = useI18n();
  const outputInfos = decodedPsbt.outputInfos;

  return (
    <Column>
      <Card
        mt="sm"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.06)'
        }}>
        <Column full justifyCenter>
          <Text text={`${t('outputs')}: (${outputInfos.length})`} mb="lg" color="textDim" />

          {decodedPsbt.outputInfos.map((v, index) => {
            return (
              <InputItem
                key={index}
                outputInfo={v}
                index={index}
                decodedPsbt={decodedPsbt}
                runesPriceMap={runesPriceMap}
                setContractPopoverData={setContractPopoverData}
              />
            );
          })}
        </Column>
      </Card>
    </Column>
  );
}
