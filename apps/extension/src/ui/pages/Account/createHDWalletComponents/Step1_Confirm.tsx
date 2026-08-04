import { wordlists } from 'bip39';
import { useEffect, useMemo, useState } from 'react';

import { Button, Card, Column, Grid, Row, Text } from '@/ui/components';
import { FooterButtonContainer } from '@/ui/components/FooterButtonContainer';
import { ContextData, TabType, UpdateContextDataParams } from '@/ui/pages/Account/createHDWalletComponents/types';
import { colors } from '@/ui/theme/colors';
import { useI18n } from '@unisat/wallet-state';

/**
 * Production backup confirmation (create-wallet path).
 * - Challenge a few random positions (not the full phrase on-screen again).
 * - Correct answers matched by phrase index (duplicate BIP-39 words cannot bypass).
 * - Distractors from the English BIP-39 wordlist, never other words from this seed.
 * - Seed for keyring creation remains in encrypted preMnemonics; UI clears the phrase after verify.
 */
const CHALLENGE_COUNT = 3;
const DISTRACTOR_COUNT = 5;
const ENGLISH = wordlists.english;

type Choice = {
  id: string;
  word: string;
  /** Phrase index when this is the correct word for a challenge; null = distractor */
  phraseIndex: number | null;
};

/** Unbiased int in [0, maxExclusive). */
function cryptoRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error('maxExclusive must be positive');
  const maxUint = 0x100000000;
  const limit = maxUint - (maxUint % maxExclusive);
  const buf = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0]!;
  } while (x >= limit);
  return x % maxExclusive;
}

function cryptoShuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let index = arr.length - 1; index > 0; index--) {
    const swapIndex = cryptoRandomInt(index + 1);
    [arr[index], arr[swapIndex]] = [arr[swapIndex]!, arr[index]!];
  }
  return arr;
}

function pickChallengePositions(wordCount: number, count: number): number[] {
  const all = Array.from({ length: wordCount }, (_, i) => i);
  return cryptoShuffle(all)
    .slice(0, Math.min(count, wordCount))
    .sort((a, b) => a - b);
}

function pickWordlistDistractors(phraseWords: string[], count: number): string[] {
  const banned = new Set(phraseWords);
  const pool: string[] = [];
  for (const w of ENGLISH) {
    if (!banned.has(w)) pool.push(w);
  }
  if (pool.length < count) {
    throw new Error('BIP-39 wordlist too small for distractors');
  }
  const picked: string[] = [];
  // sample without replacement
  for (let i = 0; i < count; i++) {
    const idx = cryptoRandomInt(pool.length - i);
    const last = pool.length - 1 - i;
    const word = pool[idx]!;
    pool[idx] = pool[last]!;
    picked.push(word);
  }
  return picked;
}

function buildChoices(words: string[], challenges: number[]): Choice[] {
  const correct: Choice[] = challenges.map((phraseIndex) => ({
    id: `c-${phraseIndex}`,
    word: words[phraseIndex]!,
    phraseIndex
  }));
  const distractors: Choice[] = pickWordlistDistractors(words, DISTRACTOR_COUNT).map((word, i) => ({
    id: `d-${i}-${word}`,
    word,
    phraseIndex: null
  }));
  return cryptoShuffle([...correct, ...distractors]);
}

