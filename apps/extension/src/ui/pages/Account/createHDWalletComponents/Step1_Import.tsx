import { useEffect, useRef, useState } from 'react';

import { Button, Card, Checkbox, Column, Grid, Icon, Input, Row, Text } from '@/ui/components';
import { FooterButtonContainer } from '@/ui/components/FooterButtonContainer';
import { ContextData, UpdateContextDataParams } from '@/ui/pages/Account/createHDWalletComponents/types';
import { colors } from '@/ui/theme/colors';
import { useCreateWalletLogicImportWordsStep } from '@unisat/wallet-state';

const SLOTS_PER_ROW = 3;
const INITIAL_VISIBLE_SLOT_COUNT = SLOTS_PER_ROW * 2;

function getRequiredVisibleSlotCount(words: string[]): number {
  let completedRowCount = 0;

  while (completedRowCount * SLOTS_PER_ROW < words.length) {
    const rowStart = completedRowCount * SLOTS_PER_ROW;
    const row = words.slice(rowStart, rowStart + SLOTS_PER_ROW);

    if (row.length !== SLOTS_PER_ROW || row.some((word) => !word.trim())) {
      break;
    }

    completedRowCount += 1;
  }

  return Math.min(words.length, Math.max(INITIAL_VISIBLE_SLOT_COUNT, (completedRowCount + 1) * SLOTS_PER_ROW));
}

export function Step1_Import(params: {
  contextData: ContextData;
  updateContextData: (params: UpdateContextDataParams) => void;
}) {
  const { contextData, updateContextData } = params;

  const [curInputIndex, setCurInputIndex] = useState(0);
  const [passphraseEnabled, setPassphraseEnabled] = useState(Boolean(contextData.passphrase));

  const { t, onHandleEventPaste, inputWords, onClickNext, onInputWordsChange, disabled, enablePhrase } =
    useCreateWalletLogicImportWordsStep({ ...params, autoDetectWordsType: true } as any);
  const [visibleSlotCount, setVisibleSlotCount] = useState(() =>
    Math.min(INITIAL_VISIBLE_SLOT_COUNT, inputWords.length)
  );
  const inputWordsLengthRef = useRef(inputWords.length);

  useEffect(() => {
    if (inputWordsLengthRef.current !== inputWords.length) {
      inputWordsLengthRef.current = inputWords.length;
      setVisibleSlotCount(Math.min(INITIAL_VISIBLE_SLOT_COUNT, inputWords.length));
      return;
    }

    const requiredVisibleSlotCount = getRequiredVisibleSlotCount(inputWords);
    setVisibleSlotCount((current) => Math.min(inputWords.length, Math.max(current, requiredVisibleSlotCount)));
  }, [inputWords]);

  useEffect(() => {
    if (!enablePhrase && contextData.passphrase) {
      updateContextData({ passphrase: '' });
    }
  }, [contextData.passphrase, enablePhrase, updateContextData]);

  const handleOnKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!disabled && 'Enter' == e.key) {
      onClickNext();
    }
  };

  return (
    <Column gap="lg">
      <Row
        itemsCenter
        style={{
          border: '0.2px solid #cccccc',
          padding: 10,
          paddingRight: 30,
          borderRadius: 4,
          backgroundColor: '#000000'
        }}
      >
        <Column gap="zero">
          <Icon icon="prompt" size={16} color="textWhite" />
        </Column>
        <Column gap="zero">
          <Text
            text={t('CreateHDwallet_StepImport_RecoverTheWallet')}
            preset="sub"
            color="textWhite"
            style={{ fontSize: 12 }}
          />
        </Column>
      </Row>

      <Grid columns={3} gap="sm" style={{ width: '100%' }}>
        {inputWords.slice(0, visibleSlotCount).map((word, index) => {
          const isFocused = index === curInputIndex;

          return (
            <Card
              key={index}
              preset="style3"
              style={{
                minHeight: 40,
                justifyContent: 'flex-start',
                padding: '0 10px',
                gap: 6,
                borderWidth: 1,
                borderColor: isFocused ? colors.primary : colors.border2,
                boxShadow: isFocused ? '0 0 0 1px rgba(227, 187, 95, 0.3)' : undefined,
                backgroundColor: colors.card
              }}
            >
              <Text text={`${index + 1}.`} size="xs" style={{ width: 20, flexShrink: 0 }} color="textDim" />
              <Input
                containerStyle={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 38,
                  height: 38,
                  padding: 0,
                  borderWidth: 0,
                  borderRadius: 0,
                  backgroundColor: colors.transparent
                }}
                style={{ minWidth: 0, fontSize: 12 }}
                value={word}
                onPaste={(e) => {
                  onHandleEventPaste(e, index);
                }}
                onChange={(e) => {
                  onInputWordsChange(e, index);
                }}
                onFocus={() => {
                  setCurInputIndex(index);
                }}
                onBlur={() => {
                  setCurInputIndex(999);
                }}
                onKeyUp={(e) => handleOnKeyUp(e as React.KeyboardEvent<HTMLInputElement>)}
                autoFocus={isFocused}
                preset="text"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                placeholder=""
                data-testid={`mnemonic-import-word-${index}`}
              />
            </Card>
          );
        })}
      </Grid>

      {enablePhrase && (
        <Column gap="xs">
          <Checkbox
            checked={passphraseEnabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              setPassphraseEnabled(enabled);
              if (!enabled) {
                updateContextData({ passphrase: '' });
              }
            }}
            data-testid="import-passphrase-enabled-checkbox"
          >
            <Text text={t('passphrase_optional')} color="textDim" />
          </Checkbox>

          {passphraseEnabled && (
            <Column gap="xs">
              <Input
                containerStyle={{ marginTop: 5 }}
                placeholder={t('passphrase')}
                value={contextData.passphrase}
                onChange={(e) => {
                  updateContextData({ passphrase: e.target.value });
                }}
                autoComplete="off"
                spellCheck={false}
                data-testid="import-passphrase-input"
              />
              <Text
                text={t('passphrase_recovery_notice')}
                preset="sub"
                color="textDim"
                style={{ lineHeight: '18px' }}
              />
            </Column>
          )}
        </Column>
      )}

      <FooterButtonContainer>
        <Button
          disabled={disabled}
          text={t('continue')}
          preset="primary"
          onClick={() => {
            onClickNext();
          }}
          data-testid="mnemonic-import-continue-button"
        />
      </FooterButtonContainer>
    </Column>
  );
}
