import React from 'react';

export interface CheckboxChangeEvent {
  target: {
    checked: boolean;
  };
}

export interface CheckboxProps {
  checked?: boolean;
  onChange?: (e: any) => void;
  style?: React.CSSProperties;
  checkedColor?: string;
  checkColor?: string;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function Checkbox(props: CheckboxProps) {
  const {
    checked = false,
    onChange,
    style,
    checkedColor = '#ffde04',
    checkColor = '#141414ff',
    disabled = false,
    children,
    className,
    'data-testid': dataTestId
  } = props;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;

    onChange?.({
      target: {
        checked: e.target.checked
      }
    });
  };

  return (
    <label
      className={className}
      data-testid={dataTestId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        ...style
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '15px',
          height: '15px',
          marginRight: '8px',
          flexShrink: 0
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={handleChange}
          disabled={disabled}
          data-testid={dataTestId ? `${dataTestId}-input` : undefined}
          style={{
            appearance: 'none',
            width: '15px',
            height: '15px',
            boxSizing: 'border-box',
            backgroundColor: checked ? checkedColor : 'rgba(0, 0, 0, 0)',
            border: '1px solid rgba(255, 255, 255, 0.5)',
            borderRadius: '2px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            position: 'absolute',
            top: 0,
            left: 0,
            margin: 0
          }}
        />
        {checked && (
          <svg
            width="10"
            height="8"
            viewBox="0 0 10 8"
            fill="none"
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none'
            }}>
            <path
              d="M1.2 4.1L3.8 6.7L8.8 1.3"
              stroke={checkColor}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      {children}
    </label>
  );
}
