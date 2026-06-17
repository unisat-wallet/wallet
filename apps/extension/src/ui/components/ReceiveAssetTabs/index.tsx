import { IMAGE_SOURCE_MAP } from '@/shared/constant';
import { Icon, Image, Row, Text } from '@/ui/components';

type ReceiveAssetTab = 'btc' | 'rgb';

type ReceiveAssetTabsProps = {
  active: ReceiveAssetTab;
  onBtcClick?: () => void;
  onRgbClick?: () => void;
};

const GOLD = '#F4B62C';

const tabStyle = (selected: boolean) => ({
  flex: 1,
  height: 40,
  borderRadius: 10,
  border: selected ? `1px solid ${GOLD}` : '1px solid transparent',
  background: selected ? 'rgba(244,182,44,0.08)' : 'rgba(255,255,255,0.08)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  cursor: 'pointer',
  boxSizing: 'border-box' as const
});

export function ReceiveAssetTabs(props: ReceiveAssetTabsProps) {
  const { active, onBtcClick, onRgbClick } = props;

  return (
    <Row fullX gap="md">
      <div style={tabStyle(active === 'btc')} onClick={onBtcClick}>
        <Image src={IMAGE_SOURCE_MAP['bitcoinMainnet']} size={18} />
        <Text text="BTC" color={active === 'btc' ? 'gold' : 'white_muted2'} size="md" />
      </div>
      <div style={tabStyle(active === 'rgb')} onClick={onRgbClick}>
        <Icon icon="rgb" size={18} />
        <Text text="RGB" color={active === 'rgb' ? 'gold' : 'white_muted2'} size="md" />
      </div>
    </Row>
  );
}
