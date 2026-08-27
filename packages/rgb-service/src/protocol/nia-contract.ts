import { sha256 } from '@noble/hashes/sha256'
import { RgbServiceError } from '../errors'
import {
  serializeRgbTransferPrefix,
  wrapRgbTransferConsignment,
  type RgbTransferTerminal,
} from './consignment'
import type { EncodedNiaGenesis } from './nia-genesis'

const NIA_SCHEMA = [
  'AAASTm9uSW5mbGF0YWJsZUFzc2V0AAPQB9f8vuMe8KhdX5c72hsLjJ5++8vFVyV3OCys0720IYoBAQAABHNwZWPRB1uLx1Q4MgVKHSK+lCJr51OLEzomiBy6',
  'RhMCeHjgXGz3AQAABXRlcm1z2geIjFhlYzrxO5W3zRqNivLawdwUC5dyUdnU2vPHURyOhAEAAAxpc3N1ZWRTdXBwbHkBoA8BCAphc3NldE93bmVyECcAA9AH',
  'AQABANEHAQABANoHAQABAAGgDwEA//8Bq/CZ0ovtUN9eBlcVMn86mzKfd3ywuf7/9jTBk6A8tiYJAAEQJwAAAaAPAQD//wGgDwEA//8Bq/CZ0ovtUN9eBlcV',
  'Mn86mzKfd3ywuf7/9jTBk6A8tiYAAAh0cmFuc2ZlcgGgDw==',
].join('')

