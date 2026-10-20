const ASSETS_NEW_BADGE_DISMISSED_KEY = 'assets_new_badge_dismissed_by_address_v4';

function readDismissedAddresses(): Record<string, true> {
  try {
    const raw = localStorage.getItem(ASSETS_NEW_BADGE_DISMISSED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, true>;
  } catch {
    return {};
  }
}

function writeDismissedAddresses(map: Record<string, true>): void {
  try {
    localStorage.setItem(ASSETS_NEW_BADGE_DISMISSED_KEY, JSON.stringify(map));
  } catch {
    // Badge still works for the current session when storage is unavailable.
  }
}

export function isAssetsNewBadgeDismissed(address?: string): boolean {
  if (!address) return false;
  return !!readDismissedAddresses()[address];
}

export function dismissAssetsNewBadge(address?: string): void {
  if (!address) return;
  const map = readDismissedAddresses();
  if (map[address]) return;
  map[address] = true;
  writeDismissedAddresses(map);
}
