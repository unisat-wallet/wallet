import { Icon, Text } from '@/ui/components';
import { spacing } from '@/ui/theme/spacing';

export interface InfoCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon?: string;
  iconColor?: string;
  status?: 'default' | 'success' | 'warning' | 'error';
  size?: 'small' | 'medium' | 'large';
  extra?: React.ReactNode;
  onClick?: () => void;
}

type CardStatus = NonNullable<InfoCardProps['status']>;
type CardSize = NonNullable<InfoCardProps['size']>;

const STATUS_CONFIG: Record<
  CardStatus,
  {
    bg: string;
    border: string;
    iconColor: string;
  }
> = {
  default: {
    bg: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    iconColor: 'textDim'
  },
  success: {
    bg: 'linear-gradient(135deg, rgba(76, 175, 80, 0.15) 0%, rgba(76, 175, 80, 0.05) 100%)',
    border: '1px solid rgba(76, 175, 80, 0.3)',
    iconColor: '#4CAF50'
  },
  warning: {
    bg: 'linear-gradient(135deg, rgba(255, 193, 7, 0.15) 0%, rgba(255, 193, 7, 0.05) 100%)',
    border: '1px solid rgba(255, 193, 7, 0.3)',
    iconColor: '#FFC107'
  },
  error: {
    bg: 'linear-gradient(135deg, rgba(244, 67, 54, 0.15) 0%, rgba(244, 67, 54, 0.05) 100%)',
    border: '1px solid rgba(244, 67, 54, 0.3)',
    iconColor: '#F44336'
  }
};

const SIZE_CONFIG: Record<
  CardSize,
  {
    minHeight: number;
    padding: number;
    iconSize: number;
    titleSize: 'xs' | 'sm';
    valueSize: 'xs' | 'sm' | 'md';
  }
> = {
  small: {
    minHeight: 60,
    padding: spacing.small,
    iconSize: 14,
    titleSize: 'xs',
    valueSize: 'xs'
  },
  medium: {
    minHeight: 80,
    padding: spacing.small,
    iconSize: 16,
    titleSize: 'xs',
    valueSize: 'sm'
  },
  large: {
    minHeight: 100,
    padding: spacing.medium,
    iconSize: 20,
    titleSize: 'sm',
    valueSize: 'md'
  }
};

export default function InfoCard({
  title,
  value,
  subtitle,
  icon,
  iconColor,
  status = 'default',
  size = 'medium',
  extra,
  onClick
}: InfoCardProps) {
  const statusCfg = STATUS_CONFIG[status];
  const sizeCfg = SIZE_CONFIG[size];

  const finalIconColor = iconColor ?? statusCfg.iconColor;

  return (
    <div
      style={{
        background: statusCfg.bg,
        border: statusCfg.border,
        minHeight: sizeCfg.minHeight,
        padding: sizeCfg.padding,
        borderRadius: 12,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        position: 'relative'
      }}
      onClick={onClick}>
      {icon && (
        <Icon icon={icon as any} size={sizeCfg.iconSize} color={finalIconColor as any} style={{ marginBottom: 4 }} />
      )}

      <Text text={title} preset="regular" color="textDim" size={sizeCfg.titleSize} style={{ marginBottom: 2 }} />

      <Text text={value} preset="bold" color="white" size={sizeCfg.valueSize} />

      {subtitle && <Text text={subtitle} preset="regular" color="textDim" size="xs" style={{ marginTop: 2 }} />}

      {extra && <div style={{ position: 'absolute', top: 4, right: 4 }}>{extra}</div>}
    </div>
  );
}
