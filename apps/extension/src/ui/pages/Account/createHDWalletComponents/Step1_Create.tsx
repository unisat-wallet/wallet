import { CheckboxChangeEvent } from 'antd/lib/checkbox';
import { useCallback, useEffect, useState } from 'react';

import { Button, Card, Checkbox, Column, Grid, Radio, RadioGroup, Row, Text } from '@/ui/components';
import { FooterButtonContainer } from '@/ui/components/FooterButtonContainer';
import { ContextData, TabType, UpdateContextDataParams } from '@/ui/pages/Account/createHDWalletComponents/types';
import { fontSizes } from '@/ui/theme/font';
import { WordsType } from '@unisat/wallet-shared';
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
  const [checked, setChecked] = useState(false);
  const [generating, setGenerating] = useState(false);
  const { t } = useI18n();
  const wallet = useWallet();

  const generate = useCallback(
    async (wordsType: WordsType) => {
      setGenerating(true);
      setChecked(false);
      try {
        const strength = wordsTypeToStrength(wordsType);
        const _mnemonics = await wallet.generatePreMnemonic(strength);
        updateContextData({
          mnemonics: _mnemonics,
          wordsType,
          step1CreateWordsCompleted: false
        });
      } finally {
        setGenerating(false);
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

  const onSelectWordsType = async (wordsType: WordsType) => {
    if (wordsType === contextData.wordsType && contextData.mnemonics) {
      return;
    }
    await generate(wordsType);
  };

  const onChange = (e: CheckboxChangeEvent) => {
    const val = e.target.checked;
    setChecked(val);
    updateContextData({ step1CreateWordsCompleted: val });
  };

  const btnClick = () => {
    updateContextData({
      tabType: TabType.CHOOSE_ADDRESS_TYPE
    });
  };

  const words = contextData.mnemonics ? contextData.mnemonics.split(' ') : [];
  return (
    <Column gap="xl">
      <Text text={t('secret_recovery_phrase')} preset="title-bold" textCenter data-testid="mnemonic-title" />
      <Text text={t('this_phrase_is_the_only_way_to_recover_your_wallet')} color="warning" textCenter />

      <Row justifyCenter>
        <RadioGroup
          onChange={(value) => {
            void onSelectWordsType(value as WordsType);
          }}
          value={contextData.wordsType}>
          <Radio value={WordsType.WORDS_12}>{t('mnemonics_12_words')}</Radio>
          <Radio value={WordsType.WORDS_24}>{t('mnemonics_24_words')}</Radio>
        </RadioGroup>
      </Row>

      <Row justifyCenter>
        <Grid columns={2}>
          {words.map((v, index) => {
            return (
              <Row key={index}>
                <Text text={`${index + 1}. `} style={{ width: 40 }} />
                <Card preset="style2" style={{ width: 200 }} data-index={index} data-testid={`mnemonic-word-${index}`}>
                  <Text text={v} selectText disableTranslate />
                </Card>
              </Row>
            );
          })}
        </Grid>
      </Row>

      <Row justifyCenter>
        <Checkbox onChange={onChange} checked={checked} style={{ fontSize: fontSizes.sm }} data-testid="mnemonic-saved-checkbox">
          <Text text={t('i_saved_my_secret_recovery_phrase')} />
        </Checkbox>
      </Row>

      <FooterButtonContainer>
        <Button
          disabled={!checked || generating || words.length === 0}
          text={t('continue')}
          preset="primary"
          onClick={btnClick}
          data-testid="mnemonic-continue-button"
        />
      </FooterButtonContainer>
    </Column>
  );
}
