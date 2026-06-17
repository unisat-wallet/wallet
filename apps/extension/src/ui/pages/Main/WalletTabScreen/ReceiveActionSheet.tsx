import { IMAGE_SOURCE_MAP } from '@/shared/constant';
import { BottomSheetHeader, Icon, Image, Inline, Stack, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import type { TypeChain } from '@unisat/wallet-shared';
import { useI18n } from '@unisat/wallet-state';

export type ReceiveAssetKey = 'btc' | 'rgb';

export function ReceiveActionSheet(props: {
  chain: TypeChain;
  onClose: () => void;
  onSelect: (selection: ReceiveAssetKey) => void;
}) {
  const { chain, onClose, onSelect } = props;
  const { t } = useI18n();

  return (
    <BottomModal onClose={onClose} bodyStyle={{ padding: 0 }}>
      <Stack fullX gap="zero">
        <BottomSheetHeader title={t('receive')} onClose={onClose} inset={16} bottomSpacing={24} />
        <Stack
          fullX
          style={{
            paddingLeft: 16,
            paddingRight: 16,
            paddingBottom: 20,
            gap: 12,
            boxSizing: 'border-box'
          }}
        >
          <ReceiveActionRow
            label={chain.iconLabel}
            imageSrc={IMAGE_SOURCE_MAP[chain.icon]}
            onClick={() => onSelect('btc')}
          />
          <ReceiveActionRow
            label={t('rgb')}
            icon="rgb"
            onClick={() => {
              onSelect('rgb');
            }}
          />
        </Stack>
      </Stack>
    </BottomModal>
  );
}

function ReceiveActionRow({
  label,
  icon,
  imageSrc,
  onClick
}: {
  label: string;
  icon?: 'rgb';
  imageSrc?: string;
  onClick: () => void;
}) {
  return (
    <Inline
      align="center"
      onClick={onClick}
      style={{
        width: '100%',
        minHeight: 48,
        borderRadius: 8,
        border: '1px solid transparent',
        backgroundColor: 'rgba(255,255,255,0.06)',
        paddingLeft: 16,
        paddingRight: 16,
        cursor: 'pointer',
        boxSizing: 'border-box',
        gap: 8
      }}
    >
      {imageSrc ? <Image src={imageSrc} size={24} /> : <Icon icon={icon} size={24} />}
      <Text text={label} style={{ fontSize: 14, color: 'rgba(255,255,255,0.78)', fontWeight: 400 }} />
    </Inline>
  );
}
