import { Button, Column, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import type { RgbFeePoolRequirement } from '@unisat/wallet-state';

const formatSats = (value: number) => `${value.toLocaleString()} sats`;

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Row justifyBetween fullX gap="md">
      <Text text={label} color="white_muted2" size="sm" />
      <Text text={value} color="white" size="sm" />
    </Row>
  );
}

export function RGBFeePoolInfoModal({
  requirement,
  onClose,
  t
}: {
  requirement: RgbFeePoolRequirement;
  onClose: () => void;
  t: (key: string, substitutions?: string | string[] | Record<string, string | number>) => string;
}) {
  return (
    <BottomModal onClose={onClose}>
      <Column gap="lg">
        <Text text={t('rgb_fee_pool_title')} color="white" size="lg" textCenter />
        <Text
          text={t('rgb_fee_pool_explanation', { count: requirement.feePoolUtxoCount })}
          color="white_muted2"
          size="sm"
          wrap
        />
        <Column
          gap="md"
          fullX
          style={{ padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.06)' }}>
          <DetailRow label={t('rgb_fee_pool_reusable_funds')} value={formatSats(requirement.topUpSatoshis)} />
          <DetailRow label={t('estimated_fee')} value={formatSats(requirement.estimatedFeeSatoshis)} />
          <DetailRow label={t('available')} value={formatSats(requirement.availableSatoshis)} />
          <DetailRow label={t('rgb_fee_pool_add_at_least')} value={formatSats(requirement.missingSatoshis)} />
        </Column>
        <Button preset="primary" text={t('close')} onClick={onClose} />
      </Column>
    </BottomModal>
  );
}
