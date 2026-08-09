import { useState } from 'react';

import { colors } from '@/ui/theme/colors';
import { DecodedPsbt, Risk, RiskType } from '@unisat/wallet-shared';
import { useI18n } from '@unisat/wallet-state';

import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { Column } from '../Column';
import { Icon } from '../Icon';
import { Popover } from '../Popover';
import { Row } from '../Row';
import { Text } from '../Text';
import { BadFeeRate } from './BadFeeRate';
import { ChangingInscription } from './ChangingInscription';
import { InscriptionBurning } from './InscriptionBurning';
import { BurningAssetsCarousel, MultipleAssetsCarousel, MultipleAssetsList } from './MultipleAssetsList';
import { RunesBurningList } from './RunesBurningList';

const riskPopoverStyle = {
  width: 343,
  boxSizing: 'border-box' as const,
  padding: '24px 16px',
  borderRadius: 12,
  backgroundColor: '#181A1F'
};

const riskCardStyle = {
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 8,
  overflow: 'hidden'
};

const riskCardHeaderStyle = {
  minHeight: 36,
  padding: '0 8px'
};

function IndexingRiskContent({ text }: { text: string }) {
  const duration = 'about 5 minutes.';
  const durationIndex = text.indexOf(duration);
  const descriptionStyle = {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 12,
    lineHeight: '16px',
    padding: '0 8px 8px'
  };

  if (durationIndex === -1) {
    return <div style={descriptionStyle}>{text}</div>;
  }

  return (
    <div style={descriptionStyle}>
      {text.slice(0, durationIndex)}
      <span style={{ color: 'rgba(244, 182, 44, 0.85)' }}>{duration}</span>
      {text.slice(durationIndex + duration.length)}
    </div>
  );
}

function IndexingRiskIcon() {
  return (
    <>
      <div
        aria-hidden
        style={{
          width: 16,
          height: 16,
          border: '2px solid #F55454',
          borderBottomColor: 'transparent',
          borderRadius: '50%',
          boxSizing: 'border-box',
          animation: 'utxo-indexing-spin 1s linear infinite'
        }}
      />
      <style>{'@keyframes utxo-indexing-spin { to { transform: rotate(360deg); } }'}</style>
    </>
  );
}

const visibleRiskDetailTypes = [
  RiskType.MULTIPLE_ASSETS,
  RiskType.RUNES_MULTIPLE_ASSETS,
  RiskType.ALKANES_MULTIPLE_ASSETS,
  RiskType.INSCRIPTION_BURNING,
  RiskType.ATOMICALS_FT_BURNING,
  RiskType.ATOMICALS_NFT_BURNING,
  RiskType.LOW_FEE_RATE,
  RiskType.HIGH_FEE_RATE,
  //   RiskType.SPLITTING_INSCRIPTIONS,
  //   RiskType.MERGING_INSCRIPTIONS,
  RiskType.CHANGING_INSCRIPTION,
  RiskType.RUNES_BURNING
];

