import { ReactEventHandler, useState } from 'react';

import { ReloadOutlined } from '@ant-design/icons';
import { useI18n } from '@unisat/wallet-state';

import { Row } from '../Row';
import { Text } from '../Text';
import styles from './index.module.less';

export function RefreshButton({
  onClick,
  hideText = false,
  iconColor = 'rgba(0,0,0,0.5)'
}: {
  onClick: ReactEventHandler<HTMLDivElement>;
  hideText?: boolean;
  iconColor?: string;
}) {
  const [leftTime, setLeftTime] = useState(0);
  const [disabled, setDisabled] = useState(false);
  const [isRotating, setIsRotating] = useState(false);

  const wait = (seconds: number) => {
    if (seconds > 0) {
      setLeftTime(seconds);
      setTimeout(() => {
        wait(seconds - 1);
      }, 1000);
      return;
    }
    setDisabled(false);
  };
  const { t } = useI18n();

  return (
    <div data-card-action="true">
      <Row
        mx={hideText ? 'zero' : 'md'}
        itemsCenter
        onClick={(e) => {
          e.stopPropagation();
        if (disabled) {
          return;
        }
        setDisabled(true);
        setIsRotating(true);

        setTimeout(() => {
          setIsRotating(false);
        }, 1000);

        wait(5);
        onClick(e);
      }}
      style={hideText ? { padding: 6, margin: -6 } : { padding: '6px 8px', margin: '-6px -8px' }}>
      <ReloadOutlined className={isRotating ? styles.rotate : ''} style={{ fontSize: 14, color: iconColor }} />
      {!hideText && (
        <Text text={disabled ? `${leftTime} ${t('secs')}` : t('refresh')} color="black_muted" size="sm" textCenter />
      )}
    </Row>
    </div>
  );
}
