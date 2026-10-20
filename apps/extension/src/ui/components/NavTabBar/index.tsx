import { useEffect, useState } from 'react';

import { colors } from '@/ui/theme/colors';
import { dismissAssetsNewBadge, isAssetsNewBadgeDismissed } from '@/ui/utils/assetsNewBadge';
import {
  TabOption,
  useCurrentAddress,
  useHasNewBanner,
  useI18n,
  useNavigation,
  useUnreadNotificationsCount,
  useWallet
} from '@unisat/wallet-state';

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
  const wallet = useWallet();
  const address = useCurrentAddress();
  const { t } = useI18n();
  const hasNewBanner = useHasNewBanner();
  const unreadNotificationCount = useUnreadNotificationsCount();
  const [showAssetsNewBadge, setShowAssetsNewBadge] = useState(
    () => tabName === 'assets' && !isAssetsNewBadgeDismissed(address)
  );

  useEffect(() => {
    if (tabName !== 'assets') return;
    setShowAssetsNewBadge(!isAssetsNewBadgeDismissed(address));
  }, [tabName, address, isActive]);

  const markAssetsNewBadgeDismissed = () => {
    dismissAssetsNewBadge(address);
    setShowAssetsNewBadge(false);
    if (address) {
      void wallet.setAssetsNewBadgeDismissed(address, true);
    }
  };

  return (
    <Column
      justifyCenter
      itemsCenter
      style={{
        gap: 4,
        minWidth: 0,
        cursor: 'pointer',
        // Selected: 10% pure white rectangular background (no radius)
        ...(isActive
          ? {
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: 0,
              paddingTop: 6,
              paddingBottom: 6,
              paddingLeft: 10,
              paddingRight: 10
            }
          : null)
      }}
      onClick={() => {
        if (tabName === 'home') {
          nav.navigate('MainScreen');
        } else if (tabName === 'assets') {
          markAssetsNewBadgeDismissed();
          nav.navigate('AssetsTabScreen');
        } else if (tabName === 'discover') {
          nav.navigate('DiscoverTabScreen');
        } else if (tabName === 'settings') {
          nav.navigate('SettingsTabScreen');
        }
      }}
      data-testid={dataTestId}>
      <BaseView style={{ position: 'relative', width: 20, height: 20 }}>
        <Icon
          size={20}
          icon={icon}
          color={isActive ? 'white' : 'white_muted'}
          style={tabName === 'assets' ? { backgroundColor: '#F4B62C', color: '#F4B62C' } : undefined}
        />
        {tabName === 'assets' && showAssetsNewBadge && !isActive && (
          <span
            style={{
              position: 'absolute',
              top: -6,
              right: -18,
              zIndex: 1,
              height: 14,
              padding: '0 4px',
              borderRadius: 4,
              background: 'linear-gradient(90deg, #F57A3D 0%, #EE5230 100%)',
              color: '#fff',
              fontFamily: 'Inter-Regular, sans-serif',
              fontSize: 11,
              fontWeight: 500,
              lineHeight: '14px',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none'
            }}>
            {t('new_badge')}
          </span>
        )}
        {tabName === 'discover' && hasNewBanner && <UnreadDot top={-3} right={-5} />}
        {tabName === 'settings' && unreadNotificationCount > 0 && <UnreadDot top={-3} right={-5} />}
      </BaseView>
      <Text text={t(tabName)} size="xs" color={isActive ? 'white' : 'white_muted'} textCenter max1Lines />
    </Column>
  );
}
