import { Column, Icon, Row, Text } from '@/ui/components';
import { Empty } from '@/ui/components/Empty';
import { HistoryAmount } from '@/ui/components/HistoryAmount';
import { colors } from '@/ui/theme/colors';
import { useBRC20TokenHistoryLogic, useI18n, useNavigation } from '@unisat/wallet-state';

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
