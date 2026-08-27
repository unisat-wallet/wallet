import { Column, Row, Text, Tooltip } from '@/ui/components';
import { fontSizes } from '@/ui/theme/font';
import { type BRC20OutWalletBalanceItem } from '@unisat/wallet-state';

interface BRC20OutWalletBalanceProps {
  items: BRC20OutWalletBalanceItem[];
}

export function BRC20OutWalletBalance(props: BRC20OutWalletBalanceProps) {
  const { items } = props;

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
              style={{
                color: 'rgba(255,255,255,0.55)',
                fontWeight: 500
              }}
            />
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
