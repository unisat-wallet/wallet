import { colors } from '@/ui/theme/colors';
import { $baseContainerStyle, $baseInputStyle, $baseTextareaStyle, InputProps } from '.';

export function TextInput(props: InputProps) {
  const {
    placeholder,
    containerStyle,
    style: $inputStyleOverride,
    disabled,
    autoFocus,
    maxLength,
    rows,
    ...rest
  } = props;
  // Multiline for long pastes (e.g. BIP-380 descriptors); single-line input truncates UX.
  if (typeof rows === 'number' && rows > 1) {
    return (
      <div
        style={Object.assign({}, $baseContainerStyle, { alignItems: 'flex-start' }, containerStyle)}>
        <textarea
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          maxLength={maxLength}
          rows={rows}
          style={Object.assign(
            {},
            $baseTextareaStyle,
            $inputStyleOverride,
            disabled ? { color: colors.textDim } : {}
          )}
          {...rest}
        />
      </div>
    );
  }
  return (
    <div style={Object.assign({}, $baseContainerStyle, containerStyle)}>
      <input
        placeholder={placeholder}
        type={'text'}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={maxLength}
        style={Object.assign({}, $baseInputStyle, $inputStyleOverride, disabled ? { color: colors.textDim } : {})}
        {...rest}
      />
    </div>
  );
}
