import { colors } from '@/ui/theme/colors';
import { TabOption, useHasNewBanner, useI18n, useNavigation, useUnreadNotificationsCount } from '@unisat/wallet-state';

import { BaseView } from '../BaseView';
import { Column } from '../Column';
import { Grid } from '../Grid';
import { Icon, IconTypes } from '../Icon';
import { Text } from '../Text';
import { UnreadDot } from '../UnreadDot';

export function NavTabBar({ tab }: { tab: TabOption }) {
  return (
    <Grid columns={4} style={{ width: '100%', height: '67.5px', backgroundColor: colors.bg2 }}>
      <TabButton tabName="home" icon="unisat" isActive={tab === 'home'} data-testid="tab-home" />
      <TabButton tabName="assets" icon="assets" isActive={tab === 'assets'} data-testid="tab-assets" />
      <TabButton tabName="discover" icon="compass" isActive={tab === 'discover'} data-testid="tab-discover" />
      <TabButton tabName="settings" icon="settings" isActive={tab === 'settings'} data-testid="tab-settings" />
    </Grid>
  );
}

function TabButton({
  tabName,
  icon,
  isActive,
  'data-testid': dataTestId
}: {
  tabName: TabOption;
  icon: IconTypes;
  isActive: boolean;
  'data-testid'?: string;
}) {
  const nav = useNavigation();
  const { t } = useI18n();
  const hasNewBanner = useHasNewBanner();
  const unreadNotificationCount = useUnreadNotificationsCount();

  return (
    <Column
      justifyCenter
      itemsCenter
      style={{ gap: 4, minWidth: 0, cursor: 'pointer' }}
      onClick={() => {
        if (tabName === 'home') {
          nav.navigate('MainScreen');
        } else if (tabName === 'assets') {
          nav.navigate('AssetsTabScreen');
        } else if (tabName === 'discover') {
          nav.navigate('DiscoverTabScreen');
        } else if (tabName === 'settings') {
          nav.navigate('SettingsTabScreen');
        }
      }}
      data-testid={dataTestId}>
      <BaseView style={{ position: 'relative', width: 20, height: 20 }}>
        <Icon size={20} icon={icon} color={isActive ? 'white' : 'white_muted'} />
        {tabName === 'discover' && hasNewBanner && <UnreadDot top={-3} right={-5} />}
        {tabName === 'settings' && unreadNotificationCount > 0 && <UnreadDot top={-3} right={-5} />}
      </BaseView>
      <Text text={t(tabName)} size="xs" color={isActive ? 'white' : 'white_muted'} textCenter max1Lines />
    </Column>
  );
}