// These are the strict-encoded NIA Schema dependencies emitted by
// rgb-schemas 0.11.1-rc.10 after ContractBuilder retains only used scripts.
const NIA_TYPE_SYSTEM = [
  'IwAACvZf1iWB3oXL0U4j4tuakrvvi3l0/+G1DEx024+G51EIX14m5cUFPBtFRFFbxqBlPaAqB5H7MRFtcaT62RbhU1UAAAAAAAAAAAcAAAAAAAAAGMuUbxKT',
  'zxgOnXjcxlvFm0cv//6t+/WNsZjMgyj2SwEFAVYNlvekeSSyw98EDmRjOY/WX9WRZSwpQ0K/pfk5FVFUHKu/w9gmwL/R6XcKiJ76zItnFq0BSj7sELZZFTAi',
  'kEIAQBywdY4UwgCMDwCM5tLUHp4ZN+HND5kUxZp+KeHOe6C7BQHMwnKSj3k4A9kfXa2NUcyYa0MyOA+SJPfHwVFNdo67kCpbqqxQif8JjRULSCz+2LzQGpHA',
  '17RdMiFu1XarcevdBxyrv8PYJsC/0el3Coie+syLZxatAUo+7BC2WRUwIpBCIAAv2PJ6FycSkD5qPpbw+FwEgLQhGhes0TBZ/FHUpLveLAQCAARub25l2D++',
  '4C8N5bRs+A/hHvf98GHHjZddMa3p7qK8QJkznmwBBHNvbWWwcNOP9tIMWuXYBxXKMVQdWlK73svTUp045t22ciAJlzzRop3MrZuReyYwX4mopPshGDAqTnPF',
  'rAp4DearAF5zAy0EZXhjbCEEaGFzaCMGZG9sbGFyJANhbXAmBHBsdXMrBGRhc2gtA2RvdC4EemVybzADb25lMQN0d28yBXRocmVlMwRmb3VyNARmaXZlNQNz',
  'aXg2BXNldmVuNwVlaWdodDgEbmluZTkFY2FyZXReBmxvZGFzaF8BYWEBYmIBY2MBZGQBZWUBZmYBZ2cBaGgBaWkBamoBa2sBbGwBbW0Bbm4Bb28BcHABcXEB',
  'cnIBc3MBdHQBdXUBdnYBd3cBeHgBeXkBeno/K3K3xK8aYwy20/8Ii681EJPuRluefUcqYQCC5EnX5AUBY6ojFOixR8iyhN+zmp4Q0Zyq1frqhI48uYSdkWfW',
  'NEpDqn/F9vVkT+Wirl4aqZBCzeuHlELjTHI/9YJ/sTPeigYCBHR5cGWxDd7+gCCt2KDKCCkhUKuxPFFNdt5RaMHJcQWifmdmYAZkaWdlc3QqW6qsUIn/CY0V',
  'C0gs/ti80BqRwNe0XTIhbtV2q3Hr3UW3gCWGAcUmsjtbSGFGCpBQ4T81+76DBagAEVfkATiIBAIABG5vbmXYP77gLw3ltGz4D+Ee9/3wYceNl10xrenuorxA',
  'mTOebAEEc29tZcr/j66zigCgTjYhU4+OYddahaRlywoOSMNZPn6qbF/HSL4jFyrohEWa54M0oAY/CfoOMXvqiyM854KjiHXnlrgDXwVzcGFjZSAEZXhjbCEG',
  'cXVvdGVzIgRoYXNoIwZkb2xsYXIkB3BlcmNlbnQlCWFtcGVyc2FuZCYKYXBvc3Ryb3BoZScIYnJhY2tldEwoCGJyYWNrZXRSKQhhc3RlcmlzayoEcGx1cysF',
  'Y29tbWEsBW1pbnVzLQNkb3QuBXNsYXNoLwR6ZXJvMANvbmUxA3R3bzIFdGhyZWUzBGZvdXI0BGZpdmU1A3NpeDYFc2V2ZW43BWVpZ2h0OARuaW5lOQVjb2xv',
  'bjoJc2VtaUNvbG9uOwRsZXNzPAVlcXVhbD0HZ3JlYXRlcj4IcXVlc3Rpb24/AmF0QAJfQUECX0JCAl9DQwJfREQCX0VFAl9GRgJfR0cCX0hIAl9JSQJfSkoC',
  'X0tLAl9MTAJfTU0CX05OAl9PTwJfUFACX1FRAl9SUgJfU1MCX1RUAl9VVQJfVlYCX1dXAl9YWAJfWVkCX1paCnNxQnJhY2tldExbCWJhY2tTbGFzaFwKc3FC',
  'cmFja2V0Ul0FY2FyZXReBmxvZGFzaF8IYmFja3RpY2tgAWFhAWJiAWNjAWRkAWVlAWZmAWdnAWhoAWlpAWpqAWtrAWxsAW1tAW5uAW9vAXBwAXFxAXJyAXNz',
  'AXR0AXV1AXZ2AXd3AXh4AXl5AXp6CWNCcmFja2V0THsEcGlwZXwJY0JyYWNrZXRSfQV0aWxkZX5WDZb3pHkkssPfBA5kYzmP1l/VkWUsKUNCv6X5ORVRVAj7',
  'qVhyGj0zVAazaMNvWoJ5CWDM4jn+vK/hibqYOdXaeAAAAAAAAAAA//8AAAAAAABbdyyOsV/XRwDHkkH2D4/aN+c2s/1GKrAXzk1FTvqBqgUBXl7Ikk9zzXLE',
  'IlyWq0d5ZljvG3KcowbiYLykKyWJHQ9bi8dUODIFSh0ivpQia+dTixM6JogcukYTAnh44Fxs9wYCBHRleHQYy5RvEpPPGA6deNzGW8WbRy///q379Y2xmMyD',
  'KPZLAQVtZWRpYeCHqDSWM4eZr8SKkhFoOkJ9K9M+LqfruKi4gOpKtOuBXKFJWF3lNO6Rs+OgMLfv1M23mr6pFS8QHzdZtMchDh8ACF0DxBeNqY5+PzrzQ+OZ',
  'fXQgHRH0JzLPvqKwS44/8V8iAxMLaW5kaXZpc2libGUABGRlY2kBBWNlbnRpAgVtaWxsaQMJZGVjaU1pbGxpBApjZW50aU1pbGxpBQVtaWNybwYJZGVjaU1p',
  'Y3JvBwpjZW50aU1pY3JvCARuYW5vCQhkZWNpTmFubwoJY2VudGlOYW5vCwRwaWNvDAhkZWNpUGljbw0JY2VudGlQaWNvDgVmZW10bw8JZGVjaUZlbXRvEApj',
  'ZW50aUZlbXRvEQRhdHRvEl5eyJJPc81yxCJclqtHeWZY7xtynKMG4mC8pCsliR0PBQKCI4D0dfDttLXcUXmR3nOQraLbs3UsTAZoUaoBYwKWwgr2X9Ylgd6F',
  'y9FOI+LbmpK774t5dP/htQxMdNuPhudRX14m5cUFPBtFRFFbxqBlPaAqB5H7MRFtcaT62RbhU1UDPgR6ZXJvMANvbmUxA3R3bzIFdGhyZWUzBGZvdXI0BGZp',
  'dmU1A3NpeDYFc2V2ZW43BWVpZ2h0OARuaW5lOQJfQUECX0JCAl9DQwJfREQCX0VFAl9GRgJfR0cCX0hIAl9JSQJfSkoCX0tLAl9MTAJfTU0CX05OAl9PTwJf',
  'UFACX1FRAl9SUgJfU1MCX1RUAl9VVQJfVlYCX1dXAl9YWAJfWVkCX1paAWFhAWJiAWNjAWRkAWVlAWZmAWdnAWhoAWlpAWpqAWtrAWxsAW1tAW5uAW9vAXBw',
  'AXFxAXJyAXNzAXR0AXV1AXZ2AXd3AXh4AXl5AXp6Y6ojFOixR8iyhN+zmp4Q0Zyq1frqhI48uYSdkWfWNEoI+6lYcho9M1QGs2jDb1qCeQlgzOI5/ryv4Ym6',
  'mDnV2ngBAAAAAAAAAP8AAAAAAAAAgF7FvFMSyEGQRF2haqHAignjAOgyOs+uaiNCCimtAD0FAcQ6fZ65swJ5c8mPXdbhrAT1y9NCQMC+vAoPuAgUAJTUgiOA',
  '9HXw7bS13FF5kd5zkK2i27N1LEwGaFGqAWMClsIDNAJfQUECX0JCAl9DQwJfREQCX0VFAl9GRgJfR0cCX0hIAl9JSQJfSkoCX0tLAl9MTAJfTU0CX05OAl9P',
  'TwJfUFACX1FRAl9SUgJfU1MCX1RUAl9VVQJfVlYCX1dXAl9YWAJfWVkCX1paAWFhAWJiAWNjAWRkAWVlAWZmAWdnAWhoAWlpAWpqAWtrAWxsAW1tAW5uAW9v',
  'AXBwAXFxAXJyAXNzAXR0AXV1AXZ2AXd3AXh4AXl5AXp6iIxYZWM68TuVt80ajYry2sHcFAuXclHZ1Nrzx1EcjoQFAVyhSVhd5TTukbPjoDC379TNt5q+qRUv',
  'EB83WbTHIQ4fsHDTj/bSDFrl2AcVyjFUHVpSu97L01KdOObdtnIgCZcFARywdY4UwgCMDwCM5tLUHp4ZN+HND5kUxZp+KeHOe6C7sQ3e/oAgrdigyggpIVCr',
  'sTxRTXbeUWjByXEFon5nZmAGAwR0eXBlHLB1jhTCAIwPAIzm0tQenhk34c0PmRTFmn4p4c57oLsHc3VidHlwZS/Y8noXJxKQPmo+lvD4XASAtCEaF6zRMFn8',
  'UdSku94sB2NoYXJzZXQv2PJ6FycSkD5qPpbw+FwEgLQhGhes0TBZ/FHUpLveLL+Py+nFOVcxprTNYfsA3+el1ik2UznFWurgh6O5CqpGCDzRop3MrZuReyYw',
  'X4mopPshGDAqTnPFrAp4DearAF5zAAAAAAAAAAA/AAAAAAAAAMQ6fZ65swJ5c8mPXdbhrAT1y9NCQMC+vAoPuAgUAJTUBQJIviMXKuiERZrngzSgBj8J+g4x',
  'e+qLIzzngqOIdeeWuPWtFyFEzNLdYuznT/D7FGQdk2qAwaDJPr+XcnGEiXy8yv+PrrOKAKBONiFTj45h11qFpGXLCg5Iw1k+fqpsX8cFAT8rcrfErxpjDLbT',
  '/wiLrzUQk+5GW559RyphAILkSdfkzMJyko95OAPZH12tjVHMmGtDMjgPkiT3x8FRTXaOu5AFAvkXCATdrgR5+NWvdKs70gLm6kFy2am5NwcVGtt/xAyhv4/L',
  '6cU5VzGmtM1h+wDf56XWKTZTOcVa6uCHo7kKqkbX/L7jHvCoXV+XO9obC4yefvvLxVcldzgsrNO9tCGKAQYEBnRpY2tlclt3LI6xX9dHAMeSQfYPj9o35zaz',
  '/UYqsBfOTUVO+oGqBG5hbWWAXsW8UxLIQZBEXaFqocCKCeMA6DI6z65qI0IKKa0APQdkZXRhaWxzRbeAJYYBxSayO1tIYUYKkFDhPzX7voMFqAARV+QBOIgJ',
  'cHJlY2lzaW9uXQPEF42pjn4/OvND45l9dCAdEfQnMs++orBLjj/xXyLYP77gLw3ltGz4D+Ee9/3wYceNl10xrenuorxAmTOebAAA3B4vUlZ/cl/XMK2Ehn8N',
  'pMm6mvCBMxHf5O8+PEphJUgFAUOqf8X29WRP5aKuXhqpkELN64eUQuNMcj/1gn+xM96K4IeoNJYzh5mvxIqSEWg6Qn0r0z4up+u4qLiA6kq064EEAgAEbm9u',
  'Zdg/vuAvDeW0bPgP4R73/fBhx42XXTGt6e6ivECZM55sAQRzb21l3B4vUlZ/cl/XMK2Ehn8NpMm6mvCBMxHf5O8+PEphJUj1rRchRMzS3WLs50/w+xRkHZNq',
  'gMGgyT6/l3JxhIl8vAhIviMXKuiERZrngzSgBj8J+g4xe+qLIzzngqOIdeeWuAAAAAAAAAAAJwAAAAAAAAD5FwgE3a4EefjVr3SrO9IC5upBctmpuTcHFRrb',
  'f8QMoQMaAWFhAWJiAWNjAWRkAWVlAWZmAWdnAWhoAWlpAWpqAWtrAWxsAW1tAW5uAW9vAXBwAXFxAXJyAXNzAXR0AXV1AXZ2AXd3AXh4AXl5AXp6+6lYcho9',
  'M1QGs2jDb1qCeQlgzOI5/ryv4Ym6mDnV2ngB',
].join('')