function getRiskContentKey(riskType: RiskType) {
  switch (riskType) {
    case RiskType.SIGHASH_NONE:
      return {
        title: 'sighash_none_risk_title',
        description: 'sighash_none_risk_description'
      };
    case RiskType.SIGHASH_SINGLE:
      return {
        title: 'sighash_single_risk_title',
        description: 'sighash_single_risk_description'
      };
    case RiskType.SCAMMER_ADDRESS:
      return {
        title: 'scammer_address_risk_title',
        description: 'scammer_address_risk_description'
      };
    case RiskType.NETWORK_NOT_MATCHED:
      return {
        title: 'network_not_matched_risk_title',
        description: 'network_not_matched_risk_description'
      };
    case RiskType.INSCRIPTION_BURNING:
      return {
        title: 'inscription_burning_risk_title',
        description: 'inscription_burning_risk_description'
      };
    case RiskType.MULTIPLE_ASSETS:
      return {
        title: 'multiple_assets_risk_title',
        description: 'multiple_assets_risk_description'
      };
    case RiskType.HIGH_FEE_RATE:
      return {
        title: 'high_fee_rate_risk_title',
        description: 'high_fee_rate_risk_description'
      };
    case RiskType.MERGING_INSCRIPTIONS:
      return {
        title: 'merging_inscriptions_risk_title',
        description: 'merging_inscriptions_risk_description'
      };
    case RiskType.CHANGING_INSCRIPTION:
      return {
        title: 'changing_inscription_risk_title',
        description: 'changing_inscription_risk_description'
      };
    case RiskType.RUNES_BURNING:
      return {
        title: 'runes_burning_risk_title',
        description: 'runes_burning_risk_description'
      };
    case RiskType.RUNES_MULTIPLE_ASSETS:
      return {
        title: 'runes_multiple_assets_risk_title',
        description: 'runes_multiple_assets_risk_description'
      };
    case RiskType.INDEXER_API_DOWN:
      return {
        title: 'indexer_api_down_risk_title',
        description: 'indexer_api_down_risk_description'
      };
    case RiskType.RUNES_API_DOWN:
      return {
        title: 'runes_api_down_risk_title',
        description: 'runes_api_down_risk_description'
      };
    case RiskType.ALKANES_BURNING:
      return {
        title: 'alkanes_burning_risk_title',
        description: 'alkanes_burning_risk_description'
      };
    case RiskType.ALKANES_MULTIPLE_ASSETS:
      return {
        title: 'alkanes_multiple_assets_risk_title',
        description: 'alkanes_multiple_assets_risk_description'
      };
    case RiskType.UTXO_INDEXING:
      return {
        title: 'utxo_indexing_risk_title',
        description: 'utxo_indexing_risk_description'
      };
    default:
      return {
        title: 'unknown_risk_title',
        description: 'unknown_risk_description'
      };
  }
}

