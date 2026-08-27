import { CSSProperties, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { Icon, Text } from '@/ui/components';

type ReviewRowProps = {
  label: string;
  value: string;
};

function ReviewRow({ label, value }: ReviewRowProps) {
  return (
    <div className="rgb-issue-review-modal-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function IssueReviewModal(props: {
  ticker: string;
  name: string;
  supply: string;
  precision: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
  t: (key: string) => string;
}) {
  const { ticker, name, supply, precision, loading, error, onClose, onConfirm, t } = props;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? 'auto' : 'none',
    transition: 'opacity 0.2s ease'
  };

  const modalStyle: CSSProperties = {
    width: '100%',
    maxWidth: 343,
    borderRadius: 12,
    backgroundColor: '#181A1F',
    padding: '20px 16px 24px',
    boxSizing: 'border-box',
    transform: visible ? 'scale(1)' : 'scale(0.96)',
    transition: 'transform 0.2s ease'
  };

  if (typeof document === 'undefined' || !document.body) {
    return null;
  }

  return createPortal(
    <div
      style={overlayStyle}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <div style={{ position: 'relative', marginBottom: 20, minHeight: 24 }}>
          <Text
            text={t('review_rgb_asset')}
            style={{ fontSize: 16, fontWeight: 500, color: '#fff', textAlign: 'center', display: 'block' }}
          />
          <div
            style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', padding: 4 }}
            onClick={handleClose}>
            <Icon icon="close" size={13} color="white" />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: error ? 12 : 24 }}>
          <ReviewRow label={t('name_label')} value={name} />
          <ReviewRow label={t('ticker_label')} value={ticker} />
          <ReviewRow label={t('total_supply')} value={supply} />
          <ReviewRow label={t('decimal_places_label')} value={precision} />
        </div>

        {error ? (
          <div className="rgb-issue-operation-error" style={{ margin: '0 0 16px' }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 14, width: '100%' }}>
          <button className="rgb-issue-review-cancel-button" type="button" disabled={loading} onClick={handleClose}>
            {t('cancel')}
          </button>
          <button
            className="rgb-issue-review-confirm-button"
            type="button"
            disabled={loading}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onConfirm();
            }}>
            {loading ? <span className="rgb-issue-loading-dot" /> : null}
            {loading ? t('loading') : t('continue_to_sign')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
