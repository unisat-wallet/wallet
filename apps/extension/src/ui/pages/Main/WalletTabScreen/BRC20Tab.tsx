import { useEffect, useMemo } from 'react';

import { Column } from '@/ui/components';
import { Tabs } from '@/ui/components/Tabs';
import {
  OrdinalsAssetTabKey,
  uiActions,
  useAppDispatch,
  useChain,
  useOrdinalsAssetTabKey
} from '@unisat/wallet-state';

import { BRC20ProgList } from './BRC20ProgList';
import { BRC20List } from './Brc20List';

export function BRC20Tab() {
  const chain = useChain();
  const tabKey = useOrdinalsAssetTabKey();
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (tabKey === OrdinalsAssetTabKey.ALL || (tabKey === OrdinalsAssetTabKey.BRC20_6BYTE && !chain.enableBrc20Prog)) {
      dispatch(uiActions.updateAssetTabScreen({ ordinalsAssetTabKey: OrdinalsAssetTabKey.BRC20 }));
    }
  }, [tabKey, chain.enableBrc20Prog, dispatch]);

  const tabItems = useMemo(() => {
    const items = [
      {
        key: OrdinalsAssetTabKey.BRC20,
        label: 'brc-20',
        children: <BRC20List />
      }
    ];

    if (chain.enableBrc20Prog) {
      items.push({
        key: OrdinalsAssetTabKey.BRC20_6BYTE,
        label: 'brc2.0',
        children: <BRC20ProgList />
      });
    }
    return items;
  }, [chain.enableBrc20Prog]);

  const finalTabKey = tabKey === OrdinalsAssetTabKey.BRC20_6BYTE && chain.enableBrc20Prog
    ? OrdinalsAssetTabKey.BRC20_6BYTE
    : OrdinalsAssetTabKey.BRC20;

  return (
    <Column>
      <Tabs
        defaultActiveKey={finalTabKey as unknown as string}
        activeKey={finalTabKey as unknown as string}
        items={tabItems as unknown as any[]}
        onTabClick={(key) => {
          dispatch(uiActions.updateAssetTabScreen({ ordinalsAssetTabKey: key }));
        }}
        preset="style2"
      />
    </Column>
  );
}
