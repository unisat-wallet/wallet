const SAFE_WINDOW_FEATURES = 'noopener,noreferrer';

function resolveSafeInternalUrl(url: string): string | null {
  if (!/^(?:#\/(?!\/)|\/(?!\/)|\.\.?\/)/.test(url)) return null;

  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin ? parsed.href : null;
  } catch {
    return null;
  }
}

export function resolveSafeOpenUrl(rawUrl: string): string | null {
  if (typeof rawUrl !== 'string') return null;

  const url = rawUrl.trim();
  if (!url) return null;

  const internalUrl = resolveSafeInternalUrl(url);
  if (internalUrl) return internalUrl;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function openSafeUrl(rawUrl: string): boolean {
  const url = resolveSafeOpenUrl(rawUrl);
  if (!url) return false;

  window.open(url, '_blank', SAFE_WINDOW_FEATURES);
  return true;
}
