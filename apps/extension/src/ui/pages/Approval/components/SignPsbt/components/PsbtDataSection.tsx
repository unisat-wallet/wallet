import { Card, Column, Icon, Row, Text } from '@/ui/components';
import { shortAddress } from '@/ui/utils';

import { ToSignData } from '@unisat/wallet-shared';
import { useI18n, useTools } from '@unisat/wallet-state';
import { SignPsbtSection } from './Section';

const PsbtDataSection = ({ toSignData }: { toSignData: ToSignData }) => {
  const tools = useTools();
  const { t } = useI18n();
  return (
    <SignPsbtSection title={t('psbt_data')}>
      <Card
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.06)'
        }}>
        <Column>
          <Row
            itemsCenter
            onClick={() => {
              tools.copyToClipboard(toSignData.psbtHex);
            }}>
            <Text text={shortAddress(toSignData.psbtHex, 18)} wrap />
            <Icon icon="copy" color="textDim" />
          </Row>

          <Row itemsCenter>
            <Text text={`${toSignData.psbtHex.length / 2} bytes`} color="textDim" />
          </Row>
        </Column>
      </Card>
    </SignPsbtSection>
  );
};

export default PsbtDataSection;
