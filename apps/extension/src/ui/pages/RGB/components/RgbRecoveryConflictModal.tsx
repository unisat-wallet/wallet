import { useCallback, useEffect, useState } from 'react';

import { Button, Column, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { useTools, useWallet } from '@unisat/wallet-state';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A recovery checkpoint conflict means the two invoice sets cannot safely be
 * merged. Keep the decision at the UI boundary; neither direction is ever
 * selected automatically by the background service.
 */
export function RgbRecoveryConflictModal() {
  const wallet = useWallet();
  const tools = useTools();
  const [conflicted, setConflicted] = useState(false);
  const [resolving, setResolving] = useState<'cloud' | 'local'>();

  const refreshStatus = useCallback(async () => {
    try {
      const status = await wallet.getRgbRecoveryCheckpointStatus();
      setConflicted(status.conflicted);
    } catch {
      // RGB is optional for some account types. Reads elsewhere retain their
      // own detailed error handling, so avoid a background toast here.
    }
  }, [wallet]);

  useEffect(() => {
    void refreshStatus();
    const interval = window.setInterval(() => void refreshStatus(), 15_000);
    return () => window.clearInterval(interval);
  }, [refreshStatus]);

  const resolve = useCallback(
    async (strategy: 'cloud' | 'local') => {
      setResolving(strategy);
      try {
        if (strategy === 'cloud') {
          await wallet.restoreLatestRgbRecoveryCheckpoint();
          tools.toastSuccess('Latest RGB cloud state restored');
        } else {
          await wallet.publishLocalRgbRecoveryConflictResolution();
          tools.toastSuccess('Local RGB state published to cloud');
        }
        await refreshStatus();
        window.dispatchEvent(new Event('rgb-recovery-resolved'));
      } catch (error) {
        tools.toastError(errorMessage(error));
      } finally {
        setResolving(undefined);
      }
    },
    [refreshStatus, tools, wallet]
  );

  if (!conflicted) return null;

  return (
    <BottomModal>
      <Column gap="lg">
        <Text text="RGB wallet state conflict" color="white" size="lg" textCenter />
        <Text
          text="This device and the cloud contain different RGB invoice state. They cannot be safely merged. Choose one state to keep."
          color="white_muted2"
          size="sm"
          wrap
        />
        <Column gap="xs">
          <Text text="1. Use latest cloud state" color="white" size="sm" />
          <Text
            text="Discard this device's unique invoices. Cloud data is not changed."
            color="textDim"
            size="xs"
            wrap
          />
        </Column>
        <Column gap="xs">
          <Text text="2. Keep local state and take over" color="white" size="sm" />
          <Text
            text="Immediately take the RGB write lease and replace cloud-only state with this device's invoices."
            color="danger"
            size="xs"
            wrap
          />
        </Column>
        <Text
          text="This choice cannot be undone. Check that no RGB send or receive is in progress on another device."
          color="gold"
          size="xs"
          wrap
        />
        <Row gap="sm" fullX>
          <Button
            text={resolving === 'cloud' ? 'Restoring...' : 'Use cloud state'}
            preset="default"
            disabled={Boolean(resolving)}
            onClick={() => void resolve('cloud')}
            style={{ flex: 1, minWidth: 0 }}
            max2Lines
          />
          <Button
            text={resolving === 'local' ? 'Publishing...' : 'Keep local & take over'}
            preset="danger"
            disabled={Boolean(resolving)}
            onClick={() => void resolve('local')}
            style={{ flex: 1, minWidth: 0 }}
            max2Lines
          />
        </Row>
      </Column>
    </BottomModal>
  );
}
