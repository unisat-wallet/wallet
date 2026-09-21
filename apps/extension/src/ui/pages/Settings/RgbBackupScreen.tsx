import { type ChangeEvent, useRef, useState } from 'react';

import { Button, Card, Column, Content, Header, Layout, Row, Text } from '@/ui/components';
import { Popover } from '@/ui/components/Popover';
import { useI18n, useNavigation, useTools, useWallet } from '@unisat/wallet-state';

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
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [reading, setReading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [payload, setPayload] = useState<string>();
  const [filename, setFilename] = useState<string>();
  const [preview, setPreview] = useState<BackupPreview>();
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmCloudRestore, setConfirmCloudRestore] = useState(false);

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
      tools.toastSuccess(t('rgb_backup_downloaded'));
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
      tools.toastSuccess(t('rgb_backup_verified'));
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
      tools.toastSuccess(t('rgb_backup_restored'));
      nav.goBack();
    } catch (error) {
      tools.toastError(errorMessage(error));
    } finally {
      setRestoring(false);
    }
  };

  const restoreCloudCheckpoint = async () => {
    setRestoring(true);
    try {
      await wallet.restoreLatestRgbRecoveryCheckpoint();
      setConfirmCloudRestore(false);
      tools.toastSuccess(t('rgb_cloud_state_restored'));
      nav.goBack();
    } catch (error) {
      tools.toastError(errorMessage(error));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Layout>
      <Header onBack={() => nav.goBack()} title={t('rgb_backup')} />
      <Content>
        <Column gap="lg">
          <Card style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <Text text={t('rgb_backup_download_description')} color="white" size="sm" />
            <Text
              text={t('rgb_backup_safety_description')}
              color="textDim"
              size="xs"
              wrap
            />
          </Card>
          <Button
            text={t('rgb_download_backup_file')}
            preset="primary"
            disabled={exporting}
            onClick={() => void exportBackup()}
          />

          <Card style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <Text text={t('rgb_restore_from_backup')} color="white" preset="bold" size="sm" />
            <Text
              text={t('rgb_restore_replaces_state_description')}
              color="textDim"
              size="xs"
              wrap
            />
            {preview ? (
              <Column gap="xs" style={{ marginTop: 8 }}>
                <Text text={t('rgb_backup_file', { filename: filename || '' })} color="white" size="xs" />
                <Text text={t('rgb_backup_created', { date: new Date(preview.createdAt).toLocaleString() })} color="textDim" size="xs" />
                <Text text={t('rgb_backup_network', { network: preview.wallet.network })} color="textDim" size="xs" />
              </Column>
            ) : null}
          </Card>
          <Button
            text={t(reading ? 'rgb_verifying_backup' : 'rgb_choose_backup_file')}
            preset="default"
            disabled={reading}
            onClick={selectBackup}
          />
          <Button
            text={t('rgb_restore_selected_backup')}
            preset="primary"
            disabled={!payload || reading || restoring}
            onClick={() => setConfirmRestore(true)}
          />
          <Button
            text={t('rgb_recover_latest_cloud_state')}
            preset="default"
            disabled={restoring}
            onClick={() => setConfirmCloudRestore(true)}
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
            <Text text={t('rgb_replace_state_title')} preset="title-bold" />
            <Text
              text={t('rgb_replace_state_description')}
              color="textDim"
              size="sm"
              wrap
            />
            <Row fullX>
              <Button
                text={t('cancel')}
                preset="defaultV2"
                full
                disabled={restoring}
                onClick={() => setConfirmRestore(false)}
              />
              <Button
                text={t(restoring ? 'restoring_rgb' : 'rgb_replace_and_restore')}
                preset="primaryV2"
                full
                disabled={restoring}
                onClick={() => void restoreBackup()}
              />
            </Row>
          </Column>
        </Popover>
      ) : null}
      {confirmCloudRestore ? (
        <Popover onClose={() => !restoring && setConfirmCloudRestore(false)}>
          <Column gap="md">
            <Text text={t('rgb_recover_cloud_title')} preset="title-bold" />
            <Text
              text={t('rgb_recover_cloud_description')}
              color="textDim"
              size="sm"
              wrap
            />
            <Row fullX>
              <Button
                text={t('cancel')}
                preset="defaultV2"
                full
                disabled={restoring}
                onClick={() => setConfirmCloudRestore(false)}
              />
              <Button
                text={t(restoring ? 'rgb_recovering' : 'rgb_recover_from_cloud')}
                preset="primaryV2"
                full
                disabled={restoring}
                onClick={() => void restoreCloudCheckpoint()}
              />
            </Row>
          </Column>
        </Popover>
      ) : null}
    </Layout>
  );
}