const NIA_SCRIPTS = [
  'AQADA0FMVQhCUERJR0VTVANSR0IhAAsAAADQoA8BBwsAAQALCAAACwECAMjaBwE5MADRoA8BBwQAAAEAAAA=',
].join('')

function bytesFromBase64(value: string) {
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(value, 'base64'))
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

/** Static Schema, TypeSystem and script tail shared by standard NIA consignments. */
export function niaConsignmentTail() {
  return concat(
    bytesFromBase64(NIA_SCHEMA),
    bytesFromBase64(NIA_TYPE_SYSTEM),
    bytesFromBase64(NIA_SCRIPTS)
  )
}

export interface EncodedNiaContract {
  /** Strict-encoded RGB Contract (a non-transfer Consignment). */
  strict: Uint8Array
  /** NIA contract ID, equal to the Genesis operation ID. */
  assetId: Uint8Array
  genesis: Uint8Array
}

/**
 * Wrap a locally encoded NIA Genesis in the complete RGB contract container.
 * Schema, types and scripts are consensus bytes from the pinned RGB schema
 * release; they are not supplied by a backend.
 */
export function encodeNiaContract(genesis: EncodedNiaGenesis): EncodedNiaContract {
  if (genesis.strict.length < 34 || genesis.assetId.length !== 32) {
    throw new RgbServiceError('NIA Genesis is invalid for contract encoding')
  }

  const strict = concat(
    // ContainerVer::V0, transfer=false, empty terminals SmallOrdMap.
    Uint8Array.from([0, 0, 0, 0]),
    genesis.strict,
    // Empty LargeVec<WitnessBundle>.
    new Uint8Array(4),
    niaConsignmentTail()
  )
  return {
    strict,
    assetId: Uint8Array.from(genesis.assetId),
    genesis: Uint8Array.from(genesis.strict),
  }
}