export const SignPsbtWithRisksPopover = ({
  decodedPsbt,
  onConfirm,
  onClose
}: {
  decodedPsbt: DecodedPsbt;
  onConfirm: () => void;
  onClose: () => void;
}) => {
  const [risksAccepted, setRisksAccepted] = useState(false);
  const { t } = useI18n();

  const [detailRisk, setDetailRisk] = useState<Risk | null>();

  if (detailRisk) {
    if (detailRisk.type === RiskType.INSCRIPTION_BURNING) {
      return <InscriptionBurning decodedPsbt={decodedPsbt} onClose={() => setDetailRisk(null)} />;
    } else if (
      detailRisk.type === RiskType.MULTIPLE_ASSETS ||
      detailRisk.type === RiskType.RUNES_MULTIPLE_ASSETS ||
      detailRisk.type === RiskType.ALKANES_MULTIPLE_ASSETS
    ) {
      return <MultipleAssetsList decodedPsbt={decodedPsbt} onClose={() => setDetailRisk(null)} />;
    } else if (detailRisk.type === RiskType.LOW_FEE_RATE || detailRisk.type === RiskType.HIGH_FEE_RATE) {
      const riskContentKey = getRiskContentKey(detailRisk.type);
      return (
        <BadFeeRate decodedPsbt={decodedPsbt} riskContentKey={riskContentKey} onClose={() => setDetailRisk(null)} />
      );
    } else if (detailRisk.type === RiskType.CHANGING_INSCRIPTION) {
      return <ChangingInscription decodedPsbt={decodedPsbt} onClose={() => setDetailRisk(null)} />;
    } else if (detailRisk.type === RiskType.RUNES_BURNING) {
      return <RunesBurningList decodedPsbt={decodedPsbt} onClose={() => setDetailRisk(null)} />;
    }
  }

  const hasCriticalRisk = decodedPsbt.risks.some((risk) => risk.level === 'critical');

  return (
    <Popover
      onClose={onClose}
      contentStyle={riskPopoverStyle}
      closeStyle={{ top: 24, right: 16 }}
      data-testid="risks-popover">
      <Column fullX gap="xl">
        <Column fullX gap="lg">
          <Text text={t('use_at_your_own_risk')} size="md" style={{ fontWeight: 600 }} textCenter />
          <Text
            text={
              decodedPsbt.risks.length > 1
                ? t('multiple_risks_detected_description')
                : t('please_be_aware_that_sending_the_following_assets_involves_risk')
            }
            preset="sub"
            style={{ color: 'rgba(255, 255, 255, 0.65)', lineHeight: '16px' }}
          />
        </Column>

        <Column fullX gap="lg">
          {decodedPsbt.risks.map((risk, index) => {
            const riskContentKey = getRiskContentKey(risk.type);
            const isIndexingRisk = risk.type === RiskType.UTXO_INDEXING;
            const title = isIndexingRisk
              ? t('utxo_indexing_in_progress')
              : riskContentKey.title
              ? t(riskContentKey.title)
              : risk.title;
            const desc = riskContentKey.description ? t(riskContentKey.description) : risk.desc;
            const isMultipleAssetsRisk = [
              RiskType.MULTIPLE_ASSETS,
              RiskType.RUNES_MULTIPLE_ASSETS,
              RiskType.ALKANES_MULTIPLE_ASSETS
            ].includes(risk.type);
            const isBurningRisk =
              risk.type === RiskType.INSCRIPTION_BURNING ||
              risk.type === RiskType.RUNES_BURNING ||
              risk.type === RiskType.ALKANES_BURNING;

            return (
              <Column key={'risk_' + index} fullX gap="zero" style={riskCardStyle}>
                <Row fullX justifyBetween itemsCenter style={riskCardHeaderStyle}>
                  <Row itemsCenter gap="md" style={{ minWidth: 0 }}>
                    {isIndexingRisk ? <IndexingRiskIcon /> : <Icon icon="alert" color="red_light2" size={16} />}
                    <Text text={title} size="xs" color={risk.level === 'warning' ? 'warning' : 'danger'} />
                  </Row>
                  {visibleRiskDetailTypes.includes(risk.type) ? (
                    <Row
                      itemsCenter
                      gap="md"
                      onClick={() => {
                        setDetailRisk(risk);
                      }}>
                      <Text text={t('view')} preset="sub" style={{ color: 'rgba(255, 255, 255, 0.65)' }} />
                      <Icon icon="right" size={10} color="white_muted" />
                    </Row>
                  ) : null}
                </Row>
                <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.15)' }} />
                {isIndexingRisk ? (
                  <IndexingRiskContent text={desc} />
                ) : isMultipleAssetsRisk ? (
                  <MultipleAssetsCarousel decodedPsbt={decodedPsbt} />
                ) : isBurningRisk ? (
                  <BurningAssetsCarousel decodedPsbt={decodedPsbt} riskType={risk.type} />
                ) : (
                  <Text
                    text={desc}
                    preset="sub"
                    style={{ color: 'rgba(255, 255, 255, 0.65)', lineHeight: '16px', padding: '8px' }}
                  />
                )}
              </Column>
            );
          })}
        </Column>

        {!hasCriticalRisk && (
          <Checkbox
            checked={risksAccepted}
            checkedColor={colors.red}
            checkColor={colors.white}
            style={{ alignSelf: 'stretch', alignItems: 'flex-start' }}
            data-testid="risks-checkbox"
            onChange={(e) => setRisksAccepted(e.target.checked)}>
            <Text
              text={t('understand_and_accept_the_risks_associated_with_this_transaction')}
              preset="sub"
              style={{ color: 'rgba(255, 255, 255, 0.65)', flex: 1 }}
            />
          </Checkbox>
        )}

        <Column fullX gap="md">
          {!hasCriticalRisk && (
            <Button
              text={t('understand_the_risks_continue')}
              preset="delete"
              disabled={!risksAccepted}
              full
              onClick={() => {
                onConfirm();
              }}
            />
          )}
          <Button text={t('try_again_later')} preset="primary" full onClick={onClose} />
        </Column>
      </Column>
    </Popover>
  );
};
