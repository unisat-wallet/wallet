import { NotificationPanel } from '@/ui/components';
import {
  getRgbTokenPrecision,
  toRgbDisplayAmount,
  useI18n,
  type RgbTransferNotification
} from '@unisat/wallet-state';

type RGBTransferNotificationPanelProps = {
  notification?: RgbTransferNotification;
  actionText: string;
  onAction: () => void;
  onClose: () => void;
};

export function RGBTransferNotificationPanel({
  notification,
  actionText,
  onAction,
  onClose
}: RGBTransferNotificationPanelProps) {
  const { t } = useI18n();
  if (!notification) return null;

  const { transfer } = notification;
  const amount = transfer.amount
    ? toRgbDisplayAmount(transfer.amount, getRgbTokenPrecision(transfer))
    : '--';
  const asset = transfer.ticker || transfer.name || 'RGB';
  const receiveConfirmed = notification.kind === 'receive_confirmed';

  return (
    <NotificationPanel
      icon={receiveConfirmed ? 'history_receive' : 'history_send'}
      title={t(receiveConfirmed ? 'rgb_receive_confirmed_title' : 'rgb_transfer_broadcasted_title')}
      description={t(
        receiveConfirmed ? 'rgb_receive_confirmed_description' : 'rgb_transfer_broadcasted_notification',
        [amount, asset]
      )}
      actionText={actionText}
      onAction={onAction}
      onClose={onClose}
    />
  );
}
