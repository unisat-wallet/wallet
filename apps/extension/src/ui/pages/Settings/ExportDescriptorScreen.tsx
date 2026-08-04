import { Button, Card, Column, Content, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { useExportDescriptorScreenLogic } from '@unisat/wallet-state';

function CopyBlock({
  label,
  value,
  onCopy
}: {
  label: string;
  value: string;
  onCopy: (str: string) => void;
}) {
  return (
    <Column gap="sm">
      <Text text={label} preset="sub" size="sm" />
      <Card
        onClick={() => {
          onCopy(value);
        }}>
        <Row>
          <Icon icon="copy" color="textDim" />
          <Text text={value} color="textDim" size="xs" style={{ overflowWrap: 'anywhere' }} />
        </Row>
      </Card>
    </Column>
  );
}

export default function ExportDescriptorScreen() {
  const {
    t,
    loading,
    descriptor,
    changeDescriptor,
    xpub,
    accountPath,
    fingerprint,
    policyLabel,
    error,
    copy,
    onClickBack
  } = useExportDescriptorScreenLogic();

  return (
    <Layout>
      <Header onBack={onClickBack} title={t('export_descriptor_title')} />
      <Content>
        <Column gap="lg">
          <Card>
            <Column gap="md">
              <Text text={t('export_descriptor_help')} preset="sub" size="sm" />
              {policyLabel ? (
                <Text
                  text={(t('export_descriptor_policy') || 'Policy: $1').replace('$1', policyLabel)}
                  preset="regular"
                  size="sm"
                  color="gold"
                />
              ) : null}
              {accountPath || fingerprint ? (
                <Text
                  text={[fingerprint ? `Fingerprint: ${fingerprint}` : '', accountPath ? `Path: ${accountPath}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                  preset="sub"
                  size="xs"
                />
              ) : null}
            </Column>
          </Card>

          {loading && <Text text={t('loading') || 'Loading…'} preset="sub" textCenter />}
          {error && <Text text={error} preset="regular" color="error" />}

          {descriptor ? (
            <Column gap="md">
              <CopyBlock label={t('export_descriptor_receive')} value={descriptor} onCopy={copy} />

              {changeDescriptor ? (
                <CopyBlock label={t('export_descriptor_change')} value={changeDescriptor} onCopy={copy} />
              ) : null}

              {xpub ? <CopyBlock label={t('export_descriptor_account_xpub')} value={xpub} onCopy={copy} /> : null}

              <Button text={t('export_descriptor_copy_receive')} preset="primary" onClick={() => copy(descriptor)} />
              {xpub ? (
                <Button text={t('export_descriptor_copy_xpub')} preset="default" onClick={() => copy(xpub)} />
              ) : null}
            </Column>
          ) : null}
        </Column>
      </Content>
    </Layout>
  );
}
