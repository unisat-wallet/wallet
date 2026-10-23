import { DEFAULT_SESSION_ICON, formatSessionIcon } from './sessionIcon';

const session = (icon: string, origin = 'https://dapp.example') => ({ origin, icon, name: 'dApp' });

describe('formatSessionIcon', () => {
  it('accepts HTTPS icons on the dApp origin', () => {
    expect(formatSessionIcon(session('/favicon.ico'))).toBe('https://dapp.example/favicon.ico');
    expect(formatSessionIcon(session('favicon.ico'))).toBe('https://dapp.example/favicon.ico');
    expect(formatSessionIcon(session('https://dapp.example/icon.png'))).toBe('https://dapp.example/icon.png');
  });

  it('accepts HTTPS icons hosted on a separate CDN', () => {
    const icon = 'https://next-cdn.unisat.space/_/web-v3576/img/favicon.ico';
    expect(formatSessionIcon(session(icon, 'https://unisat.io'))).toBe(icon);
    expect(formatSessionIcon(session(icon, 'https://other.example'))).toBe(icon);
    expect(formatSessionIcon(session('//cdn.example/icon.png'))).toBe('https://cdn.example/icon.png');
  });

  it.each([
    '',
    'https://dapp.example@other.example/icon.png',
    'http://dapp.example/icon.png',
    'http://other.example/icon.png',
    'data:image/svg+xml,<svg/>',
    'javascript:alert(1)',
    'https://user:pass@dapp.example/icon.png',
    'https://[bad'
  ])('uses a local icon for an untrusted URL: %s', (icon) => {
    expect(formatSessionIcon(session(icon))).toBe(DEFAULT_SESSION_ICON);
  });

  it('uses a local icon for a non-HTTPS dApp origin', () => {
    expect(formatSessionIcon(session('/favicon.ico', 'http://localhost:3000'))).toBe(DEFAULT_SESSION_ICON);
  });
});
