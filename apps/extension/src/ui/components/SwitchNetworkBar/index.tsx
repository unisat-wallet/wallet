import { useState } from 'react';

import { SwitchChainModal } from '@/ui/pages/Settings/SwitchChainModal';
import { useChain } from '@unisat/wallet-state';

import { IMAGE_SOURCE_MAP } from '@/shared/constant';
import { Card } from '../Card';
import { Icon } from '../Icon';
import { Image } from '../Image';
import { Row } from '../Row';
import { Text } from '../Text';

export function SwitchNetworkBar() {
  const [switchChainModalVisible, setSwitchChainModalVisible] = useState(false);

  const chain = useChain();

  return (
    <Card
      preset="style2"
      style={{
        backgroundColor: 'rgba(255,255,255,0.12)',
        height: 28,
        borderRadius: 8,
        padding: '0 6px',
        gap: 4,
        boxSizing: 'border-box'
      }}>
      <Row
        itemsCenter
        data-testid="switch-network-bar"
        onClick={() => {
          setSwitchChainModalVisible(true);
        }}>
        <Image src={IMAGE_SOURCE_MAP[chain.icon]} size={16} style={{ display: 'block' }} />
        <Text text={chain.iconLabel} color="white" size="xs" style={{ lineHeight: '16px' }} />
        <Icon icon="down" color="textDim" size={10} />
      </Row>
      {switchChainModalVisible && (
        <SwitchChainModal
          onClose={() => {
            setSwitchChainModalVisible(false);
          }}
        />
      )}
    </Card>
  );
}
