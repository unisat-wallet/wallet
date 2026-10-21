import { createPortal } from 'react-dom';

import { Button } from '@/ui/components/Button';
import { Column } from '@/ui/components/Column';
import { Icon } from '@/ui/components/Icon';
import { Row } from '@/ui/components/Row';
import { Text } from '@/ui/components/Text';
import { colors } from '@/ui/theme/colors';
import { useI18n } from '@unisat/wallet-state';

const maskStyle = {
  position: 'fixed' as const,
  inset: 0,
  zIndex: 1100,
  background: 'rgba(0,0,0,0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 16px',
  boxSizing: 'border-box' as const
};

const modalStyle = {
  width: '100%',
  borderRadius: 14,
  padding: '28px 16px 24px',
  background: '#171B21',
  boxSizing: 'border-box' as const,
  position: 'relative' as const
};

export function RGBRejectReceiveConfirmModal({
  visible,
  loading,
  onClose,
  onConfirm
}: {
  visible: boolean;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  if (!visible || typeof document === 'undefined' || !document.body) return null;

  return createPortal(
    <div
      style={maskStyle}
      onClick={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}>
      <Column gap="zero" style={modalStyle}>
        <Icon
          icon="close"
          color="white_muted2"
          size={12}
          onClick={() => {
            if (!loading) onClose();
          }}
          containerStyle={{ position: 'absolute', top: 30, right: 22 }}
        />
        <Text text={t('rgb_reject_receive_confirm_title')} color="white" size="md" textCenter />
        <Text
          text={t('rgb_reject_receive_confirm_description')}
          color="white_muted2"
          size="sm"
          wrap
          textCenter
          style={{ marginTop: 16, lineHeight: '20px' }}
        />
        <Row gap="md" fullX style={{ marginTop: 24 }}>
          <Button
            text={t('cancel')}
            preset="default"
            disabled={loading}
            onClick={onClose}
            full
            style={{ height: 48, background: 'transparent', border: '1px solid rgba(255,255,255,0.42)' }}
            textStyle={{ color: colors.white, fontWeight: 'normal' }}
          />
          <Button
            text={t('rgb_confirm_reject_transfer')}
            preset="danger"
            disabled={loading}
            onClick={onConfirm}
            full
            style={{ height: 48 }}
          />
        </Row>
      </Column>
    </div>,
    document.body
  );
}
