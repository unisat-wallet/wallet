import { useState } from 'react';

import { Button, Checkbox, Column, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { PlatformEnv } from '@unisat/wallet-shared';

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
  const openTerms = () => window.open(rgbTermsOfUseUrl(), '_blank', 'noopener,noreferrer');

  return (
    <BottomModal onClose={loading ? undefined : onClose}>
      <Column gap="lg">
        <Text text={recoveryAvailable ? 'Restore RGB wallet' : 'Enable RGB'} color="white" size="lg" textCenter />
        <Text
          text={
            recoveryAvailable
              ? 'Encrypted RGB wallet data was found for this wallet. After you accept the terms, it will be restored to this device automatically.'
              : 'RGB assets use additional local wallet state, encrypted recovery data, and RGB network services. Enabling it will set up RGB for this wallet on this device.'
          }
          color="white_muted2"
          size="sm"
          wrap
        />
        <Text
          text="You can view the same wallet on multiple devices, but only one device should create invoices, transfer, receive, release, or issue RGB assets at a time. Restoring an old state can cause sync conflicts."
          color="gold"
          size="xs"
          wrap
        />
        <Checkbox
          checked={termsAccepted}
          disabled={loading}
          onChange={(event) => setTermsAccepted(event.target.checked)}
          style={{ lineHeight: '20px' }}>
          <span style={{ color: 'rgba(255, 255, 255, 0.72)', fontSize: 13 }}>
            I have read and agree to the{' '}
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
              RGB Terms of Use
            </span>
            .
          </span>
        </Checkbox>
        <Row gap="sm" fullX>
          <Button text="Not now" preset="default" disabled={loading} onClick={onClose} style={{ flex: 1 }} />
          <Button
            text={loading ? (recoveryAvailable ? 'Restoring...' : 'Enabling...') : recoveryAvailable ? 'I understand, restore RGB' : 'I understand, enable RGB'}
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
