import { Card, Column, Grid, Row } from '@/ui/components';
import { spacing } from '@/ui/theme/spacing';

import AlkanesNFTPreview from '@/ui/components/AlkanesNFTPreview';
import { AlkaneBalance } from '@/ui/components/AlkanesPreviewCard';
import AlkanesPreviewCard from '@/ui/components/AlkanesPreviewCard/AlkanesPreviewCard';
import AssetTag from '@/ui/components/AssetTag';
import BRC20Preview from '@/ui/components/BRC20Preview';
import InscriptionPreview from '@/ui/components/InscriptionPreview';
import { Popover } from '@/ui/components/Popover';
import RunesPreviewCard from '@/ui/components/RunesPreviewCard';
import { colors } from '@/ui/theme/colors';
import { DecodedPsbt, RuneBalance, TickPriceItem } from '@unisat/wallet-shared';
import { useBTCUnit, useI18n } from '@unisat/wallet-state';
import { useState } from 'react';
import AssetCard from './AssetCard';
import InfoCard from './InfoCard';
import { SignPsbtSection } from './Section';

interface AssetOverviewSectionProps {
  decodedPsbt: DecodedPsbt;
  runesPriceMap?: { [key: string]: TickPriceItem };
  brc20PriceMap?: { [key: string]: TickPriceItem };
  networkFee: any;
}

