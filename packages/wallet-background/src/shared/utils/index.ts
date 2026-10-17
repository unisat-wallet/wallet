import { keyBy } from 'lodash'
import {
  AddressFlagType,
  CHAINS,
  CHAINS_MAP,
  NETWORK_TYPES,
  hasOwn,
  isSupportedChainType,
  objToUint8Array,
} from '@unisat/wallet-shared'
import { ChainType } from '@unisat/wallet-types'

export { objToUint8Array }

declare global {
  const langLocales: Record<string, Record<'message', string>>
}

const format = (str: string, ...args: any[]) => {
  return args.reduce((m, n) => m.replace('_s_', n), str)
}

export { format }

const chainsDict = keyBy(CHAINS, 'serverId')
export const getChain = (chainId?: string) => {
  if (!chainId || !hasOwn(chainsDict, chainId)) {
    return null
  }
  return chainsDict[chainId]
}

// Check if address flag is enabled
export const checkAddressFlag = (currentFlag: number, flag: AddressFlagType): boolean => {
  return Boolean(currentFlag & flag)
}

export function getChainInfo(chainType: ChainType) {
  if (!isSupportedChainType(chainType)) {
    throw new Error(`Unsupported chain type: ${String(chainType)}`)
  }
  const chain = CHAINS_MAP[chainType]!
  return {
    enum: chainType,
    name: chain.label,
    network: NETWORK_TYPES[chain.networkType]!.name,
  }
}
