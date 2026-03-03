import { Column, Content, Header, Layout, Row, Text } from '@/ui/components';
import { shortDesc } from '@/ui/utils';
import { StoredNotification } from '@unisat/wallet-shared';
import { useI18n, useNavigation, useNotificationsLogic } from '@unisat/wallet-state';

import { useNavigate } from '../MainRoute';

export default function NotificationListScreen() {
  const { t } = useI18n();
  const nav = useNavigation();
  const navigate = useNavigate();
  const { notifications, loading, unreadCount, handleReadNotification, handleReadAll, handleDeleteNotification } =
    useNotificationsLogic();

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return t('just_now');
    if (minutes < 60) return t('minutes_ago', String(minutes));
    if (hours < 24) return t('hours_ago', String(hours));
    if (days < 7) return t('days_ago', String(days));
    return new Date(timestamp).toLocaleDateString();
  };

  const handleCardClick = async (notification: StoredNotification) => {
    if (notification.readAt === undefined) {
      await handleReadNotification(notification.id);
    }
    if (notification.link) {
      window.open(notification.link);
    }
  };

  const layoutHeight = window.innerHeight - 64;

  return (
    <Layout>
      <Header
        onBack={() => {
          nav.goBack();
        }}
        title={t('notifications')}
        RightComponent={
          <Row gap="md">
            {unreadCount > 0 && <Text text={t('all_read') + ` (${unreadCount})`} onClick={handleReadAll} />}
          </Row>
        }
      />
      <Content style={{ padding: 0 }}>
        <div style={{ height: layoutHeight, overflowY: 'auto' }}>
          <Column px="md" gap="md">
            {loading ? (
              <Column justifyCenter itemsCenter py="xxl">
                <Text text={t('loading')} color="textDim" />
              </Column>
            ) : notifications.length === 0 ? (
              <Column justifyCenter itemsCenter py="xxl">
                <Text text={t('no_notifications')} color="textDim" />
              </Column>
            ) : (
              <Column gap="sm">
                {notifications.map((notification) => (
                  <Column
                    key={notification.id}
                    style={{
                      background: '#1A1A1A',
                      border: '1px solid #2C2C2C',
                      borderRadius: 12,
                      padding: 12,
                      cursor: 'pointer'
                    }}
                    onClick={() => handleCardClick(notification)}>
                    <Row justifyBetween>
                      <Text
                        text={formatTime(notification.publishTime)}
                        size="xs"
                        color="textDim"
                        style={{ fontSize: 12 }}
                      />

                      {/* <Icon
                      icon="delete"
                      size={12}
                      color="textDim"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteNotification(notification.id);
                      }}
                    /> */}
                    </Row>
                    <Row itemsCenter>
                      {notification.readAt === undefined && (
                        <div
                          style={{
                            top: 12,
                            left: 0,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: '#FF6B6B'
                          }}
                        />
                      )}

                      <Text text={notification.title} size="sm" style={{ fontWeight: 600, flex: 1 }} />
                    </Row>

                    <Text
                      text={shortDesc(notification.content, 160)}
                      wrap
                      size="xs"
                      color="textDim"
                      style={{ lineHeight: 1.5 }}
                    />
                  </Column>
                ))}
              </Column>
            )}
          </Column>
        </div>
      </Content>
    </Layout>
  );
}
