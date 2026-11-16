import { copyToClipboard, shortAddress } from '@/ui/utils';
import { openSafeUrl } from '@/ui/utils/openSafeUrl';
import { CopyOutlined } from '@ant-design/icons';
import { useI18n, useTools } from '@unisat/wallet-state';

import { Row } from '../Row';
import { Text } from '../Text';

export function Section({
  value,
  title,
  link,
  onClick,
  showCopyIcon,
  maxLength = 20,
  wrapValue = false,
  rightComponent
}: {
  value: string | number;
  title: string;
  link?: string;
  onClick?: () => void;
  showCopyIcon?: boolean;
  maxLength?: number;
  wrapValue?: boolean;
  rightComponent?: React.ReactNode;
}) {
  const tools = useTools();
  const { t } = useI18n();

  let displayText = value?.toString();
  if (value && typeof value === 'string' && value.length > maxLength) {
    displayText = shortAddress(value, maxLength / 2);
  }

  return (
    <Row
      justifyBetween
      itemsCenter={!wrapValue}
      px="md"
      style={{
        minHeight: 25
      }}>
      <Text text={title} preset="regular" />
      {rightComponent ? (
        rightComponent
      ) : (
        <Row
          style={{ minWidth: 0, maxWidth: '68%', justifyContent: 'flex-end' }}
          onClick={() => {
            if (onClick) {
              onClick();
            } else if (link) {
              openSafeUrl(link);
            } else {
              copyToClipboard(value).then(() => {
                tools.toastSuccess(t('copied'));
              });
            }
          }}>
          <Text
            text={displayText}
            preset={link || onClick ? 'link' : 'regular'}
            size="xs"
            wrap={wrapValue}
            textEnd
            style={{ minWidth: 0 }}
          />
          {showCopyIcon && <CopyOutlined style={{ color: '#888', fontSize: 14 }} />}
        </Row>
      )}
    </Row>
  );
}
