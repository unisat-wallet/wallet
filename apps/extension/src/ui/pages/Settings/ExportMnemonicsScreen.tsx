import { type KeyboardEvent, useEffect, useState } from 'react';

import { Button, Card, Column, Content, Grid, Header, Icon, Input, Layout, Row, Text, Tooltip } from '@/ui/components';
import { colors } from '@/ui/theme/colors';
import { useExportMnemonicsScreenLogic } from '@unisat/wallet-state';

export default function ExportMnemonicsScreen() {
  const [showWords, setShowWords] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const {
    words,
    pathName,
    t,
    password,
    setPassword,
    disabled,
    btnClick,
    handleOnKeyUp,
    mnemonic,
    passphrase,
    error,
    copy,
    keyring,
    onClickBack
  } = useExportMnemonicsScreenLogic();

  useEffect(() => {
    setShowWords(false);
    setShowPassphrase(false);
  }, [mnemonic, passphrase]);

  return (
    <Layout>
      <Header onBack={onClickBack} title={t('secret_recovery_phrase')} />

      <Content>
        {mnemonic == '' ? (
          <Column style={{ height: '100%' }}>
            <Card
              style={{
                flexDirection: 'column',
                alignItems: 'stretch',
                justifyContent: 'flex-start',
                gap: 0,
                border: `1px solid ${colors.red_light2}`
              }}
            >
              <Text text={t('if_you_lose_your_secret_recovery_phrase_your_asset')} color="red" size="sm" mb="md" />
              <Text text={t('if_you_share_the_secret_recovery_phrase_to_others_')} color="red" size="sm" />
            </Card>

            <Card mt="lg" mb="lg" style={{ height: 'auto', justifyContent: 'flex-start' }}>
              <Icon icon="wallet-info" size={20} color="warning" />
              <Text text={t('please_make_sure_you_have_read_the_security_tips_a')} color="warning" size="sm" />
            </Card>
            <Input
              preset="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              onKeyUp={(e: KeyboardEvent<HTMLInputElement>) => handleOnKeyUp(e)}
              autoFocus={true}
            />
            {error && <Text text={error} preset="regular" color="error" />}

            <Button
              mt="lg"
              disabled={disabled}
              text={t('show_secret_recovery_phrase')}
              preset="primary"
              onClick={btnClick}
            />
          </Column>
        ) : (
          <Column>
            <Card
              style={{
                height: 'auto',
                border: `1px solid ${colors.warning}`,
                borderRadius: 10
              }}
            >
              <Text text={t('this_phrase_is_the_only_way_to_recover_your_wallet')} color="warning" size="sm" />
            </Card>

            <Column gap="xs" mt="xl" style={{ width: '100%', maxWidth: 400, alignSelf: 'center' }}>
              <Column
                style={{
                  position: 'relative',
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  borderRadius: 8,
                  padding: 8,
                  overflow: 'hidden'
                }}
              >
                <Grid columns={3} gap="md" style={{ width: '100%' }}>
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
                        >
                          <Text text={v} size="xs" selectText disableTranslate ellipsis style={{ minWidth: 0 }} />
                        </Card>
                      </Row>
                    );
                  })}
                </Grid>

                {!showWords && (
                  <Column
                    justifyCenter
                    itemsCenter
                    onClick={() => {
                      setShowWords(true);
                    }}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 8,
                      padding: 20,
                      boxSizing: 'border-box',
                      backgroundColor: 'rgba(7, 6, 6, 0.52)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      cursor: 'pointer',
                      zIndex: 1
                    }}
                  >
                    <Column gap="xs" itemsCenter style={{ maxWidth: 260 }}>
                      <Icon icon="eye-slash" size={28} color="textWhite" />
                      <Text text={t('mnemonic_mask_reveal_title')} color="textWhite" textCenter />
                      <Text
                        text={t('mnemonic_mask_reveal_hint')}
                        preset="sub"
                        color="textDim"
                        textCenter
                        style={{ lineHeight: '18px' }}
                      />
                    </Column>
                  </Column>
                )}
              </Column>

              {showWords && (
                <Row
                  justifyCenter
                  itemsCenter
                  gap="xs"
                  mt="sm"
                  onClick={() => {
                    setShowWords(false);
                  }}
                  style={{
                    alignSelf: 'flex-end',
                    minHeight: 28,
                    minWidth: 96,
                    paddingLeft: 10,
                    paddingRight: 10,
                    borderRadius: 5,
                    backgroundColor: colors.black_dark,
                    cursor: 'pointer'
                  }}
                >
                  <Icon icon="eye-slash" size={16} color="textDim" />
                  <Text text={t('hide')} color="textDim" />
                </Row>
              )}
            </Column>

            {passphrase && (
              <Card
                mt="lg"
                style={{
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  justifyContent: 'flex-start',
                  gap: 0,
                  backgroundColor: colors.transparent
                }}
              >
                <Row itemsCenter mb="md">
                  <Text text={t('passphrase')} color="white" size="sm" />
                  <Tooltip title={t('passphrase_export_notice')} placement="right" overlayStyle={{ maxWidth: '280px' }}>
                    <Icon icon="circle-question" color="textDim" size={14} />
                  </Tooltip>
                </Row>
                <Column
                  gap="xs"
                  style={{
                    position: 'relative',
                    border: '1px solid rgba(255, 255, 255, 0.16)',
                    borderRadius: 8,
                    padding: 8,
                    overflow: 'hidden'
                  }}
                >
                  <Text text={passphrase} size="md" selectText disableTranslate wrap />

                  {!showPassphrase && (
                    <Column
                      justifyCenter
                      itemsCenter
                      onClick={() => {
                        setShowPassphrase(true);
                      }}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        borderRadius: 8,
                        padding: 12,
                        boxSizing: 'border-box',
                        backgroundColor: 'rgba(7, 6, 6, 0.52)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        cursor: 'pointer',
                        zIndex: 1
                      }}
                    >
                      <Row itemsCenter gap="sm">
                        <Icon icon="eye-slash" size={16} color="textWhite" />
                        <Text text={t('mnemonic_mask_reveal_title')} color="textWhite" />
                      </Row>
                    </Column>
                  )}
                </Column>

                {showPassphrase && (
                  <Row
                    justifyCenter
                    itemsCenter
                    gap="xs"
                    mt="sm"
                    onClick={() => {
                      setShowPassphrase(false);
                    }}
                    style={{
                      alignSelf: 'flex-end',
                      minHeight: 28,
                      minWidth: 96,
                      paddingLeft: 10,
                      paddingRight: 10,
                      borderRadius: 5,
                      backgroundColor: colors.black_dark,
                      cursor: 'pointer'
                    }}
                  >
                    <Icon icon="eye-slash" size={16} color="textDim" />
                    <Text text={t('hide')} color="textDim" />
                  </Row>
                )}
              </Card>
            )}

            <Card mt="lg" justifyBetween style={{ paddingLeft: 15, paddingRight: 10 }}>
              <Column>
                <Text text={t('derivation_path')} size="sm" />
                <Text
                  text={`${keyring.hdPath}/0 (${pathName})`}
                  preset="sub"
                  size="xs"
                  onClick={() => {
                    copy(keyring.hdPath);
                  }}
                  disableTranslate
                />
              </Column>
            </Card>
          </Column>
        )}
      </Content>
    </Layout>
  );
}
