import { Button, Column, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { useI18n } from '@unisat/wallet-state';

/** Explicit confirmation prevents a read-only device from silently fencing an active writer. */
export function RgbWriteLeaseModal({
  loading,
  onClose,
  onTakeover
}: {
  loading?: boolean;
  onClose: () => void;
  onTakeover: () => void;
}) {
  const { t } = useI18n();
  return (
    <BottomModal onClose={loading ? undefined : onClose}>
      <Column gap="lg">
        <Text text={t('rgb_another_device_active')} color="white" size="lg" textCenter />
        <Text
          text={t('rgb_write_permission_description')}
          color="white_muted2"
          size="sm"
          wrap
        />
        <Text
          text={t('rgb_takeover_warning')}
          color="gold"
          size="xs"
          wrap
        />
        <Row gap="sm" fullX>
          <Button text={t('rgb_keep_read_only')} preset="default" disabled={loading} onClick={onClose} style={{ flex: 1 }} />
          <Button text={t(loading ? 'rgb_taking_over' : 'rgb_take_over_writing')} preset="primary" disabled={loading} onClick={onTakeover} style={{ flex: 1 }} />
        </Row>
      </Column>
    </BottomModal>
  );
}
