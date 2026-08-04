import { useNavigate } from 'react-router-dom';

import { Card, Column, Icon, Row, Text } from '@/ui/components';
import { fontSizes } from '@/ui/theme/font';
import { KeyringType } from '@unisat/keyring-service/types';
import { getLockTimeInfo } from '@unisat/wallet-shared';
import { useAutoLockTimeId, useChain, useCurrentKeyring, useI18n } from '@unisat/wallet-state';

/**
 * Descriptor export/import live here (not on the root Settings list).
 * Path: Settings tab → Advanced → these rows.
 */
export function SecurityCard() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const autoLockTimeId = useAutoLockTimeId();
  const lockTimeConfig = getLockTimeInfo(autoLockTimeId, t);
  const currentKeyring = useCurrentKeyring();
  const chain = useChain();

  // BIP-380 descriptors are Bitcoin-only (not Fractal)
  const descriptorsAvailable = !chain?.isFractal;

  // Show Export for HD / cold / watch — export screen shows a clear error if unsupported
  // (avoids hiding the menu when canExport RPC is stale/unavailable).
  const showExport =
    descriptorsAvailable &&
    (currentKeyring?.type === KeyringType.HdKeyring ||
      currentKeyring?.type === KeyringType.ColdWalletKeyring ||
      currentKeyring?.type === KeyringType.WatchAddressKeyring);

  return (
    <Card style={{ borderRadius: 10 }}>
      <Column fullX>
        <Row
          justifyBetween
          style={{
            cursor: 'pointer',
            marginBottom: 16
          }}
          onClick={() => navigate('/settings/password')}>
          <Text text={t('change_password')} size="sm" />
          <Icon icon="right" size={fontSizes.lg} color="textDim" />
        </Row>

        <Row
          justifyBetween
          style={{
            cursor: 'pointer',
            marginBottom: descriptorsAvailable ? 16 : 0
          }}
          onClick={() => navigate('/settings/lock-time')}>
          <Text text={t('automatic_lock_time')} size="sm" />

          <Row itemsCenter>
            <Text text={lockTimeConfig.label} color="gold" size="sm" />
            <Icon icon="right" size={fontSizes.lg} color="textDim" />
          </Row>
        </Row>

        {showExport ? (
          <Row
            justifyBetween
            style={{
              cursor: 'pointer',
              marginBottom: 16
            }}
            onClick={() => navigate('/settings/export-descriptor')}>
            <Text text={t('export_descriptor_xpub')} size="sm" />
            <Icon icon="right" size={fontSizes.lg} color="textDim" />
          </Row>
        ) : null}

        {descriptorsAvailable ? (
          <Row
            justifyBetween
            style={{
              cursor: 'pointer'
            }}
            onClick={() => navigate('/settings/import-descriptor')}>
            <Text text={t('import_descriptor')} size="sm" />
            <Icon icon="right" size={fontSizes.lg} color="textDim" />
          </Row>
        ) : null}
      </Column>
    </Card>
  );
}
