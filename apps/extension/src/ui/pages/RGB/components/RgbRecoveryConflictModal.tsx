import { useCallback, useEffect, useState } from 'react';

import { Button, Column, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { useI18n, useTools, useWallet } from '@unisat/wallet-state';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A recovery checkpoint conflict means the two invoice sets cannot safely be
 * merged. Keep the decision at the UI boundary; neither direction is ever
 * selected automatically by the background service.
 */
export function RgbRecoveryConflictModal({
  enabled = true,
  forceVisible = false,
  onClose,
  onResolved
}: {
  enabled?: boolean;
  forceVisible?: boolean;
  onClose?: () => void;
  onResolved?: () => void;
}) {
  const wallet = useWallet();
  const tools = useTools();
  const { t } = useI18n();
  const [conflicted, setConflicted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [resolving, setResolving] = useState<'cloud' | 'local'>();

  const close = useCallback(() => {
    setDismissed(true);
    onClose?.();
  }, [onClose]);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await wallet.getRgbRecoveryCheckpointStatus();
      setConflicted(status.conflicted);
      if (!status.conflicted) setDismissed(false);
    } catch {
      // RGB is optional for some account types. Reads elsewhere retain their
      // own detailed error handling, so avoid a background toast here.
    }
  }, [wallet]);

  useEffect(() => {
    if (!enabled) return;
    void refreshStatus();
    const interval = window.setInterval(() => void refreshStatus(), 15_000);
    return () => window.clearInterval(interval);
  }, [enabled, refreshStatus]);

  const resolve = useCallback(
    async (strategy: 'cloud' | 'local') => {
      setResolving(strategy);
      try {
        if (strategy === 'cloud') {
          await wallet.restoreLatestRgbRecoveryCheckpoint();
          tools.toastSuccess(t('rgb_cloud_state_restored'));
        } else {
          await wallet.publishLocalRgbRecoveryConflictResolution();
          tools.toastSuccess(t('rgb_local_state_published'));
        }
        await refreshStatus();
        window.dispatchEvent(new Event('rgb-recovery-resolved'));
        onResolved?.();
      } catch (error) {
        tools.toastError(errorMessage(error));
      } finally {
        setResolving(undefined);
      }
    },
    [onResolved, refreshStatus, t, tools, wallet]
  );

  if (!enabled || dismissed || (!forceVisible && !conflicted)) return null;

  return (
    <BottomModal
      onClose={
        resolving
          ? undefined
          : close
      }>
      <Column gap="lg" data-testid="rgb-recovery-conflict-modal">
        <Text text={t('rgb_state_conflict_title')} color="white" size="lg" textCenter />
        <Text text={t('rgb_state_conflict_description')} color="white_muted2" size="sm" wrap />
        <Column gap="xs">
          <Text text={t('rgb_use_cloud_state_option')} color="white" size="sm" />
          <Text text={t('rgb_use_cloud_state_description')} color="textDim" size="xs" wrap />
        </Column>
        <Column gap="xs">
          <Text text={t('rgb_keep_local_state_option')} color="white" size="sm" />
          <Text text={t('rgb_keep_local_state_description')} color="danger" size="xs" wrap />
        </Column>
        <Text text={t('rgb_state_conflict_warning')} color="gold" size="xs" wrap />
        <Row gap="sm" fullX>
          <Button
            text={t(resolving === 'cloud' ? 'restoring_rgb' : 'rgb_use_cloud_state')}
            preset="default"
            disabled={Boolean(resolving)}
            onClick={() => void resolve('cloud')}
            style={{ flex: 1, minWidth: 0 }}
            max2Lines
          />
          <Button
            text={t(resolving === 'local' ? 'rgb_publishing' : 'rgb_keep_local_and_take_over')}
            preset="danger"
            disabled={Boolean(resolving)}
            onClick={() => void resolve('local')}
            style={{ flex: 1, minWidth: 0 }}
            max2Lines
          />
        </Row>
        <Button
          text={t('not_now')}
          preset="default"
          disabled={Boolean(resolving)}
          data-testid="rgb-recovery-conflict-not-now"
          onClick={close}
          full
          style={{ background: 'transparent' }}
          textStyle={{ color: 'rgba(255, 255, 255, 0.65)', fontWeight: 'normal' }}
        />
      </Column>
    </BottomModal>
  );
}
