import { type ChangeEvent, useRef, useState } from 'react';

import { Button, Card, Column, Content, Header, Layout, Row, Text } from '@/ui/components';
import { Popover } from '@/ui/components/Popover';
import { useNavigation, useTools, useWallet } from '@unisat/wallet-state';

type BackupPreview = Awaited<ReturnType<ReturnType<typeof useWallet>['inspectRgbBackup']>>;

function backupFilename(createdAt = Date.now()) {
  return `unisat-rgb-backup-${new Date(createdAt).toISOString().slice(0, 10)}.rgbbackup`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function RgbBackupScreen() {
  const wallet = useWallet();
  const nav = useNavigation();
  const tools = useTools();
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [reading, setReading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [payload, setPayload] = useState<string>();
  const [filename, setFilename] = useState<string>();
  const [preview, setPreview] = useState<BackupPreview>();
  const [confirmRestore, setConfirmRestore] = useState(false);

  const exportBackup = async () => {
    setExporting(true);
    try {
      const backup = await wallet.exportRgbBackup();
      const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = backupFilename();
      anchor.click();
      // Give the browser a turn to start the download before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      tools.toastSuccess('RGB backup downloaded');
    } catch (error) {
      tools.toastError(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const selectBackup = () => fileInput.current?.click();

  const readBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setReading(true);
    setPayload(undefined);
    setPreview(undefined);
    try {
      const nextPayload = await file.text();
      const nextPreview = await wallet.inspectRgbBackup(nextPayload);
      setPayload(nextPayload);
      setFilename(file.name);
      setPreview(nextPreview);
      tools.toastSuccess('RGB backup verified');
    } catch (error) {
      setFilename(undefined);
      tools.toastError(errorMessage(error));
    } finally {
      setReading(false);
    }
  };

  const restoreBackup = async () => {
    if (!payload) return;
    setRestoring(true);
    try {
      await wallet.restoreRgbBackup({ payload, replaceRemote: true });
      setConfirmRestore(false);
      tools.toastSuccess('RGB backup restored');
      nav.goBack();
    } catch (error) {
      tools.toastError(errorMessage(error));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Layout>
      <Header onBack={() => nav.goBack()} title="RGB Backup" />
      <Content>
        <Column gap="lg">
          <Card style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <Text text="Download a seed-bound encrypted copy of your RGB wallet state." color="white" size="sm" />
            <Text
              text="It does not contain your recovery phrase or private keys. Keep the file with your wallet recovery material."
              color="textDim"
              size="xs"
              wrap
            />
          </Card>
          <Button
            text="Download backup file"
            preset="primary"
            disabled={exporting}
            onClick={() => void exportBackup()}
          />

          <Card style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <Text text="Restore from backup" color="white" preset="bold" size="sm" />
            <Text
              text="Restoring replaces the current RGB state and its cloud recovery checkpoint. It never merges two states."
              color="textDim"
              size="xs"
              wrap
            />
            {preview ? (
              <Column gap="xs" style={{ marginTop: 8 }}>
                <Text text={`File: ${filename}`} color="white" size="xs" />
                <Text text={`Created: ${new Date(preview.createdAt).toLocaleString()}`} color="textDim" size="xs" />
                <Text text={`Network: ${preview.wallet.network}`} color="textDim" size="xs" />
              </Column>
            ) : null}
          </Card>
          <Button
            text={reading ? 'Verifying backup…' : 'Choose backup file'}
            preset="default"
            disabled={reading}
            onClick={selectBackup}
          />
          <Button
            text="Restore selected backup"
            preset="primary"
            disabled={!payload || reading || restoring}
            onClick={() => setConfirmRestore(true)}
          />
          <input
            ref={fileInput}
            type="file"
            accept=".rgbbackup,application/json"
            onChange={(event) => void readBackup(event)}
            style={{ display: 'none' }}
          />
        </Column>
      </Content>
      {confirmRestore ? (
        <Popover onClose={() => !restoring && setConfirmRestore(false)}>
          <Column gap="md">
            <Text text="Replace RGB state?" preset="title-bold" />
            <Text
              text="This permanently replaces the RGB state on this device and in the recovery checkpoint with the selected backup. This cannot be merged or undone."
              color="textDim"
              size="sm"
              wrap
            />
            <Row fullX>
              <Button
                text="Cancel"
                preset="defaultV2"
                full
                disabled={restoring}
                onClick={() => setConfirmRestore(false)}
              />
              <Button
                text={restoring ? 'Restoring…' : 'Replace and restore'}
                preset="primaryV2"
                full
                disabled={restoring}
                onClick={() => void restoreBackup()}
              />
            </Row>
          </Column>
        </Popover>
      ) : null}
    </Layout>
  );
}
