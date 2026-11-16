import { useState } from 'react';

import { Button, Checkbox, Column, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { openSafeUrl } from '@/ui/utils/openSafeUrl';
import { PlatformEnv } from '@unisat/wallet-shared';
import { useI18n } from '@unisat/wallet-state';

const RGB_TERMS_OF_USE_URL = 'https://link.unisat.space/rgb-terms-of-use';
const RGB_TERMS_OF_USE_APP_URL = 'https://link.unisat.space/rgb-terms-of-use-app';

function rgbTermsOfUseUrl() {
  return PlatformEnv.PLATFORM === 'ios' || PlatformEnv.PLATFORM === 'android'
    ? RGB_TERMS_OF_USE_APP_URL
    : RGB_TERMS_OF_USE_URL;
}

/** Consent is local, while encrypted RGB recovery state is wallet-scoped in the backend. */
export function RgbFeatureActivationModal({
  loading,
  recoveryAvailable,
  onClose,
  onEnable
}: {
  loading?: boolean;
  recoveryAvailable?: boolean;
  onClose: () => void;
  onEnable: () => void;
}) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const { t } = useI18n();
  const openTerms = () => openSafeUrl(rgbTermsOfUseUrl());

  return (
    <BottomModal onClose={loading ? undefined : onClose}>
      <Column gap="lg">
        <Text text={t(recoveryAvailable ? 'restore_rgb' : 'enable_rgb')} color="white" size="lg" textCenter />
        <Text
          text={t(recoveryAvailable ? 'rgb_restore_description' : 'rgb_enable_description')}
          color="white_muted2"
          size="sm"
          wrap
        />
        <Text
          text={t('rgb_single_device_warning')}
          color="gold"
          size="xs"
          wrap
        />
        <Checkbox
          data-testid="rgb-terms-checkbox"
          checked={termsAccepted}
          disabled={loading}
          onChange={(event) => setTermsAccepted(event.target.checked)}
          style={{ lineHeight: '20px' }}>
          <span style={{ color: 'rgba(255, 255, 255, 0.72)', fontSize: 13 }}>
            {t('i_have_read_and_agree_to')}{' '}
            <span
              role="link"
              tabIndex={0}
              style={{ color: '#F4B62C', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openTerms();
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                openTerms();
              }}>
              {t('rgb_terms_of_use')}
            </span>
          </span>
        </Checkbox>
        <Row gap="sm" fullX>
          <Button text={t('not_now')} preset="default" disabled={loading} onClick={onClose} style={{ flex: 1 }} />
          <Button
            data-testid="rgb-enable-confirm-button"
            text={
              loading
                ? t(recoveryAvailable ? 'restoring_rgb' : 'enabling_rgb')
                : t(recoveryAvailable ? 'restore_rgb' : 'enable_rgb')
            }
            preset="primary"
            disabled={loading || !termsAccepted}
            onClick={onEnable}
            style={{ flex: 1 }}
          />
        </Row>
      </Column>
    </BottomModal>
  );
}
