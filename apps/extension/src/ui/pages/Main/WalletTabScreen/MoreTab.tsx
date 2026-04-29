import { Column } from '@/ui/components';
import { MoreAssetTabKey, useMoreAssetTabKey } from '@unisat/wallet-state';

import { AlkanesCollectionList } from './AlkanesCollectionList';
import { AlkanesList } from './AlkanesList';

export function MoreTab() {
  const tabKey = useMoreAssetTabKey();

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
