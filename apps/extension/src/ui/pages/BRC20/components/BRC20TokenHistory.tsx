import { Column, Icon, Row, Text, Tooltip } from '@/ui/components';
import { Empty } from '@/ui/components/Empty';
import { colors } from '@/ui/theme/colors';
import { fontSizes } from '@/ui/theme/font';
import { showLongNumber } from '@/ui/utils';
import { useBRC20TokenHistoryLogic, useI18n, useNavigation } from '@unisat/wallet-state';

const HISTORY_AMOUNT_MAX_LENGTH = 14;
const HISTORY_AMOUNT_MAX_DECIMALS = 4;

function getHistoryAmountDisplay(amount: string) {
  const fullText = showLongNumber(amount, -1);
  const normalized = fullText.replace(/,/g, '');

  if (fullText.length <= HISTORY_AMOUNT_MAX_LENGTH) {
    return { display: fullText, fullText, isTruncated: false };
  }

  if (normalized.includes('.')) {
    const [integerPart, decimalPart] = normalized.split('.');
    const integerDisplay = fullText.split('.')[0] ?? integerPart;

    if (decimalPart.length > HISTORY_AMOUNT_MAX_DECIMALS) {
      return {
        display: `${integerDisplay}.${decimalPart.slice(0, HISTORY_AMOUNT_MAX_DECIMALS)}...`,
        fullText,
        isTruncated: true
      };
    }
  }

  return {
    display: `${fullText.slice(0, HISTORY_AMOUNT_MAX_LENGTH)}...`,
    fullText,
    isTruncated: true
  };
}

function HistoryAmount({ amount }: { amount: string }) {
  const { display, fullText, isTruncated } = getHistoryAmountDisplay(amount);
  const amountText = (
    <Text text={display} ellipsis disableTranslate style={{ maxWidth: 140, textAlign: 'right' }} />
  );

  if (!isTruncated) {
    return amountText;
  }

  return (
    <Tooltip
      title={fullText}
      overlayStyle={{
        fontSize: fontSizes.xs
      }}>
      {amountText}
    </Tooltip>
  );
}

export function BRC20TokenHistory(props: { ticker: string; displayName?: string }) {
  const { t } = useI18n();
  const nav = useNavigation();
  const { isEmpty, isFailed, isLoading, displayItems } = useBRC20TokenHistoryLogic(props);

  if (isFailed) {
    return (
      <Column style={{ minHeight: 150 }} itemsCenter justifyCenter>
        <Text text={t('load_failed')} preset="sub" />
      </Column>
    );
  }

  if (isLoading) {
    return (
      <Column style={{ minHeight: 150 }} itemsCenter justifyCenter>
        <Text text={t('loading')} preset="sub" />
      </Column>
    );
  }

  if (isEmpty) {
    return (
      <Column fullX itemsCenter style={{ paddingTop: 24 }}>
        <Empty text={t('empty')} preset="assets" />
      </Column>
    );
  }

  return (
    <Column fullX>
      {displayItems.map(({ date, items }) => (
        <Column key={date} fullX gap="md" mb="md">
          <Text text={date} preset="sub" />
          {items
            .filter((item): item is NonNullable<typeof item> => item != null)
            .map((item) => (
              <Row
                key={item.key}
                fullX
                justifyBetween
                justifyCenter
                py="md"
                style={{ borderBottomWidth: 1, borderColor: colors.border2 }}>
                <Row itemsCenter style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                  <Row
                    onClick={() => {
                      nav.navToExplorerTx(item.txid);
                    }}
                    style={{ flexShrink: 0 }}>
                    <Icon icon={item.icon as any} size={32} />
                  </Row>

                  <Column gap="xs" style={{ minWidth: 0 }}>
                    <Row style={{ alignItems: 'start' }}>
                      <Text text={item.mainTitle} />

                      {item.pending ? (
                        <Row style={{ backgroundColor: 'rgba(244, 182, 44, 0.15)', borderRadius: 4 }} px="md" py="xs">
                          <Text text={t('history_pending')} style={{ color: 'rgba(244, 182, 44, 0.85)' }} size="xs" />
                        </Row>
                      ) : null}
                    </Row>

                    {item.subTitle ? <Text text={item.subTitle} preset="sub" /> : null}
                  </Column>
                </Row>

                {item.amount !== '0' ? (
                  <Row itemsCenter style={{ flexShrink: 0 }}>
                    <HistoryAmount amount={item.amount} />
                  </Row>
                ) : null}
              </Row>
            ))}
        </Column>
      ))}
    </Column>
  );
}
