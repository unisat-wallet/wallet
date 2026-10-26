export const RGB_BURN_NETWORKS = [
  { id: 42161, name: 'Arbitrum One', icon: './images/icons/artifacts/arbitrum-one.svg' },
  { id: 1, name: 'Ethereum', icon: './images/icons/artifacts/ethereum.svg' },
  { id: 137, name: 'Polygon PoS', icon: './images/icons/artifacts/polygon.svg' },
  { id: 9745, name: 'Plasma', icon: './images/icons/artifacts/plasma.svg' },
  { id: 728126428, name: 'Tron', icon: './images/icons/artifacts/tron.svg' }
] as const;

export function getRgbBurnNetworkName(destinationChainId: number) {
  return RGB_BURN_NETWORKS.find((network) => network.id === destinationChainId)?.name || String(destinationChainId);
}
