import { useEffect, useMemo, useState } from 'react';

import { Column, Row, Text } from '@/ui/components';
import { Tabs } from '@/ui/components/Tabs';
import { useI18n, useRGBListLogic, useRGBTransfersLogic } from '@unisat/wallet-state';

import { RGBList } from './RGBList';
import { RGBTransfersList } from './RGBTransfersList';

type RGBHomeTabKey = 'assets' | 'transfers';

type RGBHomeTabsProps = {
  initialTab?: RGBHomeTabKey;
  transfers: ReturnType<typeof useRGBTransfersLogic>;
  list: ReturnType<typeof useRGBListLogic>;
};

export function RGBHomeTabs({ initialTab = 'assets', transfers, list }: RGBHomeTabsProps) {
  const { t } = useI18n();
  const [activeKey, setActiveKey] = useState<RGBHomeTabKey>(initialTab);
  const [promptedReceiveIds, setPromptedReceiveIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (initialTab) setActiveKey(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const pendingReceive = transfers.items.find(
      (item) =>
        item.type === 'receive' &&
        item.status.toLowerCase() === 'pending_accept' &&
        !promptedReceiveIds.has(item.transferId || item.id)
    );
    if (!pendingReceive) return;

    setPromptedReceiveIds((current) => new Set(current).add(pendingReceive.transferId || pendingReceive.id));
    setActiveKey('transfers');
  }, [promptedReceiveIds, transfers.items]);

  const tabItems = useMemo(
    () => [
      {
        key: 'assets',
        label: `${t('rgb_assets')} (${Math.max(list.total, 0)})`,
        children: <RGBList list={list} />
      },
      {
        key: 'transfers',
        label: transfers.pendingCount ? (
          <Row itemsCenter>
            <Text
              text={t('rgb_transfers')}
              size="md"
              color={activeKey === 'transfers' ? 'gold' : 'textDim'}
            />
            <Text
              text={transfers.pendingCount > 99 ? '99+' : String(transfers.pendingCount)}
              size="xs"
              style={{
                minWidth: 16,
                height: 16,
                paddingLeft: 4,
                paddingRight: 4,
                marginLeft: 4,
                borderRadius: 8,
                backgroundColor: '#F4B62C',
                color: '#121212',
                textAlign: 'center',
                lineHeight: '16px'
              }}
            />
          </Row>
        ) : (
          t('rgb_transfers')
        ),
        children: <RGBTransfersList transfers={transfers} />
      }
    ],
    [activeKey, list, t, transfers]
  );

  return (
    <Column>
      <Tabs
        defaultActiveKey={activeKey}
        activeKey={activeKey}
        items={tabItems as unknown as any[]}
        onTabClick={(key) => setActiveKey(key as RGBHomeTabKey)}
      />
    </Column>
  );
}
