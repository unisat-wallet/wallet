import { Button, Column, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';

/** Explicit confirmation prevents a read-only device from silently fencing an active writer. */
export function RgbWriteLeaseModal({
  expiresAt,
  loading,
  onClose,
  onTakeover
}: {
  expiresAt?: number;
  loading?: boolean;
  onClose: () => void;
  onTakeover: () => void;
}) {
  const expires = expiresAt ? new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <BottomModal onClose={loading ? undefined : onClose}>
      <Column gap="lg">
        <Text text="RGB wallet in use" color="white" size="lg" textCenter />
        <Text
          text={
            expires
              ? `Another device is writing to this RGB wallet until about ${expires}. You can still view assets and activity.`
              : 'Another device is writing to this RGB wallet. You can still view assets and activity.'
          }
          color="white_muted2"
          size="sm"
          wrap
        />
        <Text
          text="Take over only after the other device has stopped. Its in-flight RGB operation will be rejected."
          color="gold"
          size="xs"
          wrap
        />
        <Row gap="sm" fullX>
          <Button text="Keep read-only" preset="default" disabled={loading} onClick={onClose} style={{ flex: 1 }} />
          <Button text={loading ? 'Taking over...' : 'Take over'} preset="primary" disabled={loading} onClick={onTakeover} style={{ flex: 1 }} />
        </Row>
      </Column>
    </BottomModal>
  );
}