export default function AssetOverviewSection({
  decodedPsbt,
  networkFee,
  runesPriceMap,
  brc20PriceMap
}: AssetOverviewSectionProps) {
  const btcUnit = useBTCUnit();
  const { t } = useI18n();

  const getFeeRateStatus = () => {
    if (!decodedPsbt.shouldWarnFeeRate) return 'default';
    return decodedPsbt.recommendedFeeRate > decodedPsbt.feeRate ? 'warning' : 'error';
  };

  const title = t('transaction_overview');

  const showNetworkFee = decodedPsbt.isCompleted == true;

  const [selectedAssetType, setSelectedAssetType] = useState<string | null>(null);

  const inscriptionArray = Object.values(decodedPsbt.inscriptions);

  let ordinalsInscriptionCount = decodedPsbt.inputInfos.reduce((pre, cur) => cur.inscriptions?.length + pre, 0);

  const alkanesCount = decodedPsbt.inputInfos.reduce((pre, cur) => (cur.alkanes ? cur.alkanes.length : 0) + pre, 0);
  const runesCount = decodedPsbt.inputInfos.reduce((pre, cur) => (cur.runes ? cur.runes.length : 0) + pre, 0);

  const brc20Array: { tick: string; amt: string; inscriptionNumber: number; preview: string }[] = [];
  decodedPsbt.inputInfos.forEach((v) => {
    v.inscriptions.forEach((w) => {
      const inscriptionInfo = decodedPsbt.inscriptions[w.inscriptionId];
      if (inscriptionInfo.brc20 && inscriptionInfo.brc20.op == 'transfer') {
        brc20Array.push({
          tick: inscriptionInfo.brc20.tick,
          amt: inscriptionInfo.brc20.amt,
          inscriptionNumber: w.inscriptionNumber,
          preview: inscriptionInfo.preview
        });
        ordinalsInscriptionCount -= 1;
      }
    });
  });
  const brc20Count = brc20Array.length;

  const runesArray: RuneBalance[] = [];
  decodedPsbt.inputInfos.forEach((v) => {
    if (v.runes) {
      v.runes.forEach((w) => {
        runesArray.push(w);
      });
    }
  });

  const alkanesArray: AlkaneBalance[] = [];
  decodedPsbt.inputInfos.forEach((v) => {
    if (v.alkanes) {
      v.alkanes.forEach((w) => {
        alkanesArray.push(w);
      });
    }
  });

  const handleAssetClick = (type: 'Inscription' | 'BRC20' | 'Runes' | 'Alkanes') => {
    setSelectedAssetType(type);
  };

  const assetCards: any[] = [];
  if (ordinalsInscriptionCount > 0) {
    assetCards.push(
      <AssetCard
        key="inscription"
        type="Inscription"
        count={ordinalsInscriptionCount}
        onClick={() => handleAssetClick('Inscription')}
      />
    );
  }

  if (brc20Count > 0) {
    assetCards.push(
      <AssetCard key="brc20" type="BRC20" count={brc20Count} onClick={() => handleAssetClick('BRC20')} />
    );
  }

  if (runesCount > 0) {
    assetCards.push(
      <AssetCard key="runes" type="Runes" count={runesCount} onClick={() => handleAssetClick('Runes')} />
    );
  }

  if (alkanesCount > 0) {
    assetCards.push(
      <AssetCard key="alkanes" type="Alkanes" count={alkanesCount} onClick={() => handleAssetClick('Alkanes')} />
    );
  }

  const renderAssetDetails = () => {
    if (!selectedAssetType) return null;

    const renderAssetSection = (title: string, assetTag: React.ReactNode, content: React.ReactNode) => (
      <Column
        fullX
        px="md"
        pt="md"
        pb="md"
        style={{
          backgroundColor: '#1e1a1e',
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.border,
          marginBottom: spacing.medium
        }}>
        <Row style={{ marginBottom: spacing.small }}>{assetTag}</Row>
        <Row overflowX>{content}</Row>
      </Column>
    );

    switch (selectedAssetType) {
      case 'Inscription':
        return renderAssetSection(
          'Inscriptions',
          <AssetTag type="Inscription" />,
          inscriptionArray
            .filter((v) => !v.brc20 || v.brc20.op != 'transfer')
            .map((inscription, index) => (
              <Row style={{ width: 120 }} key={'inscription_' + index}>
                <InscriptionPreview data={inscription} preset="small" />
              </Row>
            ))
        );

      case 'BRC20':
        return renderAssetSection(
          'BRC20 Tokens',
          <AssetTag type="brc-20" />,
          brc20Array.map((w) => (
            <BRC20Preview
              //   preset="small"
              key={w.tick}
              tick={w.tick || ''}
              balance={w.amt}
              type="TRANSFER"
              inscriptionNumber={w.inscriptionNumber}
              onClick={() => window.open(w.preview)}
              priceInProps={true}
              price={brc20PriceMap?.[w.tick]}
            />
          ))
        );

      case 'Runes':
        return renderAssetSection(
          'Runes',
          <AssetTag type="Runes" />,
          runesArray.map((w, index) => (
            <RunesPreviewCard key={'runes_' + index} balance={w} price={runesPriceMap?.[w.spacedRune]} />
          ))
        );
      case 'Alkanes':
        return renderAssetSection(
          'Alkanes',
          <AssetTag type="Alkanes" />,
          alkanesArray.map((v) => {
            const alkanesInfo = v as any;
            if (alkanesInfo.type === 'nft') {
              return <AlkanesNFTPreview key={v.alkaneid} alkanesInfo={alkanesInfo} preset="small" />;
            } else {
              return <AlkanesPreviewCard key={v.alkaneid} balance={alkanesInfo} />;
            }
          })
        );
      default:
        return null;
    }
  };

  if (showNetworkFee === false && assetCards.length === 0) {
    return null;
  }

  return (
    <SignPsbtSection title={title}>
      <Card
        mt="zero"
        style={{
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.2)',
          borderRadius: 12
        }}>
        <Column gap="sm" fullX>
          <Grid
            columns={2}
            style={{
              gap: 12,
              width: '100%'
            }}>
            {showNetworkFee && (
              <InfoCard title={t('network_fee')} value={networkFee.toString()} subtitle={btcUnit} icon="fee" />
            )}

            {showNetworkFee && (
              <InfoCard
                title={t('fee_rate')}
                value={decodedPsbt.feeRate.toString()}
                subtitle="sat/vB"
                icon="speed"
                status={getFeeRateStatus()}
                iconColor={
                  getFeeRateStatus() === 'warning' ? '#FFC107' : getFeeRateStatus() === 'error' ? '#F44336' : undefined
                }
              />
            )}

            {assetCards.map((card, index) => (
              <Row key={index}>{card}</Row>
            ))}
          </Grid>
        </Column>
      </Card>
      {selectedAssetType && (
        <Popover
          onClose={() => {
            setSelectedAssetType(null);
          }}>
          <Row style={{ maxHeight: 400 }} mt="xl">
            {renderAssetDetails()}
          </Row>
        </Popover>
      )}
    </SignPsbtSection>
  );
}
