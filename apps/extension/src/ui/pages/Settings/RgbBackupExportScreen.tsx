import { useState } from 'react';

import { Button, Card, Column, Content, Header, Layout, Text } from '@/ui/components';
import { useI18n, useNavigation, useTools, useWallet } from '@unisat/wallet-state';

import { RgbBackupStepBar } from './RgbBackupStepBar';
import { getRgbBackupNetworkLabel } from './rgbBackupNetworkLabel';

type BackupPlan = Awaited<ReturnType<ReturnType<typeof useWallet>['getRgbHdBackupPlan']>>;

function backupFilename(createdAt = Date.now()) {
  return `unisat-rgb-hd-backup-${new Date(createdAt).toISOString().slice(0, 10)}.rgbbackup`;
}

export default function RgbBackupExportScreen() {
  const wallet = useWallet();
  const nav = useNavigation();
  const tools = useTools();
  const { t } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [plan, setPlan] = useState<BackupPlan>();
  const [busy, setBusy] = useState(false);

  const reviewExport = async () => {
    setBusy(true);
    setPlan(undefined);
    try {
      const nextPlan = await wallet.getRgbHdBackupPlan();
      setPlan(nextPlan);
      setStep(2);
    } catch (error) {
      tools.toastError((error as any).message);
    } finally {
      setBusy(false);
    }
  };

  const exportBackup = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const backup = await wallet.exportRgbHdBackup(plan);
      const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = backupFilename();
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStep(3);
      tools.toastSuccess(t('rgb_backup_downloaded'));
    } catch (error) {
      setPlan(undefined);
      setStep(1);
      tools.toastError((error as any).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout>
      <Header onBack={() => nav.goBack()} title={t('rgb_export_backup_entry')} />
      <Content>
        <Column gap="lg">
          <RgbBackupStepBar
            step={step}
            labels={[t('rgb_export_step_prepare'), t('rgb_export_step_review'), t('rgb_export_step_done')]}
            onStepClick={(target) => {
              if (!busy && step !== 3) setStep(target);
            }}
          />
          {step === 1 ? (
            <>
              <Card style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <Text text={t('rgb_backup_download_description')} color="white" size="sm" wrap />
                <Text text={t('rgb_backup_safety_description')} color="textDim" size="xs" wrap />
              </Card>
              <Button
                text={t('rgb_review_backup_scope')}
                preset="primary"
                disabled={busy}
                onClick={() => void reviewExport()}
              />
            </>
          ) : null}
          {step === 2 && plan ? (
            <>
              <Card style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <Text
                  text={t('rgb_backup_network', { network: getRgbBackupNetworkLabel(plan.network) })}
                  color="textDim"
                  size="xs"
                />
                <Text
                  text={t('rgb_backup_account_count', { count: plan.accountIndexes.length })}
                  color="white"
                  size="sm"
                  preset="bold"
                />
                <Text
                  text={t('rgb_backup_accounts', {
                    accounts: plan.accountIndexes.map((index) => index + 1).join(', ')
                  })}
                  color="textDim"
                  size="xs"
                  wrap
                />
              </Card>
              <Button
                text={t('rgb_confirm_export_backup', { count: plan.accountIndexes.length })}
                preset="primary"
                disabled={busy}
                onClick={() => void exportBackup()}
              />
            </>
          ) : null}
          {step === 3 ? (
            <>
              <Card style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <Text text={t('rgb_backup_downloaded')} color="white" size="sm" preset="bold" />
                <Text text={t('rgb_backup_safety_description')} color="textDim" size="xs" wrap />
              </Card>
              <Button text={t('done')} preset="primary" onClick={() => nav.goBack()} />
            </>
          ) : null}
        </Column>
      </Content>
    </Layout>
  );
}
