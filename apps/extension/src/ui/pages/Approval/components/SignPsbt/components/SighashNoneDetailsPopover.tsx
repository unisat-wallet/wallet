import { Column, Icon, Row, Text } from '@/ui/components';
import { Popover } from '@/ui/components/Popover';
import { useI18n } from '@unisat/wallet-state';

export function SighashNoneDetailsPopover({
  hasAnyoneCanPay,
  onClose
}: {
  hasAnyoneCanPay: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <Popover
      onClose={onClose}
      contentStyle={{ width: 343, boxSizing: 'border-box', padding: '24px 16px', backgroundColor: '#181A1F' }}
      closeStyle={{ top: 24, right: 16 }}>
      <Column gap="lg" fullX>
        <Text text="SIGHASH_NONE" size="md" preset="bold" textCenter />
        <Column fullX gap="zero" style={{ border: '1px solid rgba(237, 51, 75, 0.35)', borderRadius: 8 }}>
          <Row itemsCenter gap="sm" style={{ padding: '10px 12px' }}>
            <Icon icon="alert" size={16} color="red" />
            <Text text={t('sighash_none_risk_title')} size="xs" color="red" />
          </Row>
          <Text
            text={t('sighash_none_risk_description')}
            size="sm"
            color="textDim"
            style={{ borderTop: '1px solid rgba(237, 51, 75, 0.25)', padding: 12, lineHeight: '20px' }}
          />
        </Column>
        {hasAnyoneCanPay && (
          <Column fullX gap="zero" style={{ border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: 8 }}>
            <Text text="ANYONECANPAY" size="xs" color="warning" style={{ padding: '10px 12px' }} />
            <Text
              text={t('sighash_single_anyonecanpay_description')}
              size="sm"
              color="textDim"
              style={{ borderTop: '1px solid rgba(255, 255, 255, 0.15)', padding: 12, lineHeight: '20px' }}
            />
          </Column>
        )}
      </Column>
    </Popover>
  );
}
