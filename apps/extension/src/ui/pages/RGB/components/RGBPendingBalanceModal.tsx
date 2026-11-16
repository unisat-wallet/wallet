import {
  BottomSheetHeader,
  Button,
  Column,
  CopyableAddress,
  Row,
  Text
} from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import {
  RgbAssetPendingDetailItem,
  RgbAssetPendingDetails,
  toRgbDisplayAmount,
  useI18n,
  useNavigation
} from '@unisat/wallet-state';

const reasonKeys: Record<RgbAssetPendingDetailItem['reason'], string> = {
  waiting_confirmation: 'rgb_pending_reason_waiting_confirmation',
  waiting_required_confirmations: 'rgb_pending_reason_waiting_required_confirmations',
  waiting_snapshot_sync: 'rgb_pending_reason_waiting_snapshot_sync',
  waiting_receive_settlement: 'rgb_pending_reason_waiting_receive_settlement',
  history_unavailable: 'rgb_pending_reason_history_unavailable'
};

export function RGBPendingBalanceModal(props: {
  details?: RgbAssetPendingDetails;
  loading: boolean;
  error?: string;
  precision: number;
  pendingAmount: string;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const { details, loading, error, precision, pendingAmount, onRefresh, onClose } = props;
  const { t } = useI18n();
  const nav = useNavigation();

  return (
    <BottomModal onClose={onClose} bodyStyle={{ padding: 0 }}>
      <Column fullX gap="zero">
        <BottomSheetHeader title={t('rgb_pending_details_title')} onClose={onClose} />
        <Column
          fullX
          gap="md"
          style={{ padding: '0 20px 20px', maxHeight: '70vh', overflowY: 'auto', boxSizing: 'border-box' }}>
          <Text text={t('rgb_pending_details_description')} size="xs" color="textDim" wrap />
          <Row
            fullX
            justifyBetween
            itemsCenter
            style={{ padding: 12, borderRadius: 10, background: 'rgba(244, 182, 44, 0.08)' }}>
            <Text text={t('rgb_pending_balance')} size="sm" />
            <Text text={pendingAmount} size="sm" color="gold" disableTranslate />
          </Row>

          {error ? <Text text={error} size="xs" color="red" wrap /> : null}

          {details?.items.map((item, index) => {
            const txid = item.outpoint?.txid || item.txid;
            return (
              <Column
                key={`${item.kind}-${txid || 'pending'}-${item.outpoint?.vout ?? index}-${index}`}
                fullX
                gap="sm"
                style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.06)' }}>
                <Row fullX justifyBetween itemsCenter gap="sm">
                  <Text text={t(reasonKeys[item.reason])} size="xs" color="gold" wrap />
                  <Text
                    text={toRgbDisplayAmount(item.amount, precision)}
                    size="sm"
                    disableTranslate
                    style={{ flexShrink: 0 }}
                  />
                </Row>
                {item.outpoint ? (
                  <Row fullX justifyBetween itemsCenter>
                    <Text text="UTXO" size="xs" color="textDim" disableTranslate />
                    <CopyableAddress
                      address={`${item.outpoint.txid}:${item.outpoint.vout}`}
                      copyPosition="after"
                      len={5}
                    />
                  </Row>
                ) : null}
                <Row fullX justifyBetween itemsCenter>
                  <Text text={t('history_confirmations')} size="xs" color="textDim" />
                  <Text
                    text={`${item.confirmations}/${item.requiredConfirmations}`}
                    size="xs"
                    color="textDim"
                    disableTranslate
                  />
                </Row>
                {item.chainStatus ? (
                  <Row fullX justifyBetween itemsCenter>
                    <Text text={t('status')} size="xs" color="textDim" />
                    <Text text={item.chainStatus} size="xs" color="textDim" disableTranslate />
                  </Row>
                ) : null}
                {txid ? (
                  <Row fullX justifyEnd>
                    <Text
                      text={t('view_on_uniscan')}
                      size="xs"
                      color="gold"
                      onClick={() => nav.navToExplorerTx(txid)}
                    />
                  </Row>
                ) : null}
              </Column>
            );
          })}

          {!loading && details && details.items.length === 0 ? (
            <Text text={t('rgb_pending_details_empty')} size="xs" color="textDim" textCenter wrap />
          ) : null}
          {details?.refreshedAt ? (
            <Text
              text={`${t('rgb_pending_last_refreshed')}: ${new Date(details.refreshedAt).toLocaleTimeString()}`}
              size="xxs"
              color="textDim"
              textCenter
              disableTranslate
            />
          ) : null}
          <Button
            text={loading ? t('loading') : t('refresh')}
            preset="primary"
            full
            disabled={loading}
            onClick={onRefresh}
            data-testid="rgb-pending-details-refresh"
          />
        </Column>
      </Column>
    </BottomModal>
  );
}
