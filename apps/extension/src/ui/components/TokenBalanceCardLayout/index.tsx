import { CSSProperties, ReactNode } from 'react';

import { Column } from '../Column';
import { TokenBalancePrice } from '../TokenBalancePrice';

export const TOKEN_BALANCE_CARD_HEIGHT = 68;
export const TOKEN_BALANCE_CARD_PADDING_Y = 10;
const ICON_COLUMN_WIDTH = 35;
const CONTENT_GAP = 8;

export const tokenBalanceCardStyle: CSSProperties = {
  backgroundColor: 'rgba(255, 255, 255, 0.08)',
  borderColor: 'rgba(255,255,255,0.1)',
  borderRadius: 12,
  boxSizing: 'border-box',
  paddingTop: TOKEN_BALANCE_CARD_PADDING_Y,
  paddingBottom: TOKEN_BALANCE_CARD_PADDING_Y,
  paddingLeft: 12,
  paddingRight: 12,
  alignItems: 'stretch',
  width: '100%',
  overflow: 'hidden',
  flexDirection: 'column'
};

export function getTokenBalanceCardStyle(adaptive = false): CSSProperties {
  return {
    ...tokenBalanceCardStyle,
    minHeight: TOKEN_BALANCE_CARD_HEIGHT,
    height: adaptive ? 'auto' : TOKEN_BALANCE_CARD_HEIGHT,
    justifyContent: adaptive ? 'flex-start' : 'center',
    gap: adaptive ? TOKEN_BALANCE_CARD_PADDING_Y : 0
  };
}

const cardGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `${ICON_COLUMN_WIDTH}px minmax(0, 1fr)`,
  gap: CONTENT_GAP,
  width: '100%',
  overflow: 'hidden',
  alignItems: 'center'
};

const titleRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: CONTENT_GAP,
  width: '100%',
  alignItems: 'start'
};

const titleCellStyle: CSSProperties = {
  minWidth: 0,
  maxWidth: '100%',
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start'
};

const titleNameStyle: CSSProperties = {
  minWidth: 0,
  width: '100%',
  overflow: 'hidden',
  flex: '0 1 auto'
};

const titleExtraStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  justifyContent: 'flex-start',
  gap: 4
};

const quantityCellStyle: CSSProperties = {
  flexShrink: 0,
  whiteSpace: 'nowrap',
  justifySelf: 'end'
};

export type TokenBalanceCardLayoutProps = {
  icon: ReactNode;
  title: ReactNode;
  quantity: ReactNode;
  balance: string;
  showPrice?: boolean;
  price?: any;
  priceContent?: ReactNode;
  titleExtra?: ReactNode;
  onIconClick?: () => void;
};

export function TokenBalanceCardLayout({
  icon,
  title,
  quantity,
  balance,
  showPrice,
  price,
  priceContent,
  titleExtra,
  onIconClick
}: TokenBalanceCardLayoutProps) {
  return (
    <Column gap={titleExtra ? 'md' : 'zero'} style={{ width: '100%', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ ...cardGridStyle, alignItems: titleExtra ? 'start' : 'center' }}>
        <div onClick={onIconClick} style={{ flexShrink: 0 }}>
          {icon}
        </div>
        <Column gap="xs" style={{ minWidth: 0, overflow: 'hidden' }}>
          <div style={titleRowStyle}>
            <div style={titleCellStyle}>
              <div style={titleNameStyle}>{title}</div>
            </div>
            <div style={quantityCellStyle}>{quantity}</div>
          </div>
          {priceContent ?? <TokenBalancePrice showPrice={showPrice} price={price} balance={balance} />}
        </Column>
      </div>
      {titleExtra ? <div style={titleExtraStyle}>{titleExtra}</div> : null}
    </Column>
  );
}
