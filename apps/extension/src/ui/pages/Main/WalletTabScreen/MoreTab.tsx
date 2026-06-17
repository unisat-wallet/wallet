import { Column } from '@/ui/components';
import { MoreAssetTabKey, useMoreAssetTabKey, useSupportedAssets } from '@unisat/wallet-state';

import { AlkanesCollectionList } from './AlkanesCollectionList';
import { AlkanesList } from './AlkanesList';
import { RGBList } from './RGBList';

export function MoreTab() {
  const tabKey = useMoreAssetTabKey();
  const supportedAssets = useSupportedAssets();

  if (supportedAssets.assets.rgb && tabKey === MoreAssetTabKey.RGB_TOKEN_LIST) {
    return (
      <Column gap="md">
        <RGBList showHeader />
      </Column>
    );
  }

  if (!supportedAssets.assets.alkanes && supportedAssets.assets.rgb) {
    return (
      <Column gap="md">
        <RGBList showHeader />
      </Column>
    );
  }

  return (
    <Column gap="md">
      {tabKey === MoreAssetTabKey.ALKANES_COLLECTION ? (
        <AlkanesCollectionList showHeader />
      ) : (
        <AlkanesList showHeader />
      )}
    </Column>
  );
}
