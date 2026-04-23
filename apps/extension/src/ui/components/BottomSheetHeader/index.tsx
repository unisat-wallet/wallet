import { CSSProperties } from 'react';

import { Box } from '@/ui/components/Box';
import { Icon } from '@/ui/components/Icon';
import { Stack } from '@/ui/components/Stack';
import { Text } from '@/ui/components/Text';

interface BottomSheetHeaderProps {
  title: string;
  onClose: () => void;
  inset?: number;
  height?: number;
  bottomSpacing?: number;
  closeButtonWidth?: number;
  closeIconSize?: number;
  closeIcon?: 'close' | 'sheet-close';
  dividerColor?: string;
  style?: CSSProperties;
}

const DEFAULT_INSET = 20;
const DEFAULT_HEIGHT = 60;
const DEFAULT_BOTTOM_SPACING = 20;
const DEFAULT_CLOSE_BUTTON_WIDTH = 48;
const DEFAULT_CLOSE_ICON_SIZE = 14;

// BottomSheetHeader is the default sheet header baseline.
// On web, pair it with a Stack/Column fullX body chain instead of a Box-based vertical body.
export function BottomSheetHeader({
  title,
  onClose,
  inset = DEFAULT_INSET,
  height = DEFAULT_HEIGHT,
  bottomSpacing = DEFAULT_BOTTOM_SPACING,
  closeButtonWidth = DEFAULT_CLOSE_BUTTON_WIDTH,
  closeIconSize = DEFAULT_CLOSE_ICON_SIZE,
  closeIcon = 'sheet-close',
  dividerColor = 'rgba(255,255,255,0.08)',
  style
}: BottomSheetHeaderProps) {
  return (
    <Stack fullX gap="zero" style={Object.assign({ marginBottom: bottomSpacing }, style)}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${closeButtonWidth}px minmax(0, 1fr) ${closeButtonWidth}px`,
          alignItems: 'center',
          height,
          width: '100%',
          boxSizing: 'border-box',
          paddingLeft: inset,
          paddingRight: inset
        }}>
        <div />

        <Box style={{ minWidth: 0 }}>
          <Text
            text={title}
            style={{
              display: 'block',
              width: '100%',
              fontSize: 16,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.95)',
              textAlign: 'center',
              whiteSpace: 'nowrap'
            }}
          />
        </Box>

        <Box
          onClick={onClose}
          style={{
            width: closeButtonWidth,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}>
          <Icon icon={closeIcon} size={closeIconSize} color="white" />
        </Box>
      </div>

      <Box fullX style={{ paddingLeft: inset, paddingRight: inset }}>
        <Box
          fullX
          style={{
            height: 1,
            backgroundColor: dividerColor
          }}
        />
      </Box>
    </Stack>
  );
}
