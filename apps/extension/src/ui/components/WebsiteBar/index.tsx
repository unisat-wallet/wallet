import { fontSizes } from '@/ui/theme/font';

import { Card } from '../Card';
import { Image } from '../Image';
import { Row } from '../Row';
import { Text } from '../Text';
import { DEFAULT_SESSION_ICON, formatSessionIcon } from '@/ui/utils';

const WebsiteBar = ({ session }: { session: { origin: string; icon: string; name: string } }) => {
  return (
    <Card preset="style2" selfItemsCenter>
      <Row itemsCenter>
        <Image src={formatSessionIcon(session)} fallbackSrc={DEFAULT_SESSION_ICON} size={fontSizes.logo} />
        <Text text={session.origin} />
      </Row>
    </Card>
  );
};

export default WebsiteBar;
