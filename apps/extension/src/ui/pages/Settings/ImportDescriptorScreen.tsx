import { Button, Card, Column, Content, Header, Input, Layout, Row, Text } from '@/ui/components';
import { colors } from '@/ui/theme/colors';
import { useImportDescriptorScreenLogic } from '@unisat/wallet-state';

export default function ImportDescriptorScreen() {
  const {
    t,
    raw,
    setRaw,
    name,
    setName,
    accountCount,
    setAccountCount,
    gapOptions,
    error,
    disabled,
    busy,
    preview,
    onPreview,
    onConfirmImport,
    clearPreview,
    onClickBack
  } = useImportDescriptorScreenLogic();

  return (
    <Layout>
      <Header onBack={onClickBack} title={t('import_descriptor_title')} />
      <Content>
        <Column gap="lg">
          <Card>
            <Column gap="sm">
              <Text text={t('import_descriptor_help')} preset="sub" size="sm" />
              <Text text={t('import_descriptor_watch_only_note')} preset="sub" size="sm" color="orange" />
              <Text text={t('import_descriptor_gap_note')} preset="sub" size="sm" />
              <Row gap="sm" style={{ flexWrap: 'wrap' }}>
                {gapOptions.map((n) => (
                  <Button
                    key={n}
                    preset={accountCount === n ? 'primary' : 'default'}
                    text={
                      n === 20
                        ? t('import_descriptor_gap_20')
                        : n === 50
                          ? t('import_descriptor_gap_50')
                          : t('import_descriptor_gap_100')
                    }
                    onClick={() => setAccountCount(n)}
                    style={{
                      minHeight: 32,
                      borderColor: accountCount === n ? undefined : colors.border2
                    }}
                  />
                ))}
              </Row>
            </Column>
          </Card>

          <Input
            preset="text"
            placeholder={t('import_descriptor_wallet_name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <Input
            preset="text"
            placeholder={t('import_descriptor_placeholder')}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={6}
            spellCheck={false}
            autoComplete="off"
            style={{ minHeight: 120 }}
          />

          {preview ? (
            <Card>
              <Column gap="sm">
                <Text text={t('import_descriptor_confirm_title')} preset="bold" size="sm" />
                <Text text={t('import_descriptor_confirm_note')} preset="sub" size="sm" color="orange" />
                {preview.policyLabel ? (
                  <Text text={preview.policyLabel} size="xs" color="gold" />
                ) : null}
                {preview.previewAddresses.map((addr, i) => (
                  <Text key={addr} text={`#${i}  ${addr}`} size="xs" style={{ wordBreak: 'break-all' }} />
                ))}
              </Column>
            </Card>
          ) : null}

          {error && <Text text={error} preset="regular" color="error" />}

          {!preview ? (
            <Button
              text={busy ? t('loading') || 'Checking…' : t('import_descriptor_preview')}
              preset="primary"
              disabled={disabled}
              onClick={onPreview}
            />
          ) : (
            <Column gap="sm">
              <Button
                text={busy ? t('loading') || 'Importing…' : t('import_descriptor_confirm_button')}
                preset="primary"
                disabled={busy}
                onClick={onConfirmImport}
              />
              <Button
                text={t('cancel') || 'Cancel'}
                preset="default"
                disabled={busy}
                onClick={clearPreview}
              />
            </Column>
          )}
        </Column>
      </Content>
    </Layout>
  );
}
