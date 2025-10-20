import { keyBy } from 'lodash'
import { AddressFlagType, CHAINS, CHAINS_MAP, ChainType, NETWORK_TYPES } from '../constants'

declare global {
  const langLocales: Record<string, Record<'message', string>>
}

// Simple translation function placeholder
const t = (name: string) => name

const format = (str: string, ...args: any[]) => {
  return args.reduce((m, n) => m.replace('_s_', n), str)
}

export { format, t }

const chainsDict = keyBy(CHAINS, 'serverId')
export const getChain = (chainId?: string) => {
  if (!chainId) {
    return null
  }
  return chainsDict[chainId]
}

// Check if address flag is enabled
export const checkAddressFlag = (currentFlag: number, flag: AddressFlagType): boolean => {
  return Boolean(currentFlag & flag)
}

export function getChainInfo(chainType: ChainType) {
  const chain = CHAINS_MAP[chainType]
  return {
    enum: chainType,
    name: chain.label,
    network: NETWORK_TYPES[chain.networkType].name,
  }
}

export const objToUint8Array = (obj: any) => {
  const arr: number[] = []
  for (const id in obj) {
    arr[parseInt(id)] = obj[id]
  }
  return Uint8Array.from(arr)
}
