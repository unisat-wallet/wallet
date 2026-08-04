import { useEffect, useState } from 'react';

import { Row, Text } from '@/ui/components';
import { useCurrentAccount, useWallet } from '@unisat/wallet-state';

/** Shows BIP-380 policy summary for the current account on SignPsbt. */
export function PolicyChip() {
  const wallet = useWallet();
  const currentAccount = useCurrentAccount();
  const [label, setLabel] = useState<string>('');
  const [complex, setComplex] = useState(false);

  useEffect(() => {
    let cancelled = false;
    wallet
      .getAccountPolicySummary()
      .then((policy: { label?: string; isComplex?: boolean }) => {
        if (cancelled) return;
        setLabel(policy?.label || '');
        setComplex(Boolean(policy?.isComplex));
      })
      .catch(() => {
        if (!cancelled) {
          setLabel('');
          setComplex(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [wallet, currentAccount?.key, currentAccount?.address]);

  if (!label) return null;

  return (
    <Row
      itemsCenter
      style={{
        alignSelf: 'flex-start',
        padding: '4px 10px',
        borderRadius: 6,
        background: 'rgba(255, 200, 87, 0.12)',
        border: '1px solid rgba(255, 200, 87, 0.35)'
      }}
    >
      <Text text={label} size="xs" color="gold" />
      {complex ? <Text text="· advanced" size="xs" color="orange" /> : null}
    </Row>
  );
}