/** Build a transfer Consignment around the locally known NIA contract. */
export function encodeNiaTransferConsignment(input: {
  genesis: Pick<EncodedNiaGenesis, 'strict'>
  witnessBundle: Uint8Array
  /** Already validated ancestor bundles, ordered from root to leaf. */
  priorWitnessBundles?: Uint8Array[]
  terminals: RgbTransferTerminal[]
}) {
  if (!input.witnessBundle.length)
    throw new RgbServiceError('RGB transfer requires a WitnessBundle')
  const witnessBundles = [...(input.priorWitnessBundles || []), input.witnessBundle]
  if (witnessBundles.length > 0xffff_ffff)
    throw new RgbServiceError('RGB transfer has too many WitnessBundles')
  if (witnessBundles.some(bundle => !bundle.length))
    throw new RgbServiceError('RGB transfer history has an empty WitnessBundle')
  const count = witnessBundles.length
  const body = concat(
    serializeRgbTransferPrefix(input.terminals),
    input.genesis.strict,
    Uint8Array.from([
      count & 0xff,
      (count >>> 8) & 0xff,
      (count >>> 16) & 0xff,
      (count >>> 24) & 0xff,
    ]),
    ...witnessBundles,
    niaConsignmentTail()
  )
  return wrapRgbTransferConsignment(body)
}

/** Stable byte-level fingerprint for regression vectors and transport IDs. */
export function niaContractDigest(contract: Uint8Array) {
  return sha256(contract)
}
