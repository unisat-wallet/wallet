import { useCallback, useState } from 'react';

import { useWallet } from '@unisat/wallet-state';

import { RgbWriteLeaseModal } from './RgbWriteLeaseModal';
import { RgbRecoveryConflictModal } from './RgbRecoveryConflictModal';

/** Gate user-initiated RGB writes, while leaving all RGB reads available on secondary devices. */
export function useRgbWriteLeaseGuard() {
  const wallet = useWallet();
  const [leaseModalVisible, setLeaseModalVisible] = useState(false);
  const [recoveryConflictModal, setRecoveryConflictModal] = useState(false);
  const [leaseLoading, setLeaseLoading] = useState(false);
  const [writeGuardLoading, setWriteGuardLoading] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<(() => void) | undefined>();

  const requestLeaseAndWrite = useCallback(async (action: () => void) => {
    try {
      const status = await wallet.getRgbWriteLeaseStatus();
      if (status.mode === 'readonly') {
        setPendingWrite(() => action);
        setLeaseModalVisible(true);
        return;
      }
      // Acquire before entering a signing/write flow, eliminating the normal
      // race where two clients see an available lease at the same time.
      await wallet.activateRgbWriteLease();
      action();
    } catch {
      // Another client can acquire between the status read and activation.
      // Re-read once so that race is shown as a deliberate handoff choice.
      const latest = await wallet.getRgbWriteLeaseStatus().catch(() => undefined);
      if (latest?.mode === 'readonly') {
        setPendingWrite(() => action);
        setLeaseModalVisible(true);
        return;
      }
      // The write screen owns other operation-specific errors (invoice, fee
      // pool, recovery), so preserve its detailed error handling.
      action();
    }
  }, [wallet]);

  const requestWrite = useCallback(async (action: () => void) => {
    setWriteGuardLoading(true);
    try {
      try {
        const recoveryStatus = await wallet.getRgbRecoveryCheckpointStatus();
        if (recoveryStatus.conflicted) {
          setPendingWrite(() => action);
          setRecoveryConflictModal(true);
          return;
        }
      } catch {
        // Let the operation retain its existing error handling when the
        // diagnostic status cannot be read.
      }
      await requestLeaseAndWrite(action);
    } finally {
      setWriteGuardLoading(false);
    }
  }, [requestLeaseAndWrite, wallet]);

  const onTakeover = useCallback(async () => {
    if (!pendingWrite) return;
    setLeaseLoading(true);
    try {
      await wallet.activateRgbWriteLease({ takeover: true });
      const action = pendingWrite;
      setLeaseModalVisible(false);
      setPendingWrite(undefined);
      action();
    } finally {
      setLeaseLoading(false);
    }
  }, [pendingWrite, wallet]);

  return {
    requestWrite,
    writeGuardLoading,
    writeLeaseModal: (
      <>
        {recoveryConflictModal ? (
          <RgbRecoveryConflictModal
            forceVisible
            onClose={() => {
              setRecoveryConflictModal(false);
              setPendingWrite(undefined);
            }}
            onResolved={() => {
              const action = pendingWrite;
              setRecoveryConflictModal(false);
              setPendingWrite(undefined);
              if (action) void requestLeaseAndWrite(action);
            }}
          />
        ) : null}
        {leaseModalVisible ? (
          <RgbWriteLeaseModal
            loading={leaseLoading}
            onClose={() => {
              setLeaseModalVisible(false);
              setPendingWrite(undefined);
            }}
            onTakeover={() => void onTakeover()}
          />
        ) : null}
      </>
    )
  };
}
