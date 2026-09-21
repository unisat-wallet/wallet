import { CSSProperties } from 'react';

import { colors } from '@/ui/theme/colors';
import { useFeeRateBarLogic, useI18n, useNavigation } from '@unisat/wallet-state';

import { LOW_FEE_GUIDE_URL } from '@unisat/wallet-shared';
import { Column } from '../Column';
import { Input } from '../Input';
import { LowFeeModePopover } from '../LowFeeModePopover';
import { Row } from '../Row';
import { Text } from '../Text';
import { sendInputContainerStyle } from '../TransferAmountCard';
import { FeeRateType } from './const';

const FEE_CARD_HEIGHT = 90;
const FEE_CARD_BORDER_RADIUS = 8;
const FEE_CARD_DESC_HEIGHT = 34;
const FEE_CARD_DESC_PADDING_Y = 4;
const FEE_CARD_DESC_LINE_HEIGHT = (FEE_CARD_DESC_HEIGHT - FEE_CARD_DESC_PADDING_Y * 2) / 2;
const FEE_CARD_TOP_PADDING = 8;
const FEE_CARD_CONTENT_DESC_GAP = 2;

const FEE_TITLE_COLORS: Record<number, string> = {
  [FeeRateType.SLOW]: '#f55454',
  [FeeRateType.AVG]: '#d5a846',
  [FeeRateType.FAST]: '#72c78b'
};

function getCardStyle(selected: boolean): CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    height: FEE_CARD_HEIGHT,
    borderRadius: FEE_CARD_BORDER_RADIUS,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: selected ? '#ebb94c' : 'rgba(255, 255, 255, 0.15)',
    backgroundColor: selected ? 'rgba(235, 185, 76, 0.1)' : 'rgba(255, 255, 255, 0.08)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    cursor: 'pointer',
    overflow: 'hidden'
  };
}

function FeeRateValue({ feeRate }: { feeRate: number }) {
  return (
    <div style={{ textAlign: 'center', lineHeight: '20px' }}>
      <span style={{ fontSize: 14, fontWeight: 500, color: colors.white }}>{feeRate}</span>
      <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}> sat/vB</span>
    </div>
  );
}

export function FeeRateBar({ readonly }: { readonly?: boolean }) {
  const {
    feeOptions,
    feeOptionIndex,
    setFeeOptionIndex,
    isSpecialLocale,
    isCustomOption,
    feeRateInputVal,
    adjustFeeRateInput,
    toggleLowFeeRate,
    showCustomInput,
    supportLowFeeMode,
    isSub1FeeOptionOn,
    showLowFeeModeTipsPopover,
    setShowLowFeeModeTipsPopover
  } = useFeeRateBarLogic({
    readonly
  });

  const { t } = useI18n();
  const nav = useNavigation();

  return (
    <Column gap="md" fullX>
      <Text text={t('fee')} size="sm" style={{ color: 'rgba(255, 255, 255, 0.8)' }} />

      <Row gap="md" fullX>
        {feeOptions.map((v, index) => {
          let selected = index === feeOptionIndex;
          if (readonly) {
            selected = false;
          }

          const isCustom = isCustomOption(v);
          const isSub1Option = supportLowFeeMode && index === FeeRateType.SLOW;
          const titleColor =
            isCustom || isSub1Option ? colors.white : FEE_TITLE_COLORS[index] ?? colors.white;

          return (
            <div
              key={v.title}
              onClick={() => {
                if (readonly) {
                  return;
                }
                setFeeOptionIndex(index);
              }}
              style={{
                ...getCardStyle(selected),
                justifyContent: isCustom || !v.desc ? 'center' : 'flex-start',
                gap: v.desc ? FEE_CARD_CONTENT_DESC_GAP : 0,
                paddingTop: 0
              }}
              data-testid={`fee-rate-option-${index}`}>
              {isCustom ? (
                <Text
                  text={v.title}
                  textCenter
                  size="sm"
                  style={{
                    color: colors.white,
                    fontSize: isSpecialLocale ? 7 : 14
                  }}
                />
              ) : (
                <>
                  <div
                    style={{
                      flex: v.desc ? 1 : undefined,
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: v.desc ? 'flex-end' : 'center',
                      paddingTop: v.desc ? FEE_CARD_TOP_PADDING : 0,
                      minHeight: 0
                    }}>
                    <Column itemsCenter gap="zero" style={{ width: '100%' }}>
                      <Text
                        text={v.title}
                        textCenter
                        size="sm"
                        style={{
                          color: titleColor,
                          fontSize: isSpecialLocale ? 12 : 14,
                          lineHeight: '20px',
                          margin: 0
                        }}
                      />
                      <FeeRateValue feeRate={v.feeRate} />
                    </Column>
                  </div>
                  {v.desc ? (
                    <div
                      style={{
                        width: '100%',
                        height: FEE_CARD_DESC_HEIGHT,
                        flexShrink: 0,
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        borderBottomLeftRadius: FEE_CARD_BORDER_RADIUS,
                        borderBottomRightRadius: FEE_CARD_BORDER_RADIUS,
                        boxSizing: 'border-box',
                        padding: `${FEE_CARD_DESC_PADDING_Y}px 6px`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                      <p
                        style={{
                          margin: 0,
                          width: '100%',
                          fontSize: 11,
                          lineHeight: `${FEE_CARD_DESC_LINE_HEIGHT}px`,
                          color: 'rgba(255, 255, 255, 0.45)',
                          textAlign: 'center'
                        }}>
                        {v.desc}
                      </p>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </Row>

      {isSub1FeeOptionOn ? (
        <Row itemsCenter>
          <Row
            itemsCenter
            onClick={() => {
              nav.navToUrl(LOW_FEE_GUIDE_URL);
            }}>
            <Text text={t('view_low_fee_mode_guide') + ' >'} color="gold" preset="link" />
          </Row>
        </Row>
      ) : null}
      {showCustomInput && (
        <Input
          preset="amount"
          placeholder={'sat/vB'}
          value={feeRateInputVal}
          runesDecimal={2}
          onAmountInputChange={(amount) => {
            adjustFeeRateInput(amount);
          }}
          autoFocus={true}
          enableStepper={true}
          step={0.01}
          min={supportLowFeeMode ? 0.1 : 1}
          containerStyle={sendInputContainerStyle}
        />
      )}

      {showLowFeeModeTipsPopover && (
        <LowFeeModePopover
          onConfirm={() => {
            setShowLowFeeModeTipsPopover(false);
            toggleLowFeeRate();
          }}
          onClose={() => setShowLowFeeModeTipsPopover(false)}
        />
      )}
    </Column>
  );
}
