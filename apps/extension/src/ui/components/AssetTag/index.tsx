import { useI18n } from '@unisat/wallet-state';

import { Row } from '../Row';
import { Text } from '../Text';

export interface AssetTagProps {
  type: 'brc-20' | 'ARC20' | 'Inscription' | 'Unconfirmed' | 'Runes' | 'Alkanes';
  small?: boolean;
}

const colors = {
  'brc-20': 'rgba(244, 182, 44, 0.2)',
  ARC20: '#2B4E8B',
  Inscription: '#62A759',
  Unconfirmed: '#BC9238',
  Runes: '#A14419',
  Alkanes: 'rgba(62, 126, 224, 0.3)'
};

export default function AssetTag(props: AssetTagProps) {
  const { type, small } = props;
  const { t } = useI18n();

  const displayText = () => {
    if (type === 'Runes') {
      return t('runes');
    } else if (type === 'Unconfirmed') {
      return t('unconfirmed');
    } else if (type === 'Inscription') {
      return t('inscription');
    }
    return type;
  };

  return (
    <Row
      style={{ backgroundColor: colors[type], borderRadius: small ? 4 : 5 }}
      px={small ? 'sm' : 'md'}
      py={small ? 'zero' : 'xs'}
      itemsCenter>
      <Text text={displayText()} size={small ? 'xxs' : 'xs'} />
    </Row>
  );
}
