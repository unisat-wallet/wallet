import { IMAGE_SOURCE_MAP } from '@/shared/constant';
import { Card, Column, Icon, Image, Row, Text } from '@/ui/components';
import { BtcUsd } from '@/ui/components/BtcUsd';
import { shortAddress, shortDesc } from '@/ui/utils';
import { bnUtils, numUtils } from '@unisat/base-utils';
import { DecodedPsbt, PsbtActionDetail, PsbtActionDetailType } from '@unisat/wallet-shared';
import { ActionOverviewSectionProps, useActionOverviewSectionLogic, useBTCUnit, useI18n } from '@unisat/wallet-state';

function DetailItemRow({ detail, decodedPsbt }: { detail: PsbtActionDetail; decodedPsbt: DecodedPsbt }) {
  const btcUnit = useBTCUnit();
  const { t } = useI18n();
  const LabelCom = (
    <Text
      text={detail.label}
      preset="regular"
      color="textDim"
      size="sm"
      style={{
        maxWidth: 100
      }}
    />
  );
  try {
    if (detail.type === PsbtActionDetailType.ADDRESS) {
      return (
        <Row justifyBetween>
          {LabelCom}
          <Text
            text={shortAddress(detail.value.toString())}
            preset={detail.highlight ? 'bold' : 'regular'}
            color={detail.warning ? 'warning' : detail.highlight ? 'gold' : 'white'}
            size="sm"
            style={{ maxWidth: 250, textAlign: 'right' }}
          />
        </Row>
      );
    } else if (detail.type === PsbtActionDetailType.RUNES) {
      const foundRune = decodedPsbt.inputInfos.find((v) => v.runes.find((rune) => rune.runeid === detail.value.runeid))!
        .runes[0];
      if (!foundRune) return null;
      return (
        <Row justifyBetween>
          {LabelCom}
          <Text
            text={shortDesc(
              `${bnUtils.toDecimalAmount(detail.value.runeAmount, foundRune.divisibility)} ${foundRune.spacedRune}`,
              30
            )}
            preset={detail.highlight ? 'bold' : 'regular'}
            color={detail.warning ? 'warning' : detail.highlight ? 'gold' : 'white'}
            size="sm"
            style={{ maxWidth: 250, textAlign: 'right' }}
          />
        </Row>
      );
    } else if (detail.type === PsbtActionDetailType.INSCRIPTION) {
      const foundInscription = decodedPsbt.inscriptions[detail.value];
      if (!foundInscription) return null;
      let title = '';
      let text = '';
      if (foundInscription.brc20 && foundInscription.brc20.op == 'transfer') {
        title = t('brc20');
        text = `${foundInscription.brc20.amt} ${foundInscription.brc20.tick}`;
      } else {
        title = t('spend_inscription');
        text = `#${foundInscription.inscriptionNumber}`;
      }
      return (
        <Row justifyBetween>
          <Text
            text={title}
            preset="regular"
            color="textDim"
            size="sm"
            style={{
              maxWidth: 100
            }}
          />
          <Text
            text={text}
            preset={detail.highlight ? 'bold' : 'regular'}
            color={detail.warning ? 'warning' : detail.highlight ? 'gold' : 'white'}
            size="sm"
            style={{ maxWidth: 250, textAlign: 'right' }}
          />
        </Row>
      );
    } else if (detail.type === PsbtActionDetailType.ALKANES) {
      const foundAlkanes = decodedPsbt.inputInfos.find((v) =>
        v.alkanes.find((rune) => rune.alkaneid === detail.value.alkaneid)
      )!.alkanes[0];
      let text = `${bnUtils.toDecimalAmount(detail.value.amount, foundAlkanes.divisibility)} ${foundAlkanes.name} `;
      if (detail.value.type === 'nft') {
        text = `${foundAlkanes.name}`;
      }
      return (
        <Row justifyBetween>
          {LabelCom}
          <Text
            text={text}
            preset={detail.highlight ? 'bold' : 'regular'}
            color={detail.warning ? 'warning' : detail.highlight ? 'gold' : 'white'}
            size="sm"
            style={{ maxWidth: 250, textAlign: 'right' }}
          />
        </Row>
      );
    } else if (detail.type === PsbtActionDetailType.SATOSHIS) {
      return (
        <Row justifyBetween>
          {LabelCom}
          <Row>
            <Text
              text={`${numUtils.satoshisToAmount(detail.value as number)} ${btcUnit}`}
              preset={detail.highlight ? 'bold' : 'regular'}
              color={detail.warning ? 'warning' : detail.highlight ? 'gold' : 'white'}
              size="sm"
              style={{ maxWidth: 250, textAlign: 'right' }}
            />
            <Row justifyCenter>
              <BtcUsd sats={Math.abs(detail.value as number)} bracket />
            </Row>
          </Row>
        </Row>
      );
    } else if (detail.type === PsbtActionDetailType.MULTIASSETS) {
      return (
        <Row justifyBetween>
          {LabelCom}
          <Column>
            {detail.value.inscriptionCount > 0 && (
              <Text
                text={`${detail.value.inscriptionCount} ${t('inscriptions')}`}
                preset={detail.highlight ? 'bold' : 'regular'}
                color={detail.warning ? 'warning' : detail.highlight ? 'gold' : 'white'}
                size="sm"
                style={{ maxWidth: 250, textAlign: 'right', marginRight: 8 }}
              />
            )}
            {detail.value.brc20Count > 0 && (
              <Text
                text={`${detail.value.brc20Count} brc-20`}
                preset={detail.highlight ? 'bold' : 'regular'}
                color={detail.warning ? 'warning' : detail.highlight ? 'gold' : 'white'}
                size="sm"
                style={{ maxWidth: 250, textAlign: 'right', marginRight: 8 }}
              />
            )}
            {detail.value.runesCount > 0 && (
              <Text
                text={`${detail.value.runesCount} ${t('runes')}`}
                preset={detail.highlight ? 'bold' : 'regular'}
                color={detail.warning ? 'warning' : detail.highlight ? 'gold' : 'white'}
                size="sm"
                style={{ maxWidth: 250, textAlign: 'right', marginRight: 8 }}
              />
            )}
            {detail.value.alkanesCount > 0 && (
              <Text
                text={`${detail.value.alkanesCount} ${t('alkanes')}`}
                preset={detail.highlight ? 'bold' : 'regular'}
                color={detail.warning ? 'warning' : detail.highlight ? 'gold' : 'white'}
                size="sm"
                style={{ maxWidth: 250, textAlign: 'right' }}
              />
            )}
          </Column>
        </Row>
      );
    } else {
      return (
        <Row justifyBetween>
          {LabelCom}
          <Row>
            <Text
              text={shortAddress(detail.value.toString(), 12)}
              preset={detail.highlight ? 'bold' : 'regular'}
              color={detail.warning ? 'warning' : detail.highlight ? 'gold' : 'white'}
              size="sm"
              style={{ maxWidth: 250, textAlign: 'right' }}
            />
          </Row>
        </Row>
      );
    }
  } catch (e) {
    console.error('DetailItemRow render error:', e);
    return null;
  }
}

