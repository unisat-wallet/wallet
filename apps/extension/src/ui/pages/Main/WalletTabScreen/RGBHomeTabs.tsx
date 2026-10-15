import { useState } from 'react';

import { BottomSheetHeader, Button, Card, Column, Icon, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
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
import { RgbReceiveSelectorModal } from './RgbReceiveSelectorModal';
import { RgbSendAssetSelectorModal } from './RgbSendAssetSelectorModal';

type RGBHomeTabsProps = {
  transfers: ReturnType<typeof useRGBTransfersLogic>;
  list: ReturnType<typeof useRGBListLogic>;
};

export function RGBHomeTabs({ transfers, list }: RGBHomeTabsProps) {
  const { t } = useI18n();
  const nav = useNavigation();
  const accountCapabilities = useCurrentAccountCapabilities();
  const [receiveSelectorOpen, setReceiveSelectorOpen] = useState(false);
  const [sendSelectorOpen, setSendSelectorOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [selectedPendingTransfer, setSelectedPendingTransfer] = useState<RgbTransferItem>();
  const [handledTransferIds, setHandledTransferIds] = useState<Set<string>>(() => new Set());
  const openIssueScreen = () => {
    setActionMenuOpen(false);
    nav.navigate('RGBIssueScreen');
  };
  const openHistoryScreen = () => {
    setActionMenuOpen(false);
    nav.navigate('RGBTransfersScreen');
  };

  const pendingReceives = transfers.items.filter(
    (item) =>
      item.type === 'receive' &&
      item.status.toLowerCase() === 'pending_accept' &&
      !handledTransferIds.has(item.transferId || item.id)
  );
  const pendingBroadcasts = transfers.items.filter(
    (item) =>
      item.type === 'send' &&
      ['ready_to_broadcast', 'broadcast_failed'].includes(item.status.toLowerCase()) &&
      !handledTransferIds.has(item.transferId || item.id)
  );

  const markPendingHandled = () => {
    if (!selectedPendingTransfer) return;
    setHandledTransferIds((current) =>
      new Set(current).add(selectedPendingTransfer.transferId || selectedPendingTransfer.id)
    );
  };

  return (
    <Column gap="md">
      {pendingBroadcasts.length > 0 && (
        <Column
          fullX
          gap="zero"
          data-testid="rgb-pending-broadcasts"
          style={{
            padding: '12px 16px',
            border: '1px solid rgba(244,182,44,0.35)',
            borderRadius: 12,
            backgroundColor: 'rgba(244,182,44,0.08)',
            boxSizing: 'border-box'
          }}
        >
          <Text text={`${t('Broadcast')} (${pendingBroadcasts.length})`} color="gold" size="sm" />
          {pendingBroadcasts.map((item) => (
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
      <Column style={{ gap: 13 }}>
        <Row fullX itemsCenter style={{ gap: 8 }}>
          <Button
            text={t('receive')}
            preset="brc20-action"
            icon="receive"
            full
            style={{ minHeight: 44, height: 44, marginLeft: 0, marginRight: 0 }}
            textStyle={{ fontSize: 13 }}
            onClick={() => setReceiveSelectorOpen(true)}
            data-testid="receive-rgb-button"
          />
          <Button
            text={t('send')}
            preset="brc20-action"
            icon="send"
            full
            style={{ minHeight: 44, height: 44, marginLeft: 0, marginRight: 0 }}
            textStyle={{ fontSize: 13 }}
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
            <Icon icon="more" size={16} />
          </div>
        </Row>
        <RGBList list={list} />
      </Column>
      {selectedPendingTransfer && (
        <RGBTransferDetailSheet
          transfer={selectedPendingTransfer}
          transferId={selectedPendingTransfer.transferId || selectedPendingTransfer.id}
          onClose={() => setSelectedPendingTransfer(undefined)}
          onAccepted={() => {
            markPendingHandled();
            list.onRefresh();
          }}
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
            <Column fullX gap="lg" style={{ padding: '0 20px 24px', boxSizing: 'border-box' }}>
              <Card
                fullX
                itemsCenter
                onClick={openIssueScreen}
                data-testid="issue-button"
                style={{ minHeight: 56, padding: '10px 12px', borderRadius: 10, cursor: 'pointer' }}
              >
                <Row itemsCenter gap="md" style={{ flex: 1 }}>
                  <Icon icon="issue" color="ticker_color2" size={20} />
                  <Text text={t('issue')} size="sm" />
                </Row>
                <Icon icon="right" size={20} style={{ backgroundColor: 'rgba(255, 255, 255, 0.65)' }} />
              </Card>
              <Card
                fullX
                itemsCenter
                onClick={openHistoryScreen}
                data-testid="rgb-history-button"
                style={{ minHeight: 56, padding: '10px 12px', borderRadius: 10, cursor: 'pointer' }}
              >
                <Row itemsCenter gap="md" style={{ flex: 1 }}>
                  <Icon icon="history" color="ticker_color2" size={20} />
                  <Text text={t('rgb_history')} size="sm" />
                </Row>
                <Icon icon="right" size={20} style={{ backgroundColor: 'rgba(255, 255, 255, 0.65)' }} />
              </Card>
            </Column>
          </Column>
        </BottomModal>
      )}
    </Column>
  );
}
