import { useEffect, useState } from 'react';

import { fontSizes } from '@/ui/theme/font';
import { openSafeUrl } from '@/ui/utils/openSafeUrl';
import { VersionDetail } from '@unisat/wallet-shared';
import { useVersionInfo, useWallet } from '@unisat/wallet-state';

import { Button } from '../Button';
import { Column } from '../Column';
import { Popover } from '../Popover';
import { Row } from '../Row';
import { Text } from '../Text';

export const UpgradePopover = ({
  onClose,
  onSkip
}: {
  onClose: () => void;
  onSkip: () => void | Promise<void>;
}) => {
  const versionInfo = useVersionInfo();

  const [versionDetail, setVersionDetail] = useState<VersionDetail>({
    version: '',
    changelogs: [],
    title: '',
    notice: ''
  });
  const wallet = useWallet();
  useEffect(() => {
    if (!versionInfo.newVersion) return;
    wallet
      .getVersionDetail(versionInfo.newVersion)
      .then((res) => {
        setVersionDetail(res);
      })
      .catch((e) => {
        console.log(e);
      });
  }, [versionInfo.newVersion]);
  return (
    <Popover onClose={onClose}>
      <Column justifyCenter itemsCenter>
        <Column mt="lg">
          <Text preset="bold" text={versionDetail.title} textCenter />
        </Column>

        <div style={{ marginTop: 8 }}>
          {versionDetail.changelogs.map((str, index) => (
            <div key={index} style={{ fontSize: fontSizes.sm }}>
              {str}
            </div>
          ))}
        </div>

        <Row full mt="lg">
          <Button
            text="Skip"
            full
            onClick={() => {
              onSkip();
            }}
          />

          <Button
            text="Go to update"
            full
            preset="primary"
            onClick={() => {
              openSafeUrl('https://unisat.io/extension/update');
            }}
          />
        </Row>
      </Column>
    </Popover>
  );
};
