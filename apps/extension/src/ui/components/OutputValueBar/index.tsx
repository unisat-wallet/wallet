import { CSSProperties, useEffect, useState } from 'react';

import { useI18n } from '@unisat/wallet-state';

import { useTools } from '@unisat/wallet-state';
import { Column } from '../Column';
import { Input } from '../Input';
import { Row } from '../Row';
import { Text } from '../Text';

enum FeeRateType {
  CURRENT,
  CUSTOM
}

function getOptionStyle(selected: boolean): CSSProperties {
  return {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: selected ? '#ebb94c' : 'rgba(255, 255, 255, 0.15)',
    backgroundColor: selected ? 'rgba(235, 185, 76, 0.1)' : 'rgba(255, 255, 255, 0.08)',
    height: 64,
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    padding: 4,
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    cursor: 'pointer',
    boxSizing: 'border-box'
  };
}

export function OutputValueBar({
  defaultValue,
  minValue,
  onChange
}: {
  defaultValue: number;
  minValue: number;
  onChange: (val: number) => void;
}) {
  const tools = useTools();
  const { t, isSpecialLocale } = useI18n();

  const options = [
    {
      title: t('current'),
      value: defaultValue
    },
    {
      title: t('custom')
    }
  ];
  const [optionIndex, setOptionIndex] = useState(FeeRateType.CURRENT);
  const [inputVal, setInputVal] = useState('');
  const [currentValue, setCurrentValue] = useState(defaultValue);

  useEffect(() => {
    let val: any = defaultValue;
    if (optionIndex === FeeRateType.CUSTOM) {
      if (!inputVal) {
        onChange(0);
        setCurrentValue(0);
        return;
      }
      val = parseInt(inputVal);
    } else if (options.length > 0) {
      val = options[optionIndex].value;
    }
    // if (val + '' != inputVal) {
    //   setInputVal(val);
    // }
    onChange(val);
    setCurrentValue(val);
  }, [optionIndex, inputVal]);

  useEffect(() => {
    if (minValue && currentValue < minValue) {
      // setOptionIndex(FeeRateType.CUSTOM);
      // setInputVal(minValue + '');
    }
  }, [minValue, currentValue]);

  return (
    <Column fullX>
      <Row gap="md" fullX>
        {options.map((v, index) => {
          const selected = index === optionIndex;
          return (
            <div
              key={v.title}
              data-testid={`output-value-option-${index}`}
              onClick={() => {
                if (defaultValue < minValue && index === 0) {
                  tools.showTip(t('can_not_change_to_a_lower_value'));
                  return;
                }
                setOptionIndex(index);
              }}
              style={getOptionStyle(selected)}>
              <Text
                text={v.title}
                color="white"
                textCenter
                style={{
                  fontSize: isSpecialLocale ? '8px' : '14px'
                }}
              />
              {v.value ? (
                <Text text={`${v.value} sats`} color="white" textCenter size="xs" style={{ opacity: 0.8 }} />
              ) : null}
            </div>
          );
        })}
      </Row>
      {optionIndex === FeeRateType.CUSTOM && (
        <Input
          preset="amount"
          disableDecimal
          placeholder={'sats'}
          value={inputVal}
          onAmountInputChange={(val) => {
            setInputVal(val);
          }}
          onBlur={() => {
            if (inputVal) {
              const val = parseInt(inputVal || '0') + '';
              setInputVal(val);
            }
          }}
          autoFocus={true}
          data-testid="output-value-custom-input"
        />
      )}
    </Column>
  );
}
