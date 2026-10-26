import { Button, Card, Column, Text } from '@/ui/components';
import { DecodedPsbt, TickPriceItem, ToSignData } from '@unisat/wallet-shared';
import { useI18n } from '@unisat/wallet-state';

import { InputItem } from './InputItem';
import { useIncrementalList } from './useIncrementalList';

export function InputsList({
  toSignData,
  decodedPsbt,
  runesPriceMap,
  resetKey,
  setContractPopoverData
}: {
  toSignData: ToSignData;
  decodedPsbt: DecodedPsbt;
  runesPriceMap: { [key: string]: TickPriceItem } | undefined;
  resetKey: string;
  setContractPopoverData: (data: any) => void;
}) {
  const { t } = useI18n();
  const inputInfos = decodedPsbt.inputInfos;
  const { visibleItems, visibleCount, nextLoadCount, hasMore, loadMore } = useIncrementalList(inputInfos, resetKey);

  return (
    <Column>
      <Card
        mt="sm"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.06)'
        }}
      >
        <Column full justifyCenter>
          <Text text={`${t('inputs')}: (${inputInfos.length})`} mb="sm" color="textDim" />

          {visibleItems.map((v, index) => {
            return (
              <InputItem
                key={`${(v as any).txid || 'input'}-${index}`}
                inputInfo={v}
                index={index}
                decodedPsbt={decodedPsbt}
                setContractPopoverData={setContractPopoverData}
                toSignData={toSignData}
                runesPriceMap={runesPriceMap}
              />
            );
          })}

          {hasMore && (
            <Button
              mt="md"
              preset="default"
              text={`${t('load_more_items', { count: nextLoadCount })} (${visibleCount}/${inputInfos.length})`}
              onClick={loadMore}
            />
          )}
        </Column>
      </Card>
    </Column>
  );
}
