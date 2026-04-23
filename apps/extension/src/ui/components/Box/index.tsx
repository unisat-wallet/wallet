import { CSSProperties } from 'react';

import { BaseView, BaseViewProps } from '../BaseView';

type Align = 'start' | 'center' | 'end' | 'stretch';
type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

export interface BoxProps
  extends Omit<BaseViewProps, 'justifyCenter' | 'justifyBetween' | 'justifyEnd' | 'itemsCenter' | 'itemsEnd'> {
  align?: Align;
  justify?: Justify;
}

const $boxStyle = {
  display: 'flex'
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

export function Box(props: BoxProps) {
  const { align, justify, style: $styleOverride, ...rest } = props;
  const $style = Object.assign({}, $boxStyle, getAlignStyle(align), getJustifyStyle(justify), $styleOverride);

  return <BaseView style={$style} {...rest} />;
}
