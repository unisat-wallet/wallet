import { useEffect, useState, type ReactNode } from 'react';

import type { AddressHistoryAssetItem } from '@unisat/wallet-shared';
import { useAlkanesIconInfo, useBRC20IconInfo, useChain, useCurrentAddress, useRunesIconInfo, useWallet } from '@unisat/wallet-state';

import { historyRuneId, historyRuneName, resolveHistoryRuneName } from './runeHistoryName';

/** Use the same network-specific token logo sources as the Assets screen. */
export function HistoryTokenIcon({ asset, className, fallback }: {
  asset: AddressHistoryAssetItem;
  className: string;
  fallback: ReactNode;
}) {
  const name = asset.displayName || asset.symbol;
  const chain = useChain();
  const address = useCurrentAddress();
  const wallet = useWallet();
  const runeId = asset.kind === 'runes' ? historyRuneId(asset) : '';
  const knownRuneName = asset.kind === 'runes' && !runeId ? historyRuneName(asset) : '';
  const lookupKey = `${chain.enum}:${runeId}`;
  const [resolvedRune, setResolvedRune] = useState<{ key: string; name: string }>();
  const runeName = knownRuneName || (resolvedRune?.key === lookupKey ? resolvedRune.name : '');

  useEffect(() => {
    if (!runeId || !address || !chain.iconBaseUrl) return;
    let active = true;
    void resolveHistoryRuneName(chain.enum, runeId, async () => {
      const summary = await wallet.getAddressRunesTokenSummary(address, runeId);
      return summary.runeInfo.spacedRune;
    }).then(value => {
      if (active) setResolvedRune({ key: lookupKey, name: value });
    }).catch(() => {
      // Metadata failures must not prevent displaying transaction history.
    });
    return () => { active = false; };
  }, [runeId, address, chain.enum, chain.iconBaseUrl, lookupKey, wallet]);
  const brc20 = useBRC20IconInfo(asset.symbol);
  const runes = useRunesIconInfo(runeName);
  const alkanes = useAlkanesIconInfo(name, asset.assetId || '');
  const derivedUrl = asset.kind === 'brc20' ? brc20.iconUrl
    : asset.kind === 'runes' && runeName && chain.iconBaseUrl ? runes.iconUrl
    : asset.kind === 'alkanes' && asset.assetId ? alkanes.iconUrl : '';
  const url = asset.logo || derivedUrl;
  const [failedUrl, setFailedUrl] = useState<string>();

  if (!url || failedUrl === url) return <>{fallback}</>;
  return <img src={url} alt="" className={className} style={{ borderRadius: '50%' }} onError={() => setFailedUrl(url)} />;
}
