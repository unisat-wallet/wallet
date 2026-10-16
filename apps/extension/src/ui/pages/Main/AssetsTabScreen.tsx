import { useLocation } from 'react-router-dom';
import type { AssetTabKey, MoreAssetTabKey } from '@unisat/wallet-state';

import WalletTabScreen from './WalletTabScreen';

export default function AssetsTabScreen() {
  const { state } = useLocation();
  const selectedTab = state as { assetTabKey?: AssetTabKey; moreAssetTabKey?: MoreAssetTabKey } | null;
  return <WalletTabScreen screen="assets" preferredAssetTab={selectedTab?.assetTabKey === undefined ? undefined : {
    assetTabKey: selectedTab.assetTabKey,
    moreAssetTabKey: selectedTab.moreAssetTabKey
  }} />;
}
