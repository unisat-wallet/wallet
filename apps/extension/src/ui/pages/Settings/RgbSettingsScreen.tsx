import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button, Column, Content, Header, Icon, Layout, Row, Text } from '@/ui/components';
import type { IconTypes } from '@/ui/components/Icon';
import { Popover } from '@/ui/components/Popover';
import type { ColorTypes } from '@/ui/theme/colors';
import { fontSizes } from '@/ui/theme/font';
import { useDeveloperMode, useI18n, useTools, useWallet } from '@unisat/wallet-state';

const actionStyle = {
  width: '100%',
  minHeight: 56,
  padding: '12px 16px',
  boxSizing: 'border-box' as const,
  borderRadius: 10,
  background: 'rgba(255,255,255,0.055)',
  border: '1px solid rgba(255,255,255,0.08)',
  cursor: 'pointer'
};

function SettingsAction({
  icon,
  iconColor,
  title,
  description,
  testId,
  onClick
}: {
  icon: IconTypes;
  iconColor: ColorTypes;
  title: string;
  description: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <Row data-testid={testId} full itemsCenter justifyBetween style={actionStyle} onClick={onClick}>
      <Row gap="md" itemsCenter style={{ minWidth: 0 }}>
        <Icon icon={icon} color={iconColor} size={20} />
        <Column gap="xs" style={{ minWidth: 0 }}>
          <Text text={title} color="white" size="sm" />
          <Text text={description} color="textDim" size="xs" wrap />
        </Column>
      </Row>
      <Row itemsCenter gap="xs" style={{ flexShrink: 0 }}>
        <Icon icon="right" size={fontSizes.lg} color="textDim" />
      </Row>
    </Row>
  );
}

export default function RgbSettingsScreen() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const wallet = useWallet();
  const tools = useTools();
  const developerMode = useDeveloperMode();
  const [confirmCloudRestore, setConfirmCloudRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const restoreCloudCheckpoint = async () => {
    setRestoring(true);
    try {
      await wallet.restoreLatestRgbRecoveryCheckpoint();
      setConfirmCloudRestore(false);
      tools.toastSuccess(t('rgb_cloud_state_restored'));
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error ? error.message : error;
      tools.toastError(
        typeof message === 'string' && message && message !== 'Object' && message !== '[object Object]'
          ? message
          : t('unknown_error')
      );
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Layout>
      <Header onBack={() => window.history.go(-1)} title={t('rgb_settings')} />
      <Content style={{ paddingTop: 16 }}>
        <Column fullX gap="lg">
          <Column fullX gap="md">
            <Text text={t('backup_and_recovery')} color="textDim" size="xs" />
            <SettingsAction
              testId="rgb-settings-export-backup"
              icon="wallet-info"
              iconColor="ticker_color2"
              title={t('rgb_export_backup_entry')}
              description={t('rgb_export_backup_settings_description')}
              onClick={() => navigate('/settings/rgb/backup/export')}
            />
            <SettingsAction
              testId="rgb-settings-import-backup"
              icon="wallet-info"
              iconColor="ticker_color2"
              title={t('rgb_import_backup_entry')}
              description={t('rgb_import_backup_settings_description')}
              onClick={() => navigate('/settings/rgb/backup/restore')}
            />
            <SettingsAction
              testId="rgb-settings-cloud-recovery"
              icon="rgb"
              iconColor="ticker_color2"
              title={t('rgb_recover_latest_cloud_state')}
              description={t('rgb_cloud_current_account_description')}
              onClick={() => !restoring && setConfirmCloudRestore(true)}
            />
          </Column>

          <Column fullX gap="md">
            <Text text={t('advanced')} color="textDim" size="xs" />
            <SettingsAction
              testId="rgb-settings-asset-address"
              icon="rgb"
              iconColor="ticker_color2"
              title={t('rgb_asset_address')}
              description={t('rgb_asset_address_description')}
              onClick={() => navigate('/settings/rgb-utxos')}
            />
            <SettingsAction
              testId="rgb-settings-fee-pool"
              icon="btc"
              iconColor="gold"
              title={t('rgb_fee_pool_title')}
              description={t('rgb_fee_pool_description')}
              onClick={() => navigate('/settings/rgb-fee-pool')}
            />
            {developerMode ? (
              <SettingsAction
                testId="rgb-settings-abandon-asset"
                icon="warning"
                iconColor="danger"
                title={t('rgb_asset_abandon_title')}
                description={t('rgb_asset_abandon_settings_description')}
                onClick={() => navigate('/settings/rgb/abandon-asset')}
              />
            ) : null}
          </Column>
        </Column>
      </Content>
      {confirmCloudRestore ? (
        <Popover onClose={() => !restoring && setConfirmCloudRestore(false)}>
          <Column gap="md">
            <Text text={t('rgb_recover_cloud_title')} preset="title-bold" />
            <Text text={t('rgb_cloud_current_account_description')} color="white" size="sm" wrap />
            <Text text={t('rgb_recover_cloud_description')} color="textDim" size="sm" wrap />
            <Row fullX>
              <Button text={t('cancel')} preset="defaultV2" full disabled={restoring} onClick={() => setConfirmCloudRestore(false)} />
              <Button text={t(restoring ? 'rgb_recovering' : 'rgb_recover_from_cloud')} preset="primaryV2" full disabled={restoring} onClick={() => void restoreCloudCheckpoint()} />
            </Row>
          </Column>
        </Popover>
      ) : null}
    </Layout>
  );
}
