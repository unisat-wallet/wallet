import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Card, Checkbox, Column, Grid, Icon, Input, Row, Text } from '@/ui/components';
import { FooterButtonContainer } from '@/ui/components/FooterButtonContainer';
import { Popover } from '@/ui/components/Popover';
import { ContextData, TabType, UpdateContextDataParams } from '@/ui/pages/Account/createHDWalletComponents/types';
import { colors } from '@/ui/theme/colors';
import { MAX_ALIAS_NAME_LENGTH, WordsType } from '@unisat/wallet-shared';
import { useI18n, useWallet } from '@unisat/wallet-state';

function wordsTypeToStrength(wordsType: WordsType): 128 | 256 {
  return wordsType === WordsType.WORDS_24 ? 256 : 128;
}

export function Step1_Create({
  contextData,
  updateContextData
}: {
  contextData: ContextData;
  updateContextData: (params: UpdateContextDataParams) => void;
}) {
  const [passphraseEnabled, setPassphraseEnabled] = useState(Boolean(contextData.passphrase));
  const [showPassphraseNotice, setShowPassphraseNotice] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generationRequestRef = useRef(0);
  const generationQueueRef = useRef(Promise.resolve());
  const { t } = useI18n();
  const wallet = useWallet();

  const generate = useCallback(
    async (wordsType: WordsType) => {
      const requestId = ++generationRequestRef.current;
      setGenerating(true);
      try {
        const strength = wordsTypeToStrength(wordsType);
        const generation = generationQueueRef.current.then(() => wallet.generatePreMnemonic(strength));
        // Keep the queue usable after a failed generation attempt.
        generationQueueRef.current = generation.then(
          () => undefined,
          () => undefined
        );
        const _mnemonics = await generation;
        if (requestId === generationRequestRef.current) {
          updateContextData({
            mnemonics: _mnemonics,
            wordsType,
            step1CreateWordsCompleted: false,
            mnemonicVerified: false
          });
        }
      } finally {
        if (requestId === generationRequestRef.current) {
          setGenerating(false);
        }
      }
    },
    [updateContextData, wallet]
  );

  useEffect(() => {
    if (!contextData.mnemonics) {
      void generate(contextData.wordsType ?? WordsType.WORDS_24);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial generate only
  }, []);

  useEffect(() => {
    if (contextData.walletName) {
      return;
    }

    let cancelled = false;
    const initializeWalletName = async () => {
      try {
        const totalKeyringCount = await wallet.getTotalKeyringCount();
        if (!cancelled) {
          updateContextData({ walletName: `HD Wallet #${totalKeyringCount + 1}` });
        }
      } catch {
        // The keyring service assigns its standard name if the lookup is unavailable.
      }
    };

    void initializeWalletName();
    return () => {
      cancelled = true;
    };
  }, [contextData.walletName, updateContextData, wallet]);

  const onSelectWordsType = async (wordsType: WordsType) => {
    if (wordsType === contextData.wordsType && contextData.mnemonics) {
      return;
    }
    await generate(wordsType);
  };

  const btnClick = () => {
    updateContextData({
      step1CreateWordsCompleted: true,
      tabType: TabType.CONFIRM_WORDS
    });
  };

  const words = contextData.mnemonics ? contextData.mnemonics.split(' ') : [];
  const isTwelveWords = contextData.wordsType === WordsType.WORDS_12;

  return (
    <Column gap="xl">
      <Text text={t('secret_recovery_phrase')} preset="title-bold" textCenter data-testid="mnemonic-title" />

      <Card
        preset="style2"
        style={{
          alignSelf: 'stretch',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'flex-start',
          gap: 0,
          padding: 10,
          border: `1px solid ${colors.gold_dark}`,
          borderRadius: 10,
          backgroundColor: colors.transparent
        }}
        data-testid="mnemonic-security-notice"
      >
        <Column gap="zero">
          <Row itemsCenter mb="xs">
            <Icon icon="intro" size={12} color="gold" />
            <Text text={t('mnemonic_intro_title')} preset="sub" color="gold" />
          </Row>
          <Text text={t('mnemonic_intro')} preset="sub" color="gold_dark" style={{ lineHeight: '15px' }} />

          <Column gap="zero" mt="md">
            <Row itemsCenter mb="xs">
              <Icon icon="wallet-info" size={12} color="gold" />
              <Text text={t('mnemonic_recovery_info_title')} preset="sub" color="gold" />
            </Row>
            <Text text={t('mnemonic_recovery_info')} preset="sub" color="gold_dark" style={{ lineHeight: '15px' }} />
          </Column>

          <Column gap="zero" mt="md">
            <Row itemsCenter mb="xs">
              <Icon icon="danger" size={12} color="gold" />
              <Text text={t('mnemonic_danger_title')} preset="sub" color="gold" />
            </Row>
            <Text text={t('mnemonic_danger')} preset="sub" color="gold_dark" style={{ lineHeight: '15px' }} />
          </Column>

          {isTwelveWords ? (
            <Column gap="zero" mt="md">
              <Row itemsCenter mb="xs">
                <Icon icon="danger" size={12} color="gold" />
                <Text text={t('mnemonics_12_words_security_warning_title')} preset="sub" color="gold" />
              </Row>
              <Text
                text={t('mnemonics_12_words_not_recommended')}
                preset="sub"
                color="gold_dark"
                style={{ lineHeight: '15px' }}
                data-testid="mnemonic-12-words-warning"
              />
            </Column>
          ) : null}
        </Column>
      </Card>

      <Row>
        {[
          { type: WordsType.WORDS_24, label: t('mnemonics_24_words') },
          { type: WordsType.WORDS_12, label: t('mnemonics_12_words') }
        ].map((option) => {
          const selected = contextData.wordsType === option.type;

          return (
            <Row
              key={option.type}
              itemsCenter
              gap="zero"
              onClick={generating ? undefined : () => void onSelectWordsType(option.type)}
              style={{ marginRight: 20, opacity: generating ? 0.5 : 1, cursor: generating ? 'not-allowed' : 'pointer' }}
              data-testid={`mnemonic-words-type-${option.type}`}
            >
              {selected ? (
                <Icon icon="frame" size={22} color="gold" />
              ) : (
                <Column
                  style={{
                    width: 22,
                    height: 22,
                    flexShrink: 0,
                    borderColor: 'rgba(255, 255, 255, 0.5)',
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderRadius: 20
                  }}
                />
              )}
              <Text text={option.label} color={selected ? 'gold' : 'textWhite'} style={{ marginLeft: 8 }} />
            </Row>
          );
        })}
      </Row>

      <Row justifyCenter fullX>
        <Grid columns={3} gap="md" style={{ width: '100%', maxWidth: 400 }}>
          {words.map((v, index) => {
            return (
              <Row key={index} itemsCenter gap="zero" style={{ minWidth: 0 }}>
                <Text
                  text={`${index + 1}`}
                  size="xxs"
                  textEnd
                  color="textDim"
                  style={{ width: 15, flexShrink: 0 }}
                  mx="sm"
                />
                <Card
                  preset="style3"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 32,
                    justifyContent: 'flex-start',
                    borderRadius: 5,
                    paddingLeft: 8,
                    paddingRight: 5
                  }}
                  data-index={index}
                  data-testid={`mnemonic-word-${index}`}
                >
                  <Text text={v} size="xs" selectText disableTranslate ellipsis style={{ minWidth: 0 }} />
                </Card>
              </Row>
            );
          })}
        </Grid>
      </Row>

      <Column gap="xs">
        <Checkbox
          checked={passphraseEnabled}
          onChange={(e) => {
            const enabled = e.target.checked;
            setPassphraseEnabled(enabled);
            if (enabled) {
              setShowPassphraseNotice(true);
            } else {
              updateContextData({ passphrase: '' });
            }
          }}
          data-testid="passphrase-enabled-checkbox"
        >
          <Text text={t('passphrase_optional')} />
        </Checkbox>

        {passphraseEnabled && (
          <Input
            placeholder={t('passphrase')}
            value={contextData.passphrase}
            onChange={(e) => {
              updateContextData({
                passphrase: e.target.value
              });
            }}
            autoComplete="off"
            spellCheck={false}
            data-testid="passphrase-input"
          />
        )}
      </Column>

      <Column gap="xs">
        <Text text={t('wallet_name')} preset="bold" color="textDim" />
        <Input
          value={contextData.walletName}
          onChange={(e) => {
            updateContextData({ walletName: e.target.value });
          }}
          maxLength={MAX_ALIAS_NAME_LENGTH}
          autoComplete="off"
          spellCheck={false}
          data-testid="wallet-name-input"
        />
      </Column>

      <FooterButtonContainer>
        <Button
          disabled={generating || words.length === 0}
          text={t('continue')}
          preset="primary"
          onClick={btnClick}
          data-testid="mnemonic-continue-button"
        />
      </FooterButtonContainer>

      {showPassphraseNotice && (
        <Popover
          contentStyle={{ width: 340, padding: 30, boxSizing: 'border-box' }}
          data-testid="passphrase-warning-popover"
        >
          <Column itemsCenter>
            <Column
              justifyCenter
              itemsCenter
              style={{ width: 64, height: 64, borderRadius: 43, backgroundColor: 'rgba(255, 255, 255, 0.03)' }}
            >
              <Icon icon="warning2" size={32} color="gold" />
            </Column>
            <Text text={t('passphrase_warning_title')} preset="title" color="gold" textCenter />
            <Text
              text={t('passphrase_backup_notice')}
              preset="sub"
              color="textDim"
              style={{ alignSelf: 'stretch', lineHeight: '20px', marginBottom: 20 }}
            />
            <Button
              full
              text={t('passphrase_warning_confirm')}
              preset="primary"
              onClick={() => {
                setShowPassphraseNotice(false);
              }}
              data-testid="passphrase-warning-confirm-button"
            />
          </Column>
        </Popover>
      )}
    </Column>
  );
}
