import { Card, Column, Row, Text } from '@/ui/components';
import { CloseOutlined } from '@ant-design/icons';
import { AnnouncementLinkType } from '@unisat/wallet-shared';
import { useAnnouncementCardLogic, useI18n } from '@unisat/wallet-state';

const CARD_HEIGHT = 130;

export function AnnouncementCard() {
  const { t } = useI18n();
  const { loading, validAnnouncements, current, activeIndex, handleDotClick, handleDismissAll, isLinkable } =
    useAnnouncementCardLogic();

  const handleViewDetails = () => {
    if (!current || !isLinkable(current)) return;
    switch (current.linkType) {
      case AnnouncementLinkType.EXTERNAL_LINK:
      case AnnouncementLinkType.INTERNAL_LINK:
        window.open(current.link);
        break;
      default:
        break;
    }
  };

  if (loading || validAnnouncements.length === 0) return null;

  return (
    <Column
      style={{
        position: 'relative',
        borderRadius: 12,
        border: '1px solid #2C2C2C',
        background: '#1A1A1A',
        padding: 12,
        gap: 8,
        height: CARD_HEIGHT,
        overflow: 'hidden'
      }}>
      {/* Close button */}
      <div
        onClick={handleDismissAll}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 20,
          height: 20,
          borderRadius: 10,
          background: '#828282',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 10
        }}>
        <CloseOutlined style={{ fontSize: 10, color: '#000' }} />
      </div>

      {/* Header badge */}
      <Row
        style={{
          display: 'inline-flex',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: 20,
          padding: '2px 8px',
          alignSelf: 'flex-start'
        }}>
        <Text text={`📣 ${t('announcement')}`} size="xs" />
      </Row>

      {/* Title & description */}
      <Column style={{ flex: 1, overflow: 'hidden', gap: 4 }}>
        <Text
          text={current.title}
          size="sm"
          style={{
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            paddingRight: 24
          }}
        />
        <Text
          text={current.description}
          size="xs"
          color="textDim"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        />
      </Column>

      {/* Footer: dots + view detail */}
      <Row justifyBetween itemsCenter style={{ marginTop: 'auto' }}>
        <Row style={{ gap: 4 }}>
          {validAnnouncements.length > 1 &&
            validAnnouncements.map((_, i) => (
              <div
                key={i}
                onClick={() => handleDotClick(i)}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: i === activeIndex ? '#F7931A' : 'rgba(255,255,255,0.3)',
                  cursor: 'pointer'
                }}
              />
            ))}
        </Row>

        {isLinkable(current) && (
          <Card
            preset="style2"
            style={{ height: 28, backgroundColor: 'rgba(255, 255, 255, 0.1)' }}
            fullX
            onClick={() => {
              handleViewDetails();
            }}
            data-testid="wallet-management-entry">
            <Text text={t('view_detail')} size="xxs" ellipsis />
          </Card>
        )}
      </Row>
    </Column>
  );
}
