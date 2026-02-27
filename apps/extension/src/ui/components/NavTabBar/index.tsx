import { colors } from '@/ui/theme/colors';
import { TabOption, useHasNewBanner, useNavigation, useUnreadNotificationsCount } from '@unisat/wallet-state';

import { BaseView } from '../BaseView';
import { Column } from '../Column';
import { Grid } from '../Grid';
import { Icon, IconTypes } from '../Icon';

export function NavTabBar({ tab }: { tab: TabOption }) {
  return (
    <Grid columns={3} style={{ width: '100%', height: '67.5px', backgroundColor: colors.bg2 }}>
      <TabButton tabName="home" icon="unisat" isActive={tab === 'home'} data-testid="tab-home" />
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
  const hasNewBanner = useHasNewBanner();
  const unreadNotificationCount = useUnreadNotificationsCount();

  return (
    <Column
      justifyCenter
      itemsCenter
      onClick={(e) => {
        if (tabName === 'home') {
          nav.navigate('MainScreen');
        } else if (tabName === 'discover') {
          nav.navigate('DiscoverTabScreen');
        } else if (tabName === 'settings') {
          nav.navigate('SettingsTabScreen');
        }
      }}
      data-testid={dataTestId}>
      <Icon size={20} icon={icon} color={isActive ? 'white' : 'white_muted'} />
      <BaseView style={{ position: 'relative' }}>
        {tabName === 'discover' && hasNewBanner && (
          <BaseView
            style={{
              position: 'absolute',
              top: -28,
              right: -10,
              width: 7,
              height: 7,
              backgroundColor: 'red',
              borderRadius: '50%'
            }}></BaseView>
        )}
        {tabName === 'settings' && unreadNotificationCount > 0 && (
          <BaseView
            style={{
              position: 'absolute',
              top: -28,
              right: -10,
              width: 7,
              height: 7,
              backgroundColor: 'red',
              borderRadius: '50%'
            }}></BaseView>
        )}
      </BaseView>
    </Column>
  );
}
