import { useEffect, useState } from 'react';

import { BottomSheetHeader, Icon, Inline, Stack, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { MoreAssetTabKey, useI18n } from '@unisat/wallet-state';

export function MoreActionSheet(props: {
  currentSelection?: MoreAssetTabKey;
  onClose: () => void;
  onSelect: (selection: MoreAssetTabKey) => void;
}) {
  const { currentSelection, onClose, onSelect } = props;
  const { t } = useI18n();
  const [selected, setSelected] = useState<MoreAssetTabKey | undefined>(currentSelection);

  useEffect(() => {
    setSelected(currentSelection);
  }, [currentSelection]);

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
          <MoreActionRow
            label={t('alkanes')}
            icon="alkanes"
            selected={selected === MoreAssetTabKey.ALKANES_TOKEN}
            onClick={() => {
              setSelected(MoreAssetTabKey.ALKANES_TOKEN);
              onSelect(MoreAssetTabKey.ALKANES_TOKEN);
            }}
          />
          <MoreActionRow
            label={t('alkanes_collections')}
            icon="alkanes"
            selected={selected === MoreAssetTabKey.ALKANES_COLLECTION}
            onClick={() => {
              setSelected(MoreAssetTabKey.ALKANES_COLLECTION);
              onSelect(MoreAssetTabKey.ALKANES_COLLECTION);
            }}
          />
        </Stack>
      </Stack>
    </BottomModal>
  );
}

function MoreActionRow({
  label,
  icon,
  tag,
  onClick,
  selected
}: {
  label: string;
  icon: 'alkanes';
  tag?: string;
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
      {tag ? (
        <Text
          text={tag}
          size="xs"
          color="white_muted"
          px="sm"
          py="sm"
          style={{ borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)' }}
        />
      ) : null}
    </Inline>
  );
}
