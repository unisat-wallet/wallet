import { Checkbox } from 'antd';
import { useState } from 'react';

import { Button, Column, Row, Text } from '@/ui/components';
import { BottomModal } from '@/ui/components/BottomModal';
import { colors } from '@/ui/theme/colors';
import { fontSizes } from '@/ui/theme/font';
import { CloseOutlined } from '@ant-design/icons';
import { useI18n } from '@unisat/wallet-state';

export default function MultiSignDisclaimerModal({
  txCount,
  onClose,
  onContinue
}: {
  txCount: number;
  onClose: any;
  onContinue: (trustSite: boolean) => void;
}) {
  const { t } = useI18n();
  const [trustSite, setTrustSite] = useState(false);
  return (
    <BottomModal onClose={onClose}>
      <Column>
        <Row justifyBetween itemsCenter style={{ height: 20 }}>
          <Row />
          <Text text={t('multisign_disclaimer')} textCenter size="md" />
          <Row
            onClick={() => {
              onClose();
            }}>
            <CloseOutlined />
          </Row>
        </Row>

        <Row fullX style={{ borderTopWidth: 1, borderColor: colors.border }} my="md" />

        <Column justifyCenter rounded mb="lg" style={{ maxHeight: '50vh', overflow: 'auto' }}>
          <Text style={{ fontSize: fontSizes.sm, lineHeight: 2 }} text={t('sign_all_transactions_at_once')} />

          <Text
            mt="lg"
            style={{ fontSize: fontSizes.sm, lineHeight: 2 }}
            text={t('by_proceeding_you_confirm_that_youve_read_and_accepted_this_disclaimer')}></Text>
        </Column>

        <Row itemsCenter mb="md" onClick={() => setTrustSite((v) => !v)} style={{ cursor: 'pointer' }}>
          <Checkbox checked={trustSite} onChange={(e) => setTrustSite(e.target.checked)} />
          <Text mt="sm" style={{ fontSize: fontSizes.sm }} text={t('trust_this_site_for_quick_multi_sign')} />
        </Row>

        <Button
          text={`${t('sign_all')} ${txCount} ${t('transactions_at_once')}`}
          preset="primaryV2"
          onClick={() => {
            onContinue(trustSite);
          }}
        />
      </Column>
    </BottomModal>
  );
}
