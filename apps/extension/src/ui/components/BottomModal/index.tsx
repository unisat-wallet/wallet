import React, { CSSProperties, useEffect, useState } from 'react';

interface BottomModalProps {
  children: React.ReactNode;
  onClose?: () => void;
  bodyStyle?: CSSProperties;
}

export const BottomModal = ({ children, onClose, bodyStyle }: BottomModalProps) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    if (!onClose) return;

    setIsVisible(false);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const resolvedBodyStyle = Object.assign(
    {
      width: '100%',
      padding: 20,
      boxSizing: 'border-box'
    } as CSSProperties,
    bodyStyle
  );

  return (
    <div
      className="popover-container"
      style={{
        backgroundColor: 'rgba(0,0,0,0.7)',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-end',
        transition: 'background-color 0.3s ease',
        opacity: isVisible ? 1 : 0
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          handleClose();
        }
      }}>
      <div
        style={{
          backgroundColor: '#181A1F',
          width: '100%',
          borderRadius: '15px 15px 0 0',
          position: 'fixed',
          bottom: 0,
          transform: isVisible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s ease-out',
          overflow: 'hidden'
        }}>
        <div style={resolvedBodyStyle}>{children}</div>
      </div>
    </div>
  );
};
