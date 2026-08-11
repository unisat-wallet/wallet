import { wordlists } from 'bip39';
import { useState } from 'react';

import { Button, Card, Checkbox, Column, Grid, Icon, Input, Row, Text } from '@/ui/components';
import { FooterButtonContainer } from '@/ui/components/FooterButtonContainer';
import { ContextData, UpdateContextDataParams } from '@/ui/pages/Account/createHDWalletComponents/types';
import { colors } from '@/ui/theme/colors';
import { useCreateWalletLogicImportWordsStep } from '@unisat/wallet-state';

const BIP39_ENGLISH_WORDS = new Set(wordlists.english);

function getWords(value: string): string[] {
  return value.normalize('NFKD').trim().split(/\s+/).filter(Boolean);
}

function hasInvalidMnemonicWord(value: string): boolean {
  return getWords(value).some((word) => !/^[a-z]+$/.test(word) || !BIP39_ENGLISH_WORDS.has(word));
}

export function Step_ImportWords(params: {
  contextData: ContextData;
  updateContextData: (params: UpdateContextDataParams) => void;
}) {
  const { contextData, updateContextData } = params;

  const [passphraseEnabled, setPassphraseEnabled] = useState(Boolean(contextData.passphrase));
  const [activeWord, setActiveWord] = useState('');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [showAdditionalWordInput, setShowAdditionalWordInput] = useState(false);
  const [showWords, setShowWords] = useState(false);

  const { t, inputWords, onClickNext, onInputWordsReplace, disabled, enablePhrase } =
    useCreateWalletLogicImportWordsStep({ ...params, autoDetectWordsType: true } as any);
  const enteredWords = inputWords.filter((word) => word.trim());
  const isInitialEntry = enteredWords.length === 0;
  const inputIndex = activeIndex ?? enteredWords.length;
  const hasValidTwelveWordMnemonic = enteredWords.length === 12 && !disabled;
  const shouldShowActiveWordInput = activeIndex !== null || !hasValidTwelveWordMnemonic || showAdditionalWordInput;
  const hasUncommittedWord =
    activeIndex === null ? Boolean(activeWord.trim()) : activeWord.trim() !== enteredWords[activeIndex];
  const hasInvalidMnemonicWords = enteredWords.some(hasInvalidMnemonicWord);
  const actionButtonStyle = {
    minHeight: 28,
    minWidth: 96,
    paddingLeft: 10,
    paddingRight: 10,
    borderRadius: 5,
    backgroundColor: colors.black_dark,
    cursor: 'pointer'
  };

  const commitWords = (words: string[], continueWithAnotherWord = false) => {
    const wordsToCommit = words.flatMap(getWords);
    if (!wordsToCommit.length) {
      return;
    }

    const wordsAfterActiveInput = activeIndex === null ? [] : enteredWords.slice(activeIndex + 1);
    const nextWords = [...enteredWords.slice(0, inputIndex), ...wordsToCommit, ...wordsAfterActiveInput].slice(
      0,
      inputWords.length
    );

    onInputWordsReplace(nextWords);
    setActiveWord('');
    setActiveIndex(null);
    setShowAdditionalWordInput(continueWithAnotherWord);
    setShowWords(false);
  };

  const handleBackspace = (): boolean => {
    if (activeWord) {
      return false;
    }

    if (activeIndex === null) {
      if (inputIndex === 0) {
        return false;
      }

      const previousIndex = inputIndex - 1;
      setActiveIndex(previousIndex);
      setActiveWord(enteredWords[previousIndex]);
      setShowWords(false);
      return true;
    }

    if (activeIndex === 0) {
      onInputWordsReplace([]);
      setActiveIndex(null);
      setActiveWord('');
      setShowAdditionalWordInput(false);
      setShowWords(false);
      return true;
    }

    const nextWords = [...enteredWords];
    nextWords.splice(activeIndex, 1);
    onInputWordsReplace(nextWords);

    const previousIndex = activeIndex - 1;
    if (previousIndex >= 0) {
      setActiveIndex(previousIndex);
      setActiveWord(nextWords[previousIndex]);
    } else {
      setActiveIndex(null);
      setActiveWord('');
      setShowAdditionalWordInput(false);
    }
    setShowWords(false);
    return true;
  };

  const handleActiveWordBlur = () => {
    if (activeIndex === null) {
      if (activeWord.trim()) {
        commitWords([activeWord]);
        return;
      }

      setShowAdditionalWordInput(false);
      return;
    }

    const nextWord = activeWord.trim();
    if (nextWord && nextWord !== enteredWords[activeIndex]) {
      commitWords([nextWord]);
      return;
    }

    setActiveWord('');
    setActiveIndex(null);
    setShowAdditionalWordInput(false);
  };

  const activeWordInput =
    !isInitialEntry && shouldShowActiveWordInput && inputIndex < inputWords.length ? (
      <Column key={`active-word-${inputIndex}`} gap="xs">
        <Card
          key={`active-word-${inputIndex}`}
          preset="style3"
          style={{
            minHeight: 40,
            justifyContent: 'flex-start',
            padding: '0 10px',
            gap: 6,
            borderWidth: 1,
            borderColor: colors.primary,
            boxShadow: '0 0 0 1px rgba(227, 187, 95, 0.3)',
            backgroundColor: colors.card
          }}
        >
          <Text text={`${inputIndex + 1}.`} size="xs" style={{ width: 20, flexShrink: 0 }} color="textDim" />
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
            value={activeWord}
            onChange={(e) => {
              setActiveWord(e.target.value);
            }}
            onPaste={(e) => {
              e.preventDefault();
              commitWords(getWords(e.clipboardData.getData('text/plain')));
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) {
                return;
              }
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                commitWords([activeWord], true);
              } else if (e.key === 'Backspace' && handleBackspace()) {
                e.preventDefault();
              }
            }}
            onBlur={handleActiveWordBlur}
            autoFocus={activeIndex !== null || showAdditionalWordInput}
            preset="text"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            placeholder=""
            data-testid={`mnemonic-import-active-word-${inputIndex}`}
          />
        </Card>
      </Column>
    ) : null;

  return (
    <Column gap="lg">
      <Row itemsCenter>
        <Column gap="zero">
          <Text text={t('CreateHDwallet_StepImport_RecoverTheWallet')} preset="sub" style={{ fontSize: 12 }} />
        </Column>
      </Row>

      <Column gap="xs">
        <Column
          gap="sm"
          style={{
            padding: isInitialEntry ? 0 : 12,
            minHeight: 136,
            borderRadius: 8,
            backgroundColor: colors.black_dark
          }}
        >
          {isInitialEntry ? (
            <>
              <textarea
                autoFocus
                value={activeWord}
                onChange={(e) => {
                  setActiveWord(e.target.value);
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  commitWords(getWords(e.clipboardData.getData('text/plain')));
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) {
                    return;
                  }
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    commitWords([activeWord], true);
                  }
                }}
                onBlur={() => {
                  if (activeWord.trim()) {
                    commitWords([activeWord]);
                  }
                }}
                placeholder={t('mnemonic_import_initial_placeholder')}
                autoComplete="off"
                spellCheck={false}
                style={{
                  boxSizing: 'border-box',
                  width: '100%',
                  minHeight: 180,
                  resize: 'none',
                  padding: 16,
                  border: 0,
                  borderRadius: 8,
                  outline: 0,
                  color: colors.text,
                  backgroundColor: colors.transparent,
                  fontSize: 14,
                  lineHeight: '22px'
                }}
                data-testid="mnemonic-import-initial-input"
              />
            </>
          ) : (
            <Grid columns={3} gap="sm" style={{ width: '100%' }}>
              {enteredWords.map((word, index) => {
                if (index === activeIndex) {
                  return activeWordInput;
                }

                const isInvalidWord = hasInvalidMnemonicWord(word);

                return (
                  <Column key={`word-${index}`} gap="xs">
                    <Card
                      preset="style3"
                      onClick={() => {
                        setActiveIndex(index);
                        setActiveWord(word);
                      }}
                      style={{
                        minHeight: 40,
                        justifyContent: 'flex-start',
                        padding: '0 10px',
                        gap: 6,
                        cursor: 'text',
                        borderWidth: 0.2,
                        borderColor: isInvalidWord ? colors.error : colors.border2,
                        boxShadow: isInvalidWord ? `0 0 0 1px ${colors.error}` : undefined,
                        backgroundColor: colors.card
                      }}
                      data-testid={`mnemonic-import-word-${index}`}
                    >
                      <Text text={`${index + 1}.`} size="xs" style={{ width: 20, flexShrink: 0 }} color="textDim" />
                      <Text
                        text={showWords ? word : '\u2022'.repeat(5)}
                        ellipsis={showWords}
                        style={{ flex: 1, minWidth: 0 }}
                        disableTranslate
                      />
                    </Card>
                  </Column>
                );
              })}

              {activeIndex === null && activeWordInput}
            </Grid>
          )}
        </Column>

        {!isInitialEntry && (
          <Row justifyEnd gap="sm" style={{ paddingRight: 2, marginTop: 6 }}>
            <Row
              justifyCenter
              itemsCenter
              gap="xs"
              onClick={() => {
                onInputWordsReplace([]);
                setActiveWord('');
                setActiveIndex(null);
                setShowAdditionalWordInput(false);
                setShowWords(false);
              }}
              style={actionButtonStyle}
              data-testid="mnemonic-import-clear-all"
            >
              <Icon icon="sheet-close" size={10} />
              <Text text={t('clear_all')} color="textDim" />
            </Row>
            <Row
              justifyCenter
              itemsCenter
              gap="xs"
              onClick={() => {
                setShowWords((current) => !current);
              }}
              style={actionButtonStyle}
              data-testid="mnemonic-import-words-visibility"
            >
              <Icon icon={showWords ? 'eye-slash' : 'eye'} size={16} color="textDim" />
              <Text text={showWords ? t('hide') : t('show')} color="textDim" />
            </Row>
          </Row>
        )}
        {hasInvalidMnemonicWords && <Text text={t('mnemonic_word_invalid')} color="error" size="xs" wrap />}
      </Column>

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
          disabled={disabled || hasUncommittedWord}
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
