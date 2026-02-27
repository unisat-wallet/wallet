import React from 'react';

import { Button, Card, Column, Content, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { BaseView } from '@/ui/components/BaseView';
import { NavTabBar } from '@/ui/components/NavTabBar';
import { SwitchNetworkBar } from '@/ui/components/SwitchNetworkBar';
import { fontSizes } from '@/ui/theme/font';
import { spacing } from '@/ui/theme/spacing';
import { DISCORD_URL, GITHUB_URL, TWITTER_URL } from '@unisat/wallet-shared';
import {
  SettingsItemType,
  useChain,
  useI18n,
  useNavigation,
  useSettingsTabScreenLogic,
  useUnreadNotificationsCount,
  useVersionInfo
} from '@unisat/wallet-state';

export default function SettingsTabScreen() {
  const versionInfo = useVersionInfo();
  const nav = useNavigation();
  const { t } = useI18n();
  const { unisatUrl } = useChain();
  const unreadNotificationCount = useUnreadNotificationsCount();
  const {
    settings_connectedSites,
    settings_addressBook,
    settings_addressType,
    settings_advanced,
    settings_feedback,
    settings_rateus,
    settings_aboutus,
    settings_lockwallet,
    settings_expandview
  } = useSettingsTabScreenLogic();

  const renderSettingsItem = (item: SettingsItemType, groupTop: boolean, groupBottom: boolean) => (
    <Card
      data-testid={item.key}
      onClick={() => item.onClick && item.onClick()}
      style={{
        height: '64px',
        flexShrink: 0,
        borderRadius:
          groupTop && groupBottom
            ? '12px 12px 12px 12px'
            : groupTop
            ? '12px 12px 0 0'
            : groupBottom
            ? '0 0 12px 12px'
            : '0',
        background: 'rgba(255, 255, 255, 0.06)',
        padding: '0 16px',
        margin: 0
      }}>
      <Row full justifyBetween style={{ height: '100%', alignItems: 'center' }}>
        <Row style={{ minWidth: 0, alignItems: 'center' }}>
          <Icon icon={item.icon as any} size={fontSizes.logo} color="textDim" />
          <Column style={{ gap: spacing.tiny, minWidth: 0, flex: 1, marginLeft: spacing.tiny }}>
            <Row justifyBetween>
              <Text text={item.label || item.desc} preset="regular" size="sm" style={{ color: 'white' }} />
              {item.badge && (
                <Text
                  text={item.badge}
                  preset="badge"
                  style={{
                    marginLeft: '6px'
                  }}
                />
              )}
            </Row>
          </Column>
        </Row>
        <Row style={{ alignItems: 'center', gap: spacing.small }}>
          {item.right && <Icon icon="right" size={fontSizes.lg} color="textDim" />}
        </Row>
      </Row>
    </Card>
  );

  const renderGroup = (items: SettingsItemType[]) => (
    <div>
      {items
        .filter((v) => v)
        .map((item, index) => (
          <React.Fragment key={item.key}>
            {renderSettingsItem(item, index === 0, index === items.length - 1)}
            {index < items.length - 1 && <Divider />}
          </React.Fragment>
        ))}
    </div>
  );

  const renderButtons = (items: SettingsItemType[]) => {
    return (
      <Column>
        {items
          .filter((v) => v)
          .map((item) => (
            <Button
              key={item.key}
              style={{
                height: 50,
                backgroundColor: 'rgba(20, 20, 20, 0.8)',
                width: '328px',
                margin: '0 auto',
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.45)'
              }}
              text={item.desc}
              onClick={item.onClick}
            />
          ))}
      </Column>
    );
  };

  return (
    <Layout>
      <Header
        type="home"
        LeftComponent={
          <Row>
            <Text preset="title-bold" text={t('settings')} />
          </Row>
        }
        RightComponent={
          <Row itemsCenter gap="md">
            <BaseView style={{ position: 'relative' }}>
              <Icon
                icon="notification"
                size={20}
                color="textDim"
                onClick={() => {
                  nav.navToNotifications();
                }}
              />
              {unreadNotificationCount ? (
                <BaseView
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    width: 7,
                    height: 7,
                    backgroundColor: 'red',
                    borderRadius: '50%'
                  }}></BaseView>
              ) : null}
            </BaseView>

            <Icon
              icon="language"
              size={20}
              color="textDim"
              onClick={() => {
                nav.navigate('LanguageScreen');
              }}
            />
            <SwitchNetworkBar />
          </Row>
        }
      />
      <Content>
        <Column>
          <Column style={{ alignItems: 'center' }}>
            <Column fullX>
              {renderGroup([settings_connectedSites])}
              {renderGroup([settings_addressBook])}
              {renderGroup([settings_addressType, settings_advanced])}
              {renderGroup([settings_feedback, settings_rateus, settings_aboutus])}
            </Column>

            {renderButtons([settings_expandview!, settings_lockwallet])}
          </Column>

          <Row justifyCenter gap="xl" mt="lg">
            <Icon
              icon="website"
              size={fontSizes.iconMiddle}
              color="textDim"
              onClick={() => {
                nav.navToUrl(unisatUrl);
              }}
            />
            <Icon
              icon="discord"
              size={fontSizes.iconMiddle}
              color="textDim"
              onClick={() => {
                nav.navToUrl(DISCORD_URL);
              }}
            />

            <Icon
              icon="twitter"
              size={fontSizes.iconMiddle}
              color="textDim"
              onClick={() => {
                nav.navToUrl(TWITTER_URL);
              }}
            />

            <Icon
              icon="github"
              size={fontSizes.iconMiddle}
              color="textDim"
              onClick={() => {
                nav.navToUrl(GITHUB_URL);
              }}
            />
          </Row>
          <Text text={`${t('version')} ${versionInfo.currentVesion}`} preset="sub" textCenter />
        </Column>
      </Content>
      <Footer px="zero" py="zero">
        <NavTabBar tab="settings" />
      </Footer>
    </Layout>
  );
}

function Divider() {
  return (
    <div
      style={{
        height: '1px',
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        margin: '0'
      }}
    />
  );
}
