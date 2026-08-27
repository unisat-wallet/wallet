import { ColorTypes } from '@/ui/theme/colors';
import { copyToClipboard, shortAddress } from '@/ui/utils';
import { useI18n, useTools } from '@unisat/wallet-state';

import { Icon } from '../Icon';
import { Row } from '../Row';
import { Text } from '../Text';

export function CopyableAddress({
  address,
  color,
  copyPosition = 'before',
  len = 6,
  suffix
}: {
  address: string;
  copyPosition?: 'before' | 'after';
  len?: number;
  color?: ColorTypes;
  suffix?: React.ReactNode;
}) {
  const tools = useTools();
  const { t } = useI18n();
  return (
    <Row
      itemsCenter
      gap="sm"
      onClick={(e) => {
        copyToClipboard(address).then(() => {
          tools.toastSuccess(t('copied'));
        });
      }}>
      {copyPosition === 'before' && <Icon icon="copy" color={color ?? 'textDim'} />}
      <Text text={shortAddress(address, len)} color={color ?? 'textDim'} />
      {suffix && suffix}
      {copyPosition === 'after' && <Icon icon="copy" color={color ?? 'textDim'} />}
    </Row>
  );
}
