import { CSSProperties } from 'react';

import { BaseView, BaseViewProps } from '../BaseView';

type Align = 'start' | 'center' | 'end' | 'stretch';
type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

export interface InlineProps
  extends Omit<BaseViewProps, 'justifyCenter' | 'justifyBetween' | 'justifyEnd' | 'itemsCenter' | 'itemsEnd'> {
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
}

const $inlineStyle = {
  display: 'flex',
  flexDirection: 'row'
} as CSSProperties;

function getAlignStyle(align?: Align): CSSProperties {
  if (align === 'center') {
    return { alignItems: 'center' };
  }

  if (align === 'end') {
    return { alignItems: 'flex-end' };
  }

  if (align === 'stretch') {
    return { alignItems: 'stretch' };
  }

  return {};
}

function getJustifyStyle(justify?: Justify): CSSProperties {
  if (justify === 'center') {
    return { justifyContent: 'center' };
  }

  if (justify === 'end') {
    return { justifyContent: 'flex-end' };
  }

  if (justify === 'between') {
    return { justifyContent: 'space-between' };
  }

  if (justify === 'around') {
    return { justifyContent: 'space-around' };
  }

  if (justify === 'evenly') {
    return { justifyContent: 'space-evenly' };
  }

  return {};
}

export function Inline(props: InlineProps) {
  const { align, justify, wrap, style: $styleOverride, ...rest } = props;
  const $style = Object.assign(
    {},
    $inlineStyle,
    getAlignStyle(align),
    getJustifyStyle(justify),
    wrap ? { flexWrap: 'wrap' } : {},
    $styleOverride
  );

  return <BaseView style={$style} {...rest} />;
}