export function Step1_Confirm({
  contextData,
  updateContextData
}: {
  contextData: ContextData;
  updateContextData: (params: UpdateContextDataParams) => void;
}) {
  const { t } = useI18n();
  const words = useMemo(() => contextData.mnemonics.split(/\s+/).filter(Boolean), [contextData.mnemonics]);

  const challenges = useMemo(
    () => (words.length ? pickChallengePositions(words.length, CHALLENGE_COUNT) : []),
    // regenerate only when the seed string changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contextData.mnemonics]
  );

  const choices = useMemo(() => {
    if (!words.length || !challenges.length) return [] as Choice[];
    return buildChoices(words, challenges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextData.mnemonics, challenges]);

  // selected choice id per challenge slot
  const [selectedIds, setSelectedIds] = useState<(string | undefined)[]>([]);

  useEffect(() => {
    setSelectedIds(challenges.map(() => undefined));
  }, [contextData.mnemonics, challenges]);

  const choiceById = useMemo(() => {
    const map = new Map<string, Choice>();
    for (const c of choices) map.set(c.id, c);
    return map;
  }, [choices]);

  const activeSlot = selectedIds.findIndex((v) => v === undefined);

  const slotIsIncorrect = (slot: number): boolean => {
    const id = selectedIds[slot];
    if (id === undefined) return false;
    const choice = choiceById.get(id);
    return !choice || choice.phraseIndex !== challenges[slot];
  };

  const hasIncorrectSelection = challenges.some((_, slot) => slotIsIncorrect(slot));

  const isVerified =
    challenges.length > 0 &&
    selectedIds.length === challenges.length &&
    selectedIds.every((id, slot) => {
      if (id === undefined) return false;
      const choice = choiceById.get(id);
      return choice?.phraseIndex === challenges[slot];
    }) &&
    !hasIncorrectSelection;

  const onSelectChoice = (choiceId: string) => {
    setSelectedIds((current) => {
      const existingSlot = current.indexOf(choiceId);
      if (existingSlot >= 0) {
        const next = [...current];
        next[existingSlot] = undefined;
        return next;
      }
      if (current.some((_, slot) => {
        const id = current[slot];
        if (id === undefined) return false;
        const choice = choiceById.get(id);
        return !choice || choice.phraseIndex !== challenges[slot];
      })) {
        return current;
      }
      const slot = current.findIndex((v) => v === undefined);
      if (slot < 0) return current;
      const next = [...current];
      next[slot] = choiceId;
      return next;
    });
  };

  return (
    <Column gap="lg">
      <Text text={t('verify_recovery_phrase')} preset="title-bold" textCenter />
      <Text
        text={
          t('confirm_backup_by_selecting_words') ||
          'Select the correct word for each numbered position to confirm your backup.'
        }
        preset="sub"
        color="textDim"
        textCenter
        style={{ maxWidth: 420, alignSelf: 'center', lineHeight: '18px' }}
      />

      <Grid columns={1} gap="sm" style={{ width: '100%' }}>
        {challenges.map((wordPos, slot) => {
          const selectedId = selectedIds[slot];
          const selectedChoice = selectedId ? choiceById.get(selectedId) : undefined;
          const isIncorrect = slotIsIncorrect(slot);
          const isSelected = selectedId !== undefined;
          const isActive = slot === activeSlot;

          return (
            <Card
              key={wordPos}
              preset="style3"
              onClick={
                isIncorrect && selectedId !== undefined ? () => onSelectChoice(selectedId) : undefined
              }
              style={{
                minHeight: 44,
                justifyContent: 'flex-start',
                padding: '0 12px',
                gap: 8,
                borderWidth: 1,
                borderColor: isIncorrect
                  ? colors.error
                  : isActive
                    ? 'rgba(227, 187, 95, 0.65)'
                    : isSelected
                      ? 'rgba(227, 187, 95, 0.45)'
                      : colors.border2,
                backgroundColor: isIncorrect
                  ? 'rgba(229, 41, 55, 0.12)'
                  : isSelected
                    ? 'rgba(227, 187, 95, 0.08)'
                    : colors.card
              }}
              data-testid={`mnemonic-confirm-slot-${wordPos}`}>
              <Text
                text={(t('word_number') || 'Word #$1').replace('$1', String(wordPos + 1))}
                size="xs"
                style={{ width: 72 }}
                color={isIncorrect ? 'error' : 'textDim'}
              />
              <Text
                text={selectedChoice ? selectedChoice.word : '...'}
                size="sm"
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
            const slotIndex = selectedIds.indexOf(choice.id);
            const isSelected = slotIndex >= 0;
            const isIncorrect = isSelected && choice.phraseIndex !== challenges[slotIndex];

            return (
              <Button
                key={choice.id}
                preset="defaultV2"
                onClick={isSelected && !isIncorrect ? undefined : () => onSelectChoice(choice.id)}
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
                data-testid={`mnemonic-confirm-choice-${choice.id}`}>
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

      <FooterButtonContainer>
        <Button
          disabled={!isVerified}
          text={t('continue')}
          preset="primary"
          onClick={() =>
            // Drop phrase from React state; keyring create uses encrypted preMnemonics in background.
            updateContextData({ mnemonics: '', mnemonicVerified: true, tabType: TabType.CHOOSE_ADDRESS_TYPE })
          }
          data-testid="mnemonic-confirm-continue-button"
        />
      </FooterButtonContainer>
    </Column>
  );
}
