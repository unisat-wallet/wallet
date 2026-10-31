const RGB_BACKUP_NETWORK_LABELS: Record<string, string> = {
  mainnet: 'Bitcoin Mainnet',
  testnet: 'Bitcoin Testnet',
  testnet4: 'Bitcoin Testnet4',
  signet: 'Bitcoin Signet',
  'fractal-mainnet': 'Fractal Bitcoin Mainnet',
  'fractal-test': 'Fractal Bitcoin Testnet'
};

export function getRgbBackupNetworkLabel(network: string): string {
  return RGB_BACKUP_NETWORK_LABELS[network] || network;
}
