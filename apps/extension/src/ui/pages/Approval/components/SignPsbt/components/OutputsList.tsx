import { Button, Card, Column, Text } from '@/ui/components';
import { DecodedPsbt, TickPriceItem, ToSignData } from '@unisat/wallet-shared';
import { useI18n } from '@unisat/wallet-state';

import { InputItem } from './InputItem';
import { useIncrementalList } from './useIncrementalList';

export function OutputsList({
  decodedPsbt,
  toSignData,
  runesPriceMap,
  resetKey,
  setContractPopoverData
}: {
  decodedPsbt: DecodedPsbt;
  toSignData: ToSignData;
  runesPriceMap: { [key: string]: TickPriceItem } | undefined;
  resetKey: string;
  setContractPopoverData: (data: any) => void;
}) {
  const { t } = useI18n();
  const outputInfos = decodedPsbt.outputInfos;
  const { visibleItems, visibleCount, nextLoadCount, hasMore, loadMore } = useIncrementalList(outputInfos, resetKey);

  return (
    <Column>
      <Card
        mt="sm"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.06)'
        }}
      >
        <Column full justifyCenter>
          <Text text={`${t('outputs')}: (${outputInfos.length})`} mb="lg" color="textDim" />

          {visibleItems.map((v, index) => {
            return (
              <InputItem
                key={`${v.address || 'output'}-${index}`}
                outputInfo={v}
                index={index}
                decodedPsbt={decodedPsbt}
                toSignData={toSignData}
                runesPriceMap={runesPriceMap}
                setContractPopoverData={setContractPopoverData}
              />
            );
          })}

          {hasMore && (
            <Button
              mt="md"
              preset="default"
              text={`${t('load_more_items', { count: nextLoadCount })} (${visibleCount}/${outputInfos.length})`}
              onClick={loadMore}
            />
          )}
        </Column>
      </Card>
    </Column>
  );
}
