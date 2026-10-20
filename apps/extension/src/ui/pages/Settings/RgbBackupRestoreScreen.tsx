import { type ChangeEvent, useRef, useState } from 'react';

import { Button, Card, Checkbox, Column, Content, Header, Icon, Layout, Progress, Row, Spin, Text } from '@/ui/components';
import { Popover } from '@/ui/components/Popover';
import { colors } from '@/ui/theme/colors';
import { uiEventBus, useI18n, useNavigation, useReloadAccounts, useTools, useWallet } from '@unisat/wallet-state';
import { BUS_METHODS } from '@unisat/wallet-shared';

import { RgbBackupStepBar } from './RgbBackupStepBar';

type BackupPreview = Awaited<ReturnType<ReturnType<typeof useWallet>['inspectRgbBackupFile']>>;
type RestoreProgressBase = {
  progressId: string;
  completed: number;
  total: number;
};
type RestoreProgress = RestoreProgressBase & (
  | { phase: 'preparing' }
  | { phase: 'creating' | 'restoring' | 'restored'; accountNumber: number }
);

const restorePopoverStyle = {
  width: 343,
  boxSizing: 'border-box' as const,
  padding: '24px 16px',
  borderRadius: 12,
  backgroundColor: '#181A1F',
  maxHeight: 'calc(100vh - 40px)',
  overflowY: 'auto' as const
};

const riskCardStyle = {
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 8,
  overflow: 'hidden'
};

const mutedTextStyle = { color: 'rgba(255, 255, 255, 0.65)', lineHeight: '16px' };

function errorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') {
    const message = error.trim();
    return message && message !== 'Object' && message !== '[object Object]' ? message : undefined;
  }
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return errorMessage(value.message) || errorMessage(value.error) || errorMessage(value.cause);
  }
  return undefined;
}

