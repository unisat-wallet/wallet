/**
 * Sleep utility function
 * @param ms Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert hex string to base64
 * @param hex Hex string
 */
export function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(
    hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
  );
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

/**
 * Check if address is P2WPKH (native segwit, starts with bc1q or tb1q)
 */
export function isP2WPKH(address: string): boolean {
  return address.startsWith('bc1q') || address.startsWith('tb1q');
}

/**
 * Check if address is Taproot (starts with bc1p or tb1p)
 */
export function isTaproot(address: string): boolean {
  return address.startsWith('bc1p') || address.startsWith('tb1p');
}

/**
 * Check if address is a supported type (P2WPKH or Taproot)
 */
export function isSupportedAddressType(address: string): boolean {
  return isP2WPKH(address) || isTaproot(address);
}

export type BitcoinAddressNetwork = 'mainnet' | 'testnet';

/** Infer the Bitcoin network encoded by a standard SegWit or Base58 address. */
export function getBitcoinAddressNetwork(address: string): BitcoinAddressNetwork | undefined {
  if (!address || address !== address.trim()) return undefined;

  const hasLower = address !== address.toUpperCase();
  const hasUpper = address !== address.toLowerCase();
  if (hasLower && hasUpper) return undefined;

  const normalized = address.toLowerCase();
  if (/^bc1[ac-hj-np-z02-9]{11,87}$/.test(normalized)) return 'mainnet';
  if (/^tb1[ac-hj-np-z02-9]{11,87}$/.test(normalized)) return 'testnet';
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(address)) return 'mainnet';
  if (/^[mn2][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(address)) return 'testnet';
  return undefined;
}
