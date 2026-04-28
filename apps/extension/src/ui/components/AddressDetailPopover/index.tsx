import { useAddressExplorerUrl, useI18n, useTools } from '@unisat/wallet-state';

import { Card } from '../Card';
import { Column } from '../Column';
import { Icon } from '../Icon';
import { Popover } from '../Popover';
import { Row } from '../Row';
import { Text } from '../Text';
import { ViewOnExplorerAction } from '../ViewOnExplorerAction';

export const AddressDetailPopover = ({ address, onClose }: { address: string; onClose: () => void }) => {
  const tools = useTools();
  const addressExplorerUrl = useAddressExplorerUrl(address);
  const { t } = useI18n();
  const isOpReturn = address.startsWith('OP_RETURN');
  const title = isOpReturn ? 'OP_RETURN' : t('address');
  const showAddressExplorer = !isOpReturn;

  const onCopyAddress = () => {
    tools.copyToClipboard(address);
  };

  const onViewOnExplorer = () => {
    tools.openUrl(addressExplorerUrl);
  };

  return (
    <Popover onClose={onClose}>
      <Column>
        <Text text={title} textCenter />
        <Card preset="style2" onClick={onCopyAddress} style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
          <Row itemsCenter>
            <Text
              text={address}
              style={{
                overflowWrap: 'anywhere'
              }}
            />
            <Icon icon="copy" />
          </Row>
        </Card>

        {showAddressExplorer && (
          <ViewOnExplorerAction onClick={onViewOnExplorer} mt="md" />
        )}
      </Column>
    </Popover>
  );
};
