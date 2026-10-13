import { BottomSheetHeader, Icon, Stack, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';

export interface BRC20MoreActionItem {
  key: string;
  label: string;
  symbol?: string;
  icon?: 'send_grey' | 'swap_send' | 'swap_more' | 'add_liquidity';
  disabled?: boolean;
  onClick: () => void;
}

interface BRC20InSwapMoreSheetProps {
  onClose: () => void;
  actions: BRC20MoreActionItem[];
  t: (key: string) => string;
}

const layout = {
  inset: 16,
  contentGap: 24,
  sectionPaddingBottom: 20,
  actionsGap: 12,
  actionHeight: 48,
  actionInsetX: 20,
  actionBorderRadius: 8,
  actionIconGap: 12
} as const;

export function BRC20InSwapMoreSheet(props: BRC20InSwapMoreSheetProps) {
  const { onClose, actions, t } = props;

  return (
    <BottomModal onClose={onClose} bodyStyle={{ padding: 0 }}>
      <Stack fullX gap="zero">
        <BottomSheetHeader title={t('more')} onClose={onClose} inset={layout.inset} bottomSpacing={layout.contentGap} />

        <Stack
          fullX
          style={{
            paddingLeft: layout.inset,
            paddingRight: layout.inset,
            paddingBottom: layout.sectionPaddingBottom,
            gap: layout.contentGap,
            boxSizing: 'border-box'
          }}>
          <Stack fullX style={{ gap: layout.actionsGap }}>
            {actions.map((action) => (
              <ActionRow
                key={action.key}
                label={action.label}
                symbol={action.symbol}
                icon={action.icon}
                disabled={action.disabled}
                onClick={action.onClick}
              />
            ))}
          </Stack>
        </Stack>
      </Stack>
    </BottomModal>
  );
}

function ActionRow({
  label,
  symbol,
  icon,
  disabled,
  onClick
}: {
  key?: string;
  label: string;
  symbol?: string;
  icon?: 'send_grey' | 'swap_send' | 'swap_more' | 'add_liquidity';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        height: layout.actionHeight,
        borderRadius: layout.actionBorderRadius,
        border: 0,
        backgroundColor: 'rgba(255,255,255,0.06)',
        paddingLeft: layout.actionInsetX,
        paddingRight: layout.actionInsetX,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        textAlign: 'left',
        gap: layout.actionIconGap,
        boxSizing: 'border-box'
      }}>
      {icon ? (
        <Icon icon={icon} size={12} color="textDim" />
      ) : (
        <Text
          text={symbol}
          style={{
            width: 12,
            textAlign: 'center',
            fontSize: 18,
            lineHeight: '18px',
            color: 'rgba(255,255,255,0.65)',
            fontWeight: 500
          }}
        />
      )}
      <Text
        text={label}
        style={{
          fontSize: 14,
          color: 'rgba(255,255,255,0.65)',
          fontWeight: 400
        }}
      />
    </button>
  );
}
