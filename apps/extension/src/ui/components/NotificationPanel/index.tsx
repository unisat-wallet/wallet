import type { IconTypes } from '@/ui/components/Icon';
import { colors } from '@/ui/theme/colors';

import { BottomModal } from '../BottomModal';
import { Button } from '../Button';
import { Column } from '../Column';
import { Icon } from '../Icon';
import { Text } from '../Text';

type NotificationPanelProps = {
  icon?: IconTypes;
  title: string;
  description: string;
  actionText: string;
  onAction: () => void;
  onClose: () => void;
};

export function NotificationPanel({
  icon = 'notification',
  title,
  description,
  actionText,
  onAction,
  onClose
}: NotificationPanelProps) {
  return (
    <BottomModal onClose={onClose} bodyStyle={{ padding: 0 }}>
      <Column
        fullX
        itemsCenter
        style={{ padding: '28px 20px 20px', boxSizing: 'border-box', position: 'relative' }}
        gap="md">
        <Icon
          icon="close"
          color="textDim"
          size={14}
          onClick={onClose}
          containerStyle={{ position: 'absolute', top: 20, right: 20 }}
        />
        <Icon icon={icon} size={48} />
        <Text text={title} preset="title" textCenter />
        <Text text={description} color="textDim" textCenter wrap />
        <Button
          full
          text={actionText}
          onClick={onAction}
          style={{ marginTop: 12, minHeight: 48 }}
          textStyle={{ color: colors.white, fontWeight: 'normal' }}
        />
      </Column>
    </BottomModal>
  );
}
