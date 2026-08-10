import { useEffect, useMemo, useState } from 'react';

import { Button, Card, Column, Grid, Icon, Input, Row, Text } from '@/ui/components';
import { FooterButtonContainer } from '@/ui/components/FooterButtonContainer';
import { ContextData, TabType, UpdateContextDataParams } from '@/ui/pages/Account/createHDWalletComponents/types';
import { colors } from '@/ui/theme/colors';
import { useI18n } from '@unisat/wallet-state';
import bip39EnglishWordlist from 'bip39/src/wordlists/english.json';

function shuffledIndexes(length: number): number[] {
  const indexes = Array.from({ length }, (_, index) => index);

  for (let index = indexes.length - 1; index > 0; index--) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const swapIndex = random[0]! % (index + 1);
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex]!, indexes[index]!];
  }

  return indexes;
}

function getVerificationCount(wordCount: number): number {
  if (wordCount === 24) {
    return 6;
  }

  return Math.min(wordCount, 3);
}

function normalizePassphrase(value: string): string {
  return value.normalize('NFKD');
}

interface MnemonicChoice {
  id: number;
  word: string;
}

export function Step1_Confirm({
  contextData,
  updateContextData
}: {
  contextData: ContextData;
  updateContextData: (params: UpdateContextDataParams) => void;
}) {
  const { t } = useI18n();
  const words = useMemo(() => contextData.mnemonics.split(' ').filter(Boolean), [contextData.mnemonics]);
  const verificationIndexes = useMemo(
    () =>
      shuffledIndexes(words.length)
        .slice(0, getVerificationCount(words.length))
        .sort((first, second) => first - second),
    [words.length, contextData.mnemonics]
  );
  const choices = useMemo(() => {
    const mnemonicWords = new Set(words);
    const distractorWords = bip39EnglishWordlist.filter((word) => !mnemonicWords.has(word));
    const candidates: MnemonicChoice[] = [
      ...verificationIndexes.map((index) => ({ id: index, word: words[index]! })),
      ...shuffledIndexes(distractorWords.length)
        .slice(0, verificationIndexes.length)
        .map((index, distractorIndex) => ({ id: -distractorIndex - 1, word: distractorWords[index]! }))
    ];

    return shuffledIndexes(candidates.length).map((index) => candidates[index]!);
  }, [verificationIndexes, words.length]);
  const choiceWordsById = useMemo(() => new Map(choices.map((choice) => [choice.id, choice.word])), [choices]);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [passphraseConfirmation, setPassphraseConfirmation] = useState('');

  useEffect(() => {
    setSelectedIndexes([]);
    setPassphraseConfirmation('');
  }, [contextData.mnemonics, contextData.passphrase]);

  const hasIncorrectSelection = selectedIndexes.some(
    (wordIndex, slotIndex) => wordIndex !== verificationIndexes[slotIndex]
  );
  const isPassphraseRequired = Boolean(contextData.passphrase);
  const isPassphraseConfirmed =
    !isPassphraseRequired ||
    normalizePassphrase(contextData.passphrase) === normalizePassphrase(passphraseConfirmation);
  const isVerified =
    selectedIndexes.length === verificationIndexes.length && !hasIncorrectSelection && isPassphraseConfirmed;

  const onSelect = (wordIndex: number) => {
    setSelectedIndexes((current) => {
      if (current.includes(wordIndex)) {
        return current.filter((index) => index !== wordIndex);
      }
      if (current.some((selectedWordIndex, slotIndex) => selectedWordIndex !== verificationIndexes[slotIndex])) {
        return current;
      }
      return [...current, wordIndex];
    });
  };

  return (
    <Column gap="lg">
      <Card
        preset="style2"
        style={{
          width: '100%',
          alignSelf: 'stretch',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
          gap: 0,
          padding: 0,
          marginTop: 10,
          marginBottom: 15,
          border: '0.2px solid #cccccc',
          borderRadius: 5,
          backgroundColor: colors.transparent
        }}
        data-testid="mnemonic-reminder"
      >
        <Column gap="zero" style={{ margin: 10, flexShrink: 0 }}>
          <Icon icon="mnemonicreminder" size={20} />
        </Column>
        <Column gap="zero" style={{ flex: 1, paddingRight: 10 }}>
          <Text text={t('verify_mnemonic_phrase')} style={{ marginTop: 10, fontSize: 13 }} />
          <Text
            text={t('verify_mnemonic_phrase_hint')}
            style={{ marginTop: 8, marginBottom: 10, fontSize: 12, color: colors.textDim }}
          />
        </Column>
      </Card>

      <Grid columns={3} gap="sm" style={{ width: '100%' }}>
        {verificationIndexes.map((expectedWordIndex, slotIndex) => {
          const selectedWordIndex = selectedIndexes[slotIndex];
          const isIncorrect = selectedWordIndex !== undefined && selectedWordIndex !== expectedWordIndex;
          const isSelected = selectedWordIndex !== undefined;
          const isCurrentSlot = !hasIncorrectSelection && !isSelected && slotIndex === selectedIndexes.length;

          return (
            <Card
              key={expectedWordIndex}
              preset="style3"
              onClick={isIncorrect && selectedWordIndex !== undefined ? () => onSelect(selectedWordIndex) : undefined}
              style={{
                minHeight: 40,
                justifyContent: 'flex-start',
                padding: '0 10px',
                gap: 6,
                borderWidth: 1,
                borderColor: isIncorrect
                  ? colors.error
                  : isCurrentSlot
                    ? colors.primary
                    : isSelected
                      ? 'rgba(255, 255, 255, 0.3)'
                      : colors.border2,
                boxShadow: isCurrentSlot ? '0 0 0 1px rgba(227, 187, 95, 0.3)' : undefined,
                backgroundColor: isIncorrect
                  ? 'rgba(229, 41, 55, 0.12)'
                  : isSelected
                    ? 'rgba(227, 187, 95, 0.08)'
                    : colors.card
              }}
              data-testid={`mnemonic-confirm-slot-${expectedWordIndex}`}
            >
              <Text
                text={`${expectedWordIndex + 1}.`}
                size="xs"
                style={{ width: 20 }}
                color={isIncorrect ? 'error' : 'textDim'}
              />
              <Text
                text={selectedWordIndex === undefined ? '' : (choiceWordsById.get(selectedWordIndex) ?? '')}
                size="xs"
                ellipsis
                color={isIncorrect ? 'error' : isSelected ? 'primary' : undefined}
                disableTranslate
              />
            </Card>
          );
        })}
      </Grid>

      <Row justifyCenter fullX>
        <Grid columns={3} gap="sm" style={{ width: '100%' }}>
          {choices.map((choice) => {
            const slotIndex = selectedIndexes.indexOf(choice.id);
            const isIncorrect = slotIndex >= 0 && choice.id !== verificationIndexes[slotIndex];
            const isSelected = slotIndex >= 0;

            return (
              <Button
                key={choice.id}
                preset="defaultV2"
                disabled={isSelected && !isIncorrect}
                onClick={isSelected && !isIncorrect ? undefined : () => onSelect(choice.id)}
                style={{
                  minHeight: 40,
                  borderRadius: 6,
                  paddingLeft: 8,
                  paddingRight: 8,
                  borderColor: isIncorrect ? colors.error : isSelected ? 'rgba(227, 187, 95, 0.45)' : colors.border2,
                  backgroundColor: isIncorrect
                    ? 'rgba(229, 41, 55, 0.12)'
                    : isSelected
                      ? 'rgba(227, 187, 95, 0.08)'
                      : '#151313',
                  cursor: isSelected && !isIncorrect ? 'default' : 'pointer'
                }}
                data-testid={`mnemonic-confirm-word-${choice.id}`}
              >
                <Text
                  text={choice.word}
                  size="sm"
                  color={isIncorrect ? 'error' : isSelected ? 'primary' : undefined}
                  disableTranslate
                  ellipsis
                />
              </Button>
            );
          })}
        </Grid>
      </Row>

      {isPassphraseRequired && (
        <Column gap="xs">
          <Text text={t('confirm_bip39_passphrase')} preset="bold" />
          <Input
            preset="password"
            value={passphraseConfirmation}
            onChange={(e) => {
              setPassphraseConfirmation(e.target.value);
            }}
            maxLength={contextData.passphrase.length}
            autoComplete="off"
            spellCheck={false}
            data-testid="passphrase-confirm-input"
          />
          {passphraseConfirmation && !isPassphraseConfirmed && (
            <Text text={t('passphrases_do_not_match')} color="error" />
          )}
        </Column>
      )}

      <FooterButtonContainer>
        <Button
          disabled={!isVerified}
          text={t('continue')}
          preset="primary"
          onClick={() =>
            updateContextData({ mnemonics: '', mnemonicVerified: true, tabType: TabType.CHOOSE_ADDRESS_TYPE })
          }
          data-testid="mnemonic-confirm-continue-button"
        />
      </FooterButtonContainer>
    </Column>
  );
}
