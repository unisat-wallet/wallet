import { useI18n } from '@unisat/wallet-state';

import { Column } from '../Column';
import { Image } from '../Image';
import { Text } from '../Text';

interface EmptyProps {
  text?: string;
  preset?: 'simple' | 'assets';
}

export function Empty(props: EmptyProps) {
  const { text, preset = 'assets' } = props;
  const { t } = useI18n();
  const content = text || t('no_data');

  if (preset === 'assets') {
    return (
      <Column itemsCenter style={{ gap: 4, width: 164 }}>
        <Image src="./images/icons/status/empty-box.svg" width={85} height={59} />
        <Text
          text={content}
          size="sm"
          textCenter
          style={{
            color: 'rgba(255, 255, 255, 0.45)'
          }}
        />
      </Column>
    );
  }

  return (
    <div
      style={{
        alignSelf: 'center'
      }}>
      <Text text={content} preset="sub" textCenter />
    </div>
  );
}