export default function ActionOverviewSection(props: ActionOverviewSectionProps) {
  const { action, decodedPsbt, chain, commonDetails } = useActionOverviewSectionLogic(props);
  return (
    <Card
      style={{
        background: 'linear-gradient(135deg, rgba(235, 185, 76, 0.1) 0%, rgba(235, 185, 76, 0.05) 100%)',
        border: '1px solid rgba(235, 185, 76, 0.2)',
        borderRadius: 12
      }}>
      <Column gap="lg" fullX>
        <Row itemsCenter gap="md" justifyBetween>
          {action.icon && <Icon icon={action.icon as any} size={20} color="gold" />}
          <Text
            text={action.name}
            preset="title-bold"
            size="md"
            color="gold"
            style={{
              maxWidth: 200
            }}
          />

          <Row itemsCenter>
            <Image src={IMAGE_SOURCE_MAP[chain.icon]} size={24} />
            <Text text={chain.label} />
          </Row>
        </Row>

        {action.description && <Text text={action.description} preset="regular" color="white" wrap />}

        {action.details && action.details.length > 0 && (
          <Row
            style={{
              borderBottomWidth: 1,
              borderBottomColor: 'rgba(235, 185, 76, 0.1)'
            }}></Row>
        )}

        {action.details && action.details.length > 0 && (
          <Column gap="sm" fullX>
            {action.details.map((detail, index) => (
              <DetailItemRow key={index} detail={detail} decodedPsbt={decodedPsbt} />
            ))}
          </Column>
        )}

        {commonDetails.length > 0 && (
          <Row
            style={{
              borderBottomWidth: 1,
              borderBottomColor: 'rgba(235, 185, 76, 0.1)'
            }}></Row>
        )}
        {commonDetails.map((detail, index) => (
          <DetailItemRow key={index} detail={detail} decodedPsbt={decodedPsbt} />
        ))}
      </Column>
    </Card>
  );
}
