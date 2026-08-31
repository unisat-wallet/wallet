import { useCallback, useState } from 'react';

import { useWallet } from '@unisat/wallet-state';

import { RgbWriteLeaseModal } from './RgbWriteLeaseModal';

/** Gate user-initiated RGB writes, while leaving all RGB reads available on secondary devices. */
export function useRgbWriteLeaseGuard() {
  const wallet = useWallet();
  const [leaseModal, setLeaseModal] = useState<{ expiresAt?: number }>();
  const [leaseLoading, setLeaseLoading] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<(() => void) | undefined>();

  const requestWrite = useCallback(async (action: () => void) => {
    try {
      const status = await wallet.getRgbWriteLeaseStatus();
      if (status.mode === 'readonly') {
        setPendingWrite(() => action);
        setLeaseModal({ expiresAt: status.expiresAt });
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
        setLeaseModal({ expiresAt: latest.expiresAt });
        return;
      }
      // The write screen owns other operation-specific errors (invoice, fee
      // pool, recovery), so preserve its detailed error handling.
      action();
    }
  }, [wallet]);

  const onTakeover = useCallback(async () => {
    if (!pendingWrite) return;
    setLeaseLoading(true);
    try {
      await wallet.activateRgbWriteLease({ takeover: true });
      const action = pendingWrite;
      setLeaseModal(undefined);
      setPendingWrite(undefined);
      action();
    } finally {
      setLeaseLoading(false);
    }
  }, [pendingWrite, wallet]);

  return {
    requestWrite,
    writeLeaseModal: leaseModal ? (
      <RgbWriteLeaseModal
        expiresAt={leaseModal.expiresAt}
        loading={leaseLoading}
        onClose={() => {
          setLeaseModal(undefined);
          setPendingWrite(undefined);
        }}
        onTakeover={() => void onTakeover()}
      />
    ) : null
  };
}
