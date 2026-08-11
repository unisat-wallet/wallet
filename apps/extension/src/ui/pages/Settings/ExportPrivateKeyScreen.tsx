import { type KeyboardEvent, useEffect, useState } from 'react';

import { Button, Card, Column, Content, Header, Icon, Input, Layout, Row, Text } from '@/ui/components';
import { colors } from '@/ui/theme/colors';
import { useExportPrivateKeyScreenLogic } from '@unisat/wallet-state';

interface PrivateKeyValueProps {
  title: string;
  value: string;
  visible: boolean;
  revealText: string;
  hideText: string;
  onReveal: () => void;
  onHide: () => void;
  onCopy: (value: string) => void;
}

function PrivateKeyValue({
  title,
  value,
  visible,
  revealText,
  hideText,
  onReveal,
  onHide,
  onCopy
}: PrivateKeyValueProps) {
  return (
    <Column gap="xs" mt="lg" style={{ width: '100%', maxWidth: 400, alignSelf: 'center' }}>
      <Text text={title} color="white" size="sm" />
      <Column
        style={{
          position: 'relative',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          borderRadius: 8,
          padding: 8,
          overflow: 'hidden'
        }}
      >
        <Row itemsCenter onClick={() => onCopy(value)} style={{ minWidth: 0 }}>
          <Text text={value} size="md" selectText disableTranslate wrap style={{ minWidth: 0, flex: 1 }} />
          <Icon icon="copy" color="textDim" size={16} />
        </Row>

        {!visible && (
          <Column
            justifyCenter
            itemsCenter
            onClick={onReveal}
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
              <Text text={revealText} color="textWhite" />
            </Row>
          </Column>
        )}
      </Column>

      {visible && (
        <Row
          justifyCenter
          itemsCenter
          gap="xs"
          mt="sm"
          onClick={onHide}
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
          <Text text={hideText} color="textDim" />
        </Row>
      )}
    </Column>
  );
}

export default function ExportPrivateKeyScreen() {
  const [showWifPrivateKey, setShowWifPrivateKey] = useState(false);
  const [showHexPrivateKey, setShowHexPrivateKey] = useState(false);
  const { t, password, setPassword, disabled, btnClick, handleOnKeyUp, privateKey, error, copy, onClickBack } =
    useExportPrivateKeyScreenLogic();

  useEffect(() => {
    setShowWifPrivateKey(false);
    setShowHexPrivateKey(false);
  }, [privateKey.wif, privateKey.hex]);

  return (
    <Layout>
      <Header onBack={onClickBack} title={t('export_private_key')} />
      <Content>
        {privateKey.wif == '' ? (
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
              <Text text={t('if_you_lose_your_private_key_your_assets_will_be_g')} color="red" size="sm" mb="md" />
              <Text text={t('if_you_share_the_private_key_to_others_your_assets')} color="red" size="sm" mb="md" />
              <Text text={t('private_key_is_only_stored_in_your_browser_it_is_y')} color="red" size="sm" />
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

            <Button mt="lg" text={t('show_private_key')} preset="primary" disabled={disabled} onClick={btnClick} />
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
              <Text text={t('if_you_ever_change_browsers_or_move_computers_you_')} color="warning" size="sm" />
            </Card>

            <PrivateKeyValue
              title={t('wif_private_key')}
              value={privateKey.wif}
              visible={showWifPrivateKey}
              revealText={t('mnemonic_mask_reveal_title')}
              hideText={t('hide')}
              onReveal={() => setShowWifPrivateKey(true)}
              onHide={() => setShowWifPrivateKey(false)}
              onCopy={copy}
            />

            <PrivateKeyValue
              title={t('hex_private_key')}
              value={privateKey.hex}
              visible={showHexPrivateKey}
              revealText={t('mnemonic_mask_reveal_title')}
              hideText={t('hide')}
              onReveal={() => setShowHexPrivateKey(true)}
              onHide={() => setShowHexPrivateKey(false)}
              onCopy={copy}
            />
          </Column>
        )}
      </Content>
    </Layout>
  );
}
