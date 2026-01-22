import { Column, Icon, Row, Text } from '@/ui/components';
import { AddressText } from '@/ui/components/AddressText';
import { colors } from '@/ui/theme/colors';
import { numUtils } from '@unisat/base-utils';
import {
  DecodedPsbt,
  DecodedPsbtInput,
  DecodedPsbtOutput,
  Inscription,
  TickPriceItem,
  ToSignData
} from '@unisat/wallet-shared';
import { useBTCUnit, useCurrentAddress, useI18n } from '@unisat/wallet-state';
import { AssetList } from './AssetList';
import ContractSection from './ContractSection';

export function InputItem(props: {
  index: number;
  inputInfo?: DecodedPsbtInput;
  outputInfo?: DecodedPsbtOutput;
  decodedPsbt: DecodedPsbt;
  toSignData?: ToSignData;
  brc20PriceMap?: Record<string, TickPriceItem>;
  runesPriceMap?: Record<string, TickPriceItem>;
  setContractPopoverData: (data: any) => void;
}) {
  const { index, inputInfo, outputInfo, decodedPsbt, toSignData } = props;
  const currentAddress = useCurrentAddress();
  const itemInfo = (inputInfo || outputInfo)!;

  const isToSign = inputInfo && toSignData!.toSignInputs.find((input) => input.index === index);
  const inscriptions: Inscription[] = [];
  const runes = itemInfo.runes || [];
  const alkanes = itemInfo.alkanes || [];
  const isMyAddress = itemInfo.address === currentAddress;
  const btcUnit = useBTCUnit();
  const { t } = useI18n();
  const highLightAddress = isToSign || isMyAddress;

  const brc20Array: { tick: string; amt: string; inscriptionNumber: number; preview: string }[] = [];
  itemInfo.inscriptions.forEach((w) => {
    const inscriptionInfo = decodedPsbt.inscriptions[w.inscriptionId];
    if (inscriptionInfo.brc20 && inscriptionInfo.brc20.op == 'transfer') {
      brc20Array.push({
        tick: inscriptionInfo.brc20.tick,
        amt: inscriptionInfo.brc20.amt,
        inscriptionNumber: w.inscriptionNumber,
        preview: inscriptionInfo.preview
      });
    } else {
      inscriptions.push(inscriptionInfo);
    }
  });

  return (
    <Row style={index === 0 ? {} : { borderColor: colors.border, borderTopWidth: 1, paddingTop: 10 }} itemsCenter>
      <Column fullX>
        <Row fullX mb="md">
          {inputInfo && <Icon icon="psbt_input" size={28} />}
          {outputInfo &&
            (outputInfo.address.startsWith('OP') ? (
              <Icon icon="psbt_opreturn" size={28} />
            ) : (
              <Icon icon="psbt_output" size={28} />
            ))}

          <Column>
            <Row>
              <Text
                text={`${numUtils.satoshisToAmount(itemInfo.value)} ${btcUnit}`}
                color={highLightAddress ? 'white' : 'textDim'}
              />
            </Row>

            <Row>
              <AddressText address={itemInfo.address} color={highLightAddress ? 'ticker_color2' : 'textDim'} />

              {isMyAddress && (
                <Row style={{ padding: 2, backgroundColor: colors.bg2, borderRadius: 5 }}>
                  <Text text={t('my_address')} color="white_muted2" size="xxs" />
                </Row>
              )}
              {itemInfo.contract && (
                <ContractSection contract={itemInfo.contract} setContractPopoverData={props.setContractPopoverData} />
              )}

              {isToSign && (
                <Row justifyEnd>
                  <Row style={{ borderWidth: 1, borderColor: 'gold', borderRadius: 5, padding: 2 }}>
                    <Text text={t('to_sign')} color="gold" size="xxs" />
                  </Row>
                </Row>
              )}
            </Row>
          </Column>
        </Row>

        <AssetList
          inscriptions={inscriptions.filter((v) => {
            return !(v.brc20 && v.brc20.op == 'transfer');
          })}
          brc20List={brc20Array}
          runes={runes}
          decodedPsbt={decodedPsbt}
          alkanes={alkanes as any}
          isToSign={!!isToSign}
          isMyAddress={currentAddress === itemInfo.address}
          runesPriceMap={props.runesPriceMap}
          brc20PriceMap={props.brc20PriceMap}
        />
      </Column>
    </Row>
  );
}
