import { BottomSheetHeader, Icon, Inline, Stack, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import type { IconTypes } from '@/ui/components/Icon';
import { AssetTabKey, MoreAssetTabKey, useI18n } from '@unisat/wallet-state';

export interface MoreActionItem {
  label: string;
  icon: IconTypes;
  assetTabKey: AssetTabKey;
  moreAssetTabKey?: MoreAssetTabKey;
}

export function MoreActionSheet(props: {
  items: MoreActionItem[];
  currentSelection?: { assetTabKey: AssetTabKey; moreAssetTabKey?: MoreAssetTabKey };
  onClose: () => void;
  onSelect: (selection: MoreActionItem) => void;
}) {
  const { items, currentSelection, onClose, onSelect } = props;
  const { t } = useI18n();

  return (
    <BottomModal onClose={onClose} bodyStyle={{ padding: 0 }}>
      <Stack fullX gap="zero">
        <BottomSheetHeader title={t('more')} onClose={onClose} inset={16} bottomSpacing={24} />
        <Stack
          fullX
          style={{
            paddingLeft: 16,
            paddingRight: 16,
            paddingBottom: 20,
            gap: 12,
            boxSizing: 'border-box'
          }}>
          {items.map((item) => (
            <MoreActionRow
              key={`${item.assetTabKey}:${item.moreAssetTabKey || ''}`}
              label={item.label}
              icon={item.icon}
              selected={currentSelection?.assetTabKey === item.assetTabKey &&
                (item.assetTabKey !== AssetTabKey.ALKANES || currentSelection.moreAssetTabKey === item.moreAssetTabKey)}
              onClick={() => onSelect(item)}
            />
          ))}
        </Stack>
      </Stack>
    </BottomModal>
  );
}

function MoreActionRow({
  label,
  icon,
  onClick,
  selected
}: {
  label: string;
  icon: IconTypes;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <Inline
      align="center"
      onClick={onClick}
      style={{
        width: '100%',
        minHeight: 48,
        borderRadius: 8,
        border: selected ? '1px solid rgba(237, 184, 58, 0.7)' : '1px solid transparent',
        backgroundColor: selected ? 'rgba(237, 184, 58, 0.12)' : 'rgba(255,255,255,0.06)',
        paddingLeft: 16,
        paddingRight: 16,
        cursor: 'pointer',
        boxSizing: 'border-box',
        gap: 8
      }}>
      <Icon icon={icon} size={18} />
      <Text text={label} style={{ fontSize: 14, color: 'rgba(255,255,255,0.78)', fontWeight: 400 }} />
    </Inline>
  );
}
