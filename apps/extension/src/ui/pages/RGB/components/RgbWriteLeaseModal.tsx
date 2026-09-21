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
        <Text text="Another device is using RGB" color="white" size="lg" textCenter />
        <Text
          text={
            expires
              ? `It currently holds this wallet's RGB write permission until about ${expires}. You can still safely view assets and activity here.`
              : 'It currently holds this wallet\'s RGB write permission. You can still safely view assets and activity here.'
          }
          color="white_muted2"
          size="sm"
          wrap
        />
        <Text
          text="Only take over after the other device has stopped. Taking over immediately blocks its in-progress Invoice, transfer, receive, release, or issuance operation; any unsynced operation there may fail and must be reopened after it syncs."
          color="gold"
          size="xs"
          wrap
        />
        <Row gap="sm" fullX>
          <Button text="Keep read-only" preset="default" disabled={loading} onClick={onClose} style={{ flex: 1 }} />
          <Button text={loading ? 'Taking over...' : 'Take over writing'} preset="primary" disabled={loading} onClick={onTakeover} style={{ flex: 1 }} />
        </Row>
      </Column>
    </BottomModal>
  );
}
