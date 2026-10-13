import { useState, type ReactNode } from 'react';

import type { AddressHistoryAssetItem } from '@unisat/wallet-shared';
import { useAlkanesIconInfo, useBRC20IconInfo, useRunesIconInfo } from '@unisat/wallet-state';

/** Use the same network-specific token logo sources as the Assets screen. */
export function HistoryTokenIcon({ asset, className, fallback }: {
  asset: AddressHistoryAssetItem;
  className: string;
  fallback: ReactNode;
}) {
  const name = asset.displayName || asset.symbol;
  const brc20 = useBRC20IconInfo(asset.symbol);
  const runes = useRunesIconInfo(name);
  const alkanes = useAlkanesIconInfo(name, asset.assetId || '');
  const url = asset.kind === 'brc20' ? brc20.iconUrl
    : asset.kind === 'runes' ? runes.iconUrl
    : asset.kind === 'alkanes' && asset.assetId ? alkanes.iconUrl : '';
  const [failedUrl, setFailedUrl] = useState<string>();

  if (!url || failedUrl === url) return <>{fallback}</>;
  return <img src={url} alt="" className={className} style={{ borderRadius: '50%' }} onError={() => setFailedUrl(url)} />;
}