export default function RgbBackupRestoreScreen() {
  const wallet = useWallet();
  const nav = useNavigation();
  const tools = useTools();
  const reloadAccounts = useReloadAccounts();
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reading, setReading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [payload, setPayload] = useState<string>();
  const [filename, setFilename] = useState<string>();
  const [preview, setPreview] = useState<BackupPreview>();
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [errorText, setErrorText] = useState<string>();
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress>();

  const importErrorText = (error: unknown, stage: 'read' | 'restore') => {
    const message = errorMessage(error);
    if (!message) return t(stage === 'read' ? 'rgb_import_error_read_failed' : 'rgb_import_error_restore_failed');
    if (/RGB account \d+ failed to restore/.test(message)) {
      const match = message.match(/RGB account (\d+) failed to restore; completed accounts: ([^.]+)\.\s*(.*)/s);
      if (match) {
        const summary = t('rgb_import_error_partial', {
          account: match[1],
          completed: match[2] === 'none' ? t('rgb_import_error_none') : match[2]
        });
        const reason = match[3]?.replace(/^Error:\s*/, '').trim();
        return reason ? `${summary} ${reason}` : summary;
      }
    }
    if (/RGB account (\d+) has not been created/.test(message)) {
      const account = message.match(/RGB account (\d+) has not been created/)?.[1] || '';
      return t('rgb_import_error_missing_account', { account });
    }
    if (message.includes('RGB backup network does not match')) return t('rgb_import_error_network');
    if (/does not belong|cannot be decrypted|was changed/.test(message)) return t('rgb_import_error_wrong_wallet');
    if (/backup package is invalid|backup package is required|backup is too large|backup state is too large/.test(message)) {
      return t('rgb_import_error_invalid_file');
    }
    if (/requires an HD wallet|does not support RGB HD backup/.test(message)) return t('rgb_import_error_hd_wallet');
    return message;
  };

  const readBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setReading(true);
    setStep(1);
    setPayload(undefined);
    setPreview(undefined);
    setFilename(undefined);
    setErrorText(undefined);
    try {
      const nextPayload = await file.text();
      const nextPreview = await wallet.inspectRgbBackupFile(nextPayload);
      setPayload(nextPayload);
      setFilename(file.name);
      setPreview(nextPreview);
      setStep(2);
      if (!nextPreview.missingAccountIndexes?.length) tools.toastSuccess(t('rgb_backup_verified'));
    } catch (error) {
      const message = importErrorText(error, 'read');
      setErrorText(message);
      tools.toastError(message);
    } finally {
      setReading(false);
    }
  };

  const restoreBackup = async () => {
    if (!payload || !preview || !riskAcknowledged) return;
    const progressId = globalThis.crypto.randomUUID();
    const onProgress = (progress?: RestoreProgress) => {
      if (progress?.progressId === progressId) setRestoreProgress(progress);
    };
    uiEventBus.addEventListener(BUS_METHODS.RGB_BACKUP_RESTORE_PROGRESS, onProgress);
    setRestoreProgress({ progressId, completed: 0, total: preview.accountIndexes.length, phase: 'preparing' });
    setRestoring(true);
    setErrorText(undefined);
    try {
      await wallet.restoreRgbBackupFile({
        payload,
        replaceRemote: true,
        createMissingAccounts: (preview.missingAccountIndexes?.length || 0) > 0,
        progressId
      });
      await reloadAccounts().catch(error => console.error('Failed to refresh accounts after RGB restore', error));
      setConfirmRestore(false);
      setStep(3);
      tools.toastSuccess(t('rgb_backup_restored'));
    } catch (error) {
      const message = importErrorText(error, 'restore');
      setConfirmRestore(false);
      setErrorText(message);
      tools.toastError(message);
    } finally {
      uiEventBus.removeEventListener(BUS_METHODS.RGB_BACKUP_RESTORE_PROGRESS, onProgress);
      setRestoring(false);
    }
  };

  const progressText = restoreProgress?.phase === 'creating'
    ? t('rgb_restore_progress_creating', { account: restoreProgress.accountNumber })
    : restoreProgress?.phase === 'restoring'
      ? t('rgb_restore_progress_restoring', { account: restoreProgress.accountNumber })
      : restoreProgress?.phase === 'restored'
        ? t('rgb_restore_progress_account_done', { account: restoreProgress.accountNumber })
        : t('rgb_restore_progress_preparing');
  const progressPercent = restoreProgress?.total
    ? Math.round((restoreProgress.completed / restoreProgress.total) * 100)
    : 0;

  return (
    <Layout>
      <Header onBack={() => nav.goBack()} title={t('rgb_import_backup_entry')} />
      <Content>
        <Column gap="lg">
          <RgbBackupStepBar
            step={step}
            labels={[t('rgb_restore_step_select'), t('rgb_restore_step_review'), t('rgb_restore_step_done')]}
            onStepClick={(target) => { if (!reading && !restoring && step !== 3) setStep(target); }}
          />
          {step === 1 ? (
            <>
              <Card style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <Text text={t('rgb_restore_from_backup')} color="white" size="sm" preset="bold" />
                <Text text={t('rgb_restore_replaces_state_description')} color="textDim" size="xs" wrap />
              </Card>
              <Button text={t(reading ? 'rgb_verifying_backup' : 'rgb_choose_backup_file')} preset="primary" disabled={reading} onClick={() => fileInput.current?.click()} />
              {errorText ? <Text text={errorText} color="error" size="xs" wrap /> : null}
            </>
          ) : null}
          {step === 2 && preview && payload ? (
            <>
              <Card style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <Text text={t('rgb_backup_file', { filename: filename || '' })} color="white" size="xs" wrap />
                <Text text={t('rgb_backup_created', { date: new Date(preview.createdAt).toLocaleString() })} color="textDim" size="xs" />
                <Text text={t('rgb_backup_network', { network: preview.network })} color="textDim" size="xs" />
                <Text text={t('rgb_restore_account_count', { count: preview.accountIndexes.length })} color="white" size="sm" preset="bold" />
                <Text text={t('rgb_backup_accounts', { accounts: preview.accountIndexes.map(index => index + 1).join(', ') })} color="textDim" size="xs" wrap />
                {!!preview.accountsToCreateIndexes?.length && (
                  <Text
                    text={t('rgb_restore_missing_accounts', {
                      accounts: preview.accountsToCreateIndexes.map(index => index + 1).join(', ')
                    })}
                    color="warning"
                    size="xs"
                    wrap
                  />
                )}
              </Card>
              <Text text={t('rgb_replace_state_description')} color="textDim" size="xs" wrap />
              <Button text={t('rgb_choose_backup_file')} preset="default" disabled={reading || restoring} onClick={() => fileInput.current?.click()} />
              <Button
                text={t(preview.accountsToCreateIndexes?.length ? 'rgb_restore_create_and_restore' : 'rgb_restore_selected_backup')}
                preset="primary"
                disabled={reading || restoring}
                onClick={() => {
                  setRiskAcknowledged(false);
                  setConfirmRestore(true);
                }}
              />
              {errorText ? <Text text={errorText} color="error" size="xs" wrap /> : null}
            </>
          ) : null}
          {step === 3 && preview ? (
            <>
              <Card style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <Text text={t('rgb_backup_restored')} color="white" size="sm" preset="bold" />
                <Text text={t('rgb_restore_account_count', { count: preview.accountIndexes.length })} color="textDim" size="xs" />
                <Text text={t('rgb_backup_accounts', { accounts: preview.accountIndexes.map(index => index + 1).join(', ') })} color="textDim" size="xs" wrap />
              </Card>
              <Button text={t('done')} preset="primary" onClick={() => nav.goBack()} />
            </>
          ) : null}
          <input ref={fileInput} type="file" accept=".rgbbackup,application/json" onChange={(event) => void readBackup(event)} style={{ display: 'none' }} />
        </Column>
      </Content>
      {confirmRestore ? (
        <Popover
          onClose={restoring ? undefined : () => setConfirmRestore(false)}
          contentStyle={restorePopoverStyle}
          closeStyle={{ top: 24, right: 16 }}>
          <Column fullX gap="xl">
            <Column fullX gap="lg">
              <Text
                text={t(restoring ? 'restoring_rgb' : 'rgb_replace_state_title')}
                size="md"
                style={{ fontWeight: 600, padding: '0 20px' }}
                textCenter
              />
              {!restoring && preview ? (
                <Text
                  text={t('rgb_confirm_restore_scope', {
                    count: preview.accountIndexes.length,
                    accounts: preview.accountIndexes.map(index => index + 1).join(', ')
                  })}
                  preset="sub"
                  style={mutedTextStyle}
                />
              ) : null}
            </Column>
            {restoring ? (
              <Column gap="sm" fullX>
                <Row gap="sm">
                  <Spin size="small" />
                  <Text text={progressText} color="white" size="sm" wrap />
                </Row>
                <Progress percent={progressPercent} showInfo={false} strokeColor={colors.primary} />
                <Text
                  text={t('rgb_restore_progress_completed', {
                    completed: restoreProgress?.completed || 0,
                    total: restoreProgress?.total || preview?.accountIndexes.length || 1
                  })}
                  color="textDim"
                  size="xs"
                />
              </Column>
            ) : (
              <>
                {!!preview?.accountsToCreateIndexes?.length && (
                  <Text
                    text={t('rgb_restore_missing_accounts', {
                      accounts: preview.accountsToCreateIndexes.map(index => index + 1).join(', ')
                    })}
                    color="warning"
                    size="xs"
                    wrap
                  />
                )}
                <Column fullX gap="zero" style={riskCardStyle}>
                  <Row fullX itemsCenter gap="md" style={{ minHeight: 36, padding: '0 8px' }}>
                    <Icon icon="alert" color="red_light2" size={16} />
                    <Text text={t('rgb_restore_file_risk_title')} size="xs" color="danger" />
                  </Row>
                  <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.15)' }} />
                  <Column fullX gap="sm" style={{ padding: 8 }}>
                    <Text text={t('rgb_restore_file_risk_description')} preset="sub" style={mutedTextStyle} />
                    <Text text={t('rgb_restore_file_risk_guidance')} preset="sub" style={mutedTextStyle} />
                  </Column>
                </Column>
                <Checkbox
                  checked={riskAcknowledged}
                  checkedColor={colors.red}
                  checkColor={colors.white}
                  onChange={event => setRiskAcknowledged(event.target.checked)}
                  style={{ alignSelf: 'stretch', alignItems: 'flex-start' }}
                  data-testid="rgb-backup-risk-checkbox">
                  <Text text={t('rgb_restore_file_risk_ack')} preset="sub" style={{ ...mutedTextStyle, flex: 1 }} />
                </Checkbox>
                <Column fullX gap="md">
                  <Button
                    text={t(preview?.accountsToCreateIndexes?.length ? 'rgb_restore_create_and_restore' : 'rgb_replace_and_restore')}
                    preset="delete"
                    full
                    disabled={!riskAcknowledged}
                    onClick={() => void restoreBackup()}
                  />
                  <Button text={t('cancel')} preset="primary" full onClick={() => setConfirmRestore(false)} />
                </Column>
              </>
            )}
          </Column>
        </Popover>
      ) : null}
    </Layout>
  );
}
