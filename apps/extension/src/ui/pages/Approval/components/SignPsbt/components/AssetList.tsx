import { Column, Row, Text } from '@/ui/components';
import AlkanesNFTPreview from '@/ui/components/AlkanesNFTPreview';
import AlkanesPreviewCard from '@/ui/components/AlkanesPreviewCard/AlkanesPreviewCard';
import BRC20Preview from '@/ui/components/BRC20Preview';
import InscriptionPreview from '@/ui/components/InscriptionPreview';
import RunesPreviewCard from '@/ui/components/RunesPreviewCard';
import {
  AlkanesBalance,
  AlkanesInfo,
  DecodedPsbt,
  Inscription,
  RuneBalance,
  TickPriceItem
} from '@unisat/wallet-shared';
import { useI18n } from '@unisat/wallet-state';

export function AssetList({
  inscriptions,
  decodedPsbt,
  isToSign,
  brc20List,
  runes,
  runesPriceMap,
  brc20PriceMap,
  alkanes,
  isMyAddress
}: {
  inscriptions: Inscription[];
  brc20List: { tick: string; amt: string; inscriptionNumber: number; preview: string }[];
  decodedPsbt: DecodedPsbt;
  isToSign: boolean;
  runes: RuneBalance[];
  runesPriceMap: { [key: string]: TickPriceItem } | undefined;
  brc20PriceMap?: { [key: string]: TickPriceItem };
  alkanes: (AlkanesBalance & AlkanesInfo)[];
  isMyAddress: boolean;
}) {
  const { t } = useI18n();

  const textColor = isToSign ? 'white' : isMyAddress ? 'white' : 'textDim';

  return (
    <>
      {inscriptions.length > 0 && (
        <Row>
          <Column justifyCenter>
            <Text text={`${t('inscriptions')} (${inscriptions.length})`} color={textColor} />
            <Row overflowX gap="lg" style={{ width: 280 }} pb="lg">
              {inscriptions.map((w) => (
                <InscriptionPreview
                  key={w.inscriptionId}
                  data={decodedPsbt.inscriptions[w.inscriptionId]}
                  preset="xs"
                  hideValue
                />
              ))}
            </Row>
          </Column>
        </Row>
      )}

      {brc20List.length > 0 && (
        <Row>
          <Column justifyCenter>
            <Text text={t('brc20')} color={textColor} />
            <Row overflowX gap="lg" style={{ width: 280 }} pb="lg" mt="sm">
              {brc20List.map((w) => (
                <BRC20Preview
                  key={w.tick}
                  tick={w.tick}
                  balance={w.amt}
                  type="TRANSFER"
                  inscriptionNumber={w.inscriptionNumber}
                  price={brc20PriceMap?.[w.tick]}
                />
              ))}
            </Row>
          </Column>
        </Row>
      )}
      {runes.length > 0 && (
        <Row>
          <Column justifyCenter>
            <Text text={t('runes')} color={textColor} />
            <Row overflowX gap="lg" style={{ width: 280 }} pb="lg" mt="sm">
              {runes.map((w) => (
                <RunesPreviewCard key={w.runeid} balance={w} price={runesPriceMap?.[w.spacedRune]} />
              ))}
            </Row>
          </Column>
        </Row>
      )}

      {alkanes.length > 0 && (
        <Row>
          <Column justifyCenter>
            <Text text={t('alkanes')} color={textColor} />
            <Row overflowX gap="lg" style={{ width: 280 }} pb="lg" mt="sm">
              {alkanes.map((v) => {
                if (v.type === 'nft') {
                  return <AlkanesNFTPreview key={v.alkaneid} alkanesInfo={v} preset="small" />;
                } else {
                  return <AlkanesPreviewCard key={v.alkaneid} balance={v} />;
                }
              })}
            </Row>
          </Column>
        </Row>
      )}
    </>
  );
}
