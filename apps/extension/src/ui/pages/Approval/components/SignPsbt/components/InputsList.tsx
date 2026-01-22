import { Card, Column, Text } from '@/ui/components';
import { DecodedPsbt, TickPriceItem, ToSignData } from '@unisat/wallet-shared';
import { useI18n } from '@unisat/wallet-state';
import { InputItem } from './InputItem';

export function InputsList({
  toSignData,
  decodedPsbt,
  runesPriceMap,
  setContractPopoverData
}: {
  toSignData: ToSignData;
  decodedPsbt: DecodedPsbt;
  runesPriceMap: { [key: string]: TickPriceItem } | undefined;
  setContractPopoverData: (data: any) => void;
}) {
  const { t } = useI18n();
  const inputInfos = decodedPsbt.inputInfos;

  return (
    <Column>
      <Card
        mt="sm"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.06)'
        }}>
        <Column full justifyCenter>
          <Text text={`${t('inputs')}: (${inputInfos.length})`} mb="sm" color="textDim" />

          {decodedPsbt.inputInfos.map((v, index) => {
            return (
              <InputItem
                key={index}
                inputInfo={v}
                index={index}
                decodedPsbt={decodedPsbt}
                setContractPopoverData={setContractPopoverData}
                toSignData={toSignData}
                runesPriceMap={runesPriceMap}
              />
            );
          })}
        </Column>
      </Card>
    </Column>
  );
}
