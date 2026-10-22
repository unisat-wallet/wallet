import { Icon, Tooltip } from '@/ui/components';

type RGBTransferReasonTooltipProps = {
  label: string;
  reason: string;
};

export function RGBTransferReasonTooltip({ label, reason }: RGBTransferReasonTooltipProps) {
  return (
    <Tooltip
      title={
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
          <div>{reason}</div>
        </div>
      }
      overlayStyle={{ maxWidth: 'calc(100vw - 32px)', overflowWrap: 'anywhere' }}>
      <div aria-label={label} style={{ display: 'flex', alignItems: 'center', width: 18, height: 18 }}>
        <Icon
          icon="balance-question"
          size={18}
          containerStyle={{ display: 'block', filter: 'brightness(0) invert(1)', opacity: 0.85 }}
        />
      </div>
    </Tooltip>
  );
}
