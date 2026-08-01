import { CSSProperties, memo, useMemo } from 'react';

export type IframeProps = { preview: string; style?: CSSProperties; ref: any; onLoad?: () => void };

const Iframe = ({ preview, style, ref, onLoad }: IframeProps) => {
  return useMemo(
    () => (
      <iframe
        onClick={(e) => e.preventDefault()}
        ref={ref}
        style={Object.assign({}, { pointerEvents: 'none' }, style)}
        src={preview}
        onLoad={onLoad}
        // Scripts allowed for HTML inscriptions; same-origin removed to reduce sandbox escape risk.
        sandbox="allow-scripts"
        scrolling="no"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    ),
    [preview]
  );
};

export default memo(Iframe, (p, n) => {
  return p.preview === n.preview;
});
