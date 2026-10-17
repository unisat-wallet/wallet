export const DEFAULT_SESSION_ICON = '/images/icons/artifacts/unknown.png';

export function formatSessionIcon(session: { origin: string; icon: string; name: string }): string {
  if (!session.icon) return DEFAULT_SESSION_ICON;

  try {
    const origin = new URL(session.origin);
    const icon = new URL(session.icon, origin);

    if (
      origin.protocol !== 'https:' ||
      icon.protocol !== 'https:' ||
      icon.origin !== origin.origin ||
      icon.username ||
      icon.password
    ) {
      return DEFAULT_SESSION_ICON;
    }

    return icon.href;
  } catch {
    return DEFAULT_SESSION_ICON;
  }
}
