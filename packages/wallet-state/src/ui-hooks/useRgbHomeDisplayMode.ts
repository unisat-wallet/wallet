import { ChainType } from '@unisat/wallet-types'

import { useChain } from '../hooks'

/** Temporary product switch until the dedicated RGB USDT experience launches. */
export const RgbUsdtEnabled = false

export function useRgbHomeDisplayMode(): {
  useGenericRgbCard: boolean
  canSendRgbUsdtToken: boolean
} {
  const chain = useChain()
  const canUseRgbUsdt = RgbUsdtEnabled && chain.enum === ChainType.BITCOIN_MAINNET

  return {
    useGenericRgbCard: !canUseRgbUsdt,
    canSendRgbUsdtToken: canUseRgbUsdt,
  }
}
