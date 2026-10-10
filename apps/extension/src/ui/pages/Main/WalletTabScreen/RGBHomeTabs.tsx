import { useEffect, useMemo, useState } from 'react';

import { BottomSheetHeader, Button, Column, Icon, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { Tabs } from '@/ui/components/Tabs';
import {
  useI18n,
  useCurrentAccountCapabilities,
  useNavigation,
  useRGBListLogic,
  useRGBTransfersLogic,
  type RgbTransferItem
} from '@unisat/wallet-state';

import { RGBTransferDetailSheet } from '../../RGB/RGBTransferDetailSheet';
import { RGBTransferListItem } from '../../RGB/components/RGBTransferListItem';
import { RGBList } from './RGBList';
import { RGBTransfersList } from './RGBTransfersList';
import { RgbReceiveSelectorModal } from './RgbReceiveSelectorModal';
import { RgbSendAssetSelectorModal } from './RgbSendAssetSelectorModal';

type RGBHomeTabKey = 'assets' | 'transfers';

type RGBHomeTabsProps = {
  initialTab?: RGBHomeTabKey;
  transfers: ReturnType<typeof useRGBTransfersLogic>;
  list: ReturnType<typeof useRGBListLogic>;
};

export function RGBHomeTabs({ initialTab = 'assets', transfers, list }: RGBHomeTabsProps) {
  const { t } = useI18n();
  const nav = useNavigation();
  const accountCapabilities = useCurrentAccountCapabilities();
  const [activeKey, setActiveKey] = useState<RGBHomeTabKey>(initialTab);
  const [receiveSelectorOpen, setReceiveSelectorOpen] = useState(false);
  const [sendSelectorOpen, setSendSelectorOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [selectedPendingTransfer, setSelectedPendingTransfer] = useState<RgbTransferItem>();
  const [handledTransferIds, setHandledTransferIds] = useState<Set<string>>(() => new Set());
  const openIssueScreen = () => {
    setActionMenuOpen(false);
    nav.navigate('RGBIssueScreen');
  };
  useEffect(() => {
    if (initialTab) setActiveKey(initialTab);
  }, [initialTab]);

  const pendingReceives = transfers.items.filter(
    (item) =>
      item.type === 'receive' &&
      item.status.toLowerCase() === 'pending_accept' &&
      !handledTransferIds.has(item.transferId || item.id)
  );

  const markPendingHandled = () => {
    if (!selectedPendingTransfer) return;
    setHandledTransferIds((current) =>
      new Set(current).add(selectedPendingTransfer.transferId || selectedPendingTransfer.id)
    );
  };

  const tabItems = useMemo(
    () => [
      {
        key: 'assets',
        label: `${t('rgb_assets')} (${Math.max(list.total, 0)})`,
        children: (
          <Column gap="md">
            <Row fullX itemsCenter gap="sm">
              <Button
                text={t('receive_rgb')}
                preset="brc20-action"
                icon="receive"
                full
                style={{ minHeight: 44, height: 44 }}
                onClick={() => setReceiveSelectorOpen(true)}
                data-testid="receive-rgb-button"
              />
              <Button
                text={t('send')}
                preset="brc20-action"
                icon="send"
                full
                style={{ minHeight: 44, height: 44 }}
                disabled={!accountCapabilities.canCreateSigningRequest}
                onClick={() => setSendSelectorOpen(true)}
                data-testid="send-rgb-button"
              />
              <div
                role="button"
                tabIndex={0}
                onClick={() => setActionMenuOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActionMenuOpen(true);
                  }
                }}
                aria-label={t('more')}
                data-testid="rgb-more-button"
                style={{
                  width: 44,
                  height: 44,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  cursor: 'pointer'
                }}
              >
                <Icon icon="more" size={20} />
              </div>
            </Row>
            <RGBList list={list} />
          </Column>
        )
      },
      {
        key: 'transfers',
        label: t('history'),
        children: <RGBTransfersList transfers={transfers} />
      }
    ],
    [accountCapabilities.canCreateSigningRequest, list, nav, t, transfers]
  );

  return (
    <Column gap="md">
      {pendingReceives.length > 0 && (
        <Column
          fullX
          gap="zero"
          data-testid="rgb-pending-actions"
          style={{
            padding: '12px 16px',
            border: '1px solid rgba(244,182,44,0.35)',
            borderRadius: 12,
            backgroundColor: 'rgba(244,182,44,0.08)',
            boxSizing: 'border-box'
          }}
        >
          <Text text={`${t('rgb_approval_pending_acceptance')} (${pendingReceives.length})`} color="gold" size="sm" />
          {pendingReceives.map((item) => (
            <Column key={item.transferId || item.id} gap="zero">
              <RGBTransferListItem item={item} onClick={() => setSelectedPendingTransfer(item)} />
              <Text
                text={t('view_transfer')}
                color="gold"
                size="xs"
                onClick={() => setSelectedPendingTransfer(item)}
                style={{ alignSelf: 'flex-end', paddingTop: 6, paddingBottom: 8, cursor: 'pointer' }}
              />
            </Column>
          ))}
        </Column>
      )}
      <Tabs
        preset="style2"
        defaultActiveKey={activeKey}
        activeKey={activeKey}
        items={tabItems as unknown as any[]}
        onTabClick={(key) => setActiveKey(key as RGBHomeTabKey)}
      />
      {selectedPendingTransfer && (
        <RGBTransferDetailSheet
          transfer={selectedPendingTransfer}
          transferId={selectedPendingTransfer.transferId || selectedPendingTransfer.id}
          onClose={() => setSelectedPendingTransfer(undefined)}
          onAccepted={markPendingHandled}
          onCanceled={() => {
            markPendingHandled();
            void transfers.onRefresh({ showLoading: false });
          }}
          onClickExploreTx={
            selectedPendingTransfer.txid ? () => nav.navToExplorerTx(selectedPendingTransfer.txid || '') : undefined
          }
        />
      )}
      {receiveSelectorOpen && (
        <RgbReceiveSelectorModal
          onClose={() => setReceiveSelectorOpen(false)}
          onViewInvoices={() => {
            setReceiveSelectorOpen(false);
            nav.navigate('RGBInvoiceListScreen', {});
          }}
          onCreateInvoice={() => {
            setReceiveSelectorOpen(false);
            nav.navigate('RGBReceiveScreen', { initialStep: 'create_invoice' });
          }}
        />
      )}
      {sendSelectorOpen && (
        <RgbSendAssetSelectorModal
          list={list}
          onClose={() => setSendSelectorOpen(false)}
          onSelect={(asset) => {
            setSendSelectorOpen(false);
            nav.navigate('SendRGBScreen', { assetId: asset.assetId, tokenBalance: asset });
          }}
        />
      )}
      {actionMenuOpen && (
        <BottomModal onClose={() => setActionMenuOpen(false)} bodyStyle={{ padding: 0 }}>
          <Column fullX gap="zero">
            <BottomSheetHeader title={t('more')} onClose={() => setActionMenuOpen(false)} />
            <div
              role="button"
              tabIndex={0}
              onClick={openIssueScreen}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openIssueScreen();
                }
              }}
              data-testid="issue-button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: '0 20px 24px',
                boxSizing: 'border-box',
                cursor: 'pointer'
              }}
            >
              <Icon icon="issue" size={20} />
              <Text text={t('issue')} size="sm" />
            </div>
          </Column>
        </BottomModal>
      )}
    </Column>
  );
}
