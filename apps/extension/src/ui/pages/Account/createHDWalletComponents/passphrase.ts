export const MAX_BIP39_PASSPHRASE_LENGTH = 1024;

export function hasBip39PassphraseWhitespace(value: string): boolean {
  return /\s/.test(value);
}

export function normalizeBip39Passphrase(value: string): string {
  return value.normalize('NFKD');
}
