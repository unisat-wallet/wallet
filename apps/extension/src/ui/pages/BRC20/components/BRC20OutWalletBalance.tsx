import { Column, Row, Text, Tooltip } from '@/ui/components';
import { fontSizes } from '@/ui/theme/font';
import { type BRC20OutWalletBalanceItem } from '@unisat/wallet-state';

interface BRC20OutWalletBalanceProps {
  items: BRC20OutWalletBalanceItem[];
  expandAction?: {
    itemKey: string;
    label: string;
    expanded: boolean;
    onClick: () => void;
  };
}

export function BRC20OutWalletBalance(props: BRC20OutWalletBalanceProps) {
  const { items, expandAction } = props;

  return (
    <Column
      fullX
      style={{
        gap: 12
      }}>
      {items.map((item, index) => (
        <Column
          key={item.key}
          fullX
          style={{
            gap: 12
          }}>
          <Row
            fullX
            justifyBetween
            itemsCenter
            gap="zero"
            style={{
              minHeight: 24
            }}>
            <Text
              text={item.label}
              size="sm"
              ellipsis
              style={{
                color: 'rgba(255,255,255,0.55)',
                fontWeight: 500,
                minWidth: 0,
                flex: 1
              }}
            />
            <Row itemsCenter gap="zero" style={{ flexShrink: 0 }}>
              <Tooltip
                title={item.amount}
                overlayStyle={{
                  fontSize: fontSizes.xs
                }}>
                <Text
                  text={item.displayAmount}
                  size="sm"
                  digital
                  textEnd
                  style={{
                    color: 'rgba(255,255,255,0.9)',
                    fontWeight: 600
                  }}
                />
              </Tooltip>
              {item.key === expandAction?.itemKey ? (
                <button
                  type="button"
                  aria-label={expandAction.label}
                  aria-expanded={expandAction.expanded}
                  title={expandAction.label}
                  onClick={expandAction.onClick}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    marginLeft: 6,
                    padding: 0,
                    border: 0,
                    borderRadius: 6,
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.65)',
                    cursor: 'pointer'
                  }}>
                  <svg
                    width="12"
                    height="9"
                    viewBox="0 0 12 9"
                    fill="none"
                    aria-hidden="true"
                    style={{ transform: expandAction.expanded ? 'rotate(180deg)' : undefined }}>
                    <path d="M1 2L6 7L11 2Z" fill="currentColor" />
                  </svg>
                </button>
              ) : null}
            </Row>
          </Row>

          {index === 0 && items.length > 1 ? (
            <Row
              fullX
              style={{
                borderBottomWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)'
              }}
            />
          ) : null}
        </Column>
      ))}
    </Column>
  );
}
