import { descriptorChecksum } from './checksum'
import { descriptorBodyWithoutOrigin, extractSinglesigKey } from './derive'
import { parseDescriptor } from './parse'
import { normalizeFingerprint, toDescriptorPath } from './path'
import {
  DescriptorAddressType,
  DescriptorError,
  HdAccountDescriptorInput
} from './types'

const ORIGIN_DESC_PATH = /^[0-9]+h?(?:\/[0-9]+h?)*$/
const XPUB_AFTER =
  '(xpub[1-9A-HJ-NP-Za-km-z]{79,108}|tpub[1-9A-HJ-NP-Za-km-z]{79,108})'
/** Sparrow / BIP-389 receive+change multipath after the xpub only. */
const MULTIPATH_01 = new RegExp(`${XPUB_AFTER}/<0;1>/\\*`, 'i')

function wrapperFor(addressType: DescriptorAddressType, keyExpr: string): string {
  switch (addressType) {
    case DescriptorAddressType.P2WPKH:
      return `wpkh(${keyExpr})`
    case DescriptorAddressType.P2TR:
      return `tr(${keyExpr})`
    case DescriptorAddressType.P2SH_P2WPKH:
      return `sh(wpkh(${keyExpr}))`
    case DescriptorAddressType.P2PKH:
      return `pkh(${keyExpr})`
    default:
      throw new DescriptorError(
        `Unsupported address type for descriptor export: ${addressType}`,
        'UNSUPPORTED'
      )
  }
}

export type XpubLevel = 'account' | 'chain'

/**
 * Build a checksummed watch-only descriptor for a UniSat HD account xpub.
 * - account level (default): xpub at m/86'/0'/0' → `…xpub/0/*`
 * - chain level: xpub at m/86'/0'/0'/0 → `…xpub/*`
 */
export function hdAccountToDescriptor(
  input: HdAccountDescriptorInput & { xpubLevel?: XpubLevel }
): string {
  if (!input.xpub?.startsWith('xpub') && !input.xpub?.startsWith('tpub')) {
    throw new DescriptorError('Account xpub required (xpub/tpub)', 'UNSUPPORTED')
  }
  const level = input.xpubLevel ?? 'account'
  let suffix: string
  if (level === 'chain') {
    suffix = '/*'
  } else {
    const chain = input.chain ?? 0
    if (chain !== 0 && chain !== 1) {
      throw new DescriptorError('chain must be 0 (receive) or 1 (change)', 'UNSUPPORTED')
    }
    suffix = `/${chain}/*`
  }

  // Omit origin when fingerprint is missing/placeholder — never invent 00000000
  let keyExpr = `${input.xpub}${suffix}`
  const rawFpr = input.origin?.fingerprint?.trim()
  const path = input.origin?.path?.trim()
  if (rawFpr && path && !/^0+$/.test(rawFpr.replace(/^0x/i, ''))) {
    const fpr = normalizeFingerprint(rawFpr)
    const descPath = toDescriptorPath(path)
    if (!ORIGIN_DESC_PATH.test(descPath)) {
      throw new DescriptorError(`Invalid origin path: ${path}`, 'PARSE')
    }
    keyExpr = `[${fpr}/${descPath}]${input.xpub}${suffix}`
  }

  const body = wrapperFor(input.addressType, keyExpr)
  return `${body}#${descriptorChecksum(body)}`
}

/** Convenience: both receive and change descriptors. */
export function hdAccountToDescriptorPair(input: Omit<HdAccountDescriptorInput, 'chain'>): {
  receive: string
  change: string
} {
  return {
    receive: hdAccountToDescriptor({ ...input, chain: 0 }),
    change: hdAccountToDescriptor({ ...input, chain: 1 })
  }
}

/**
 * Expand Sparrow-style checksummed multipath `…xpub/<0;1>/*` into receive `/0/*` + change `/1/*`.
 * Returns null when the descriptor is not multipath (caller keeps the original).
 * Rejects other multipath forms (wrong order, extra branches, nested).
 */
export function normalizeMultipathImport(
  rawDescriptor: string
): { receive: string; change: string } | null {
  const parsed = parseDescriptor(rawDescriptor.trim())
  const keyBody = descriptorBodyWithoutOrigin(parsed.body)
  if (!keyBody.includes('<') && !keyBody.includes(';')) {
    return null
  }
  MULTIPATH_01.lastIndex = 0
  if (!MULTIPATH_01.test(parsed.body)) {
    throw new DescriptorError(
      'Only Sparrow-style multipath /<0;1>/* is supported; paste receive ending in /0/* or a single /<0;1>/* descriptor',
      'UNSUPPORTED'
    )
  }
  MULTIPATH_01.lastIndex = 0
  const receiveBody = parsed.body.replace(MULTIPATH_01, '$1/0/*')
  MULTIPATH_01.lastIndex = 0
  const changeBody = parsed.body.replace(MULTIPATH_01, '$1/1/*')
  if (
    receiveBody === parsed.body ||
    changeBody === parsed.body ||
    receiveBody.includes('<') ||
    receiveBody.includes(';') ||
    changeBody.includes('<') ||
    changeBody.includes(';')
  ) {
    throw new DescriptorError(
      'Only Sparrow-style multipath /<0;1>/* is supported; paste receive ending in /0/* or a single /<0;1>/* descriptor',
      'UNSUPPORTED'
    )
  }
  return {
    receive: `${receiveBody}#${descriptorChecksum(receiveBody)}`,
    change: `${changeBody}#${descriptorChecksum(changeBody)}`,
  }
}

/**
 * From a checksummed receive descriptor ending in `/0/*`, build the sibling `/1/*` change descriptor.
 * Returns undefined if the input is not a standard receive wildcard shape.
 * Only rewrites the key-expression `/0/*` after the xpub — never an origin path.
 */
export function siblingChangeDescriptor(receiveDescriptor: string): string | undefined {
  const parsed = parseDescriptor(receiveDescriptor)
  if (!descriptorBodyWithoutOrigin(parsed.body).includes('/0/*')) return undefined
  let keyInfo
  try {
    keyInfo = extractSinglesigKey(parsed.body)
  } catch {
    return undefined
  }
  if (keyInfo.chainPath !== '0') return undefined
  const changeBody = parsed.body.replace(
    new RegExp(`${XPUB_AFTER}/0/\\*`, 'i'),
    '$1/1/*'
  )
  if (changeBody === parsed.body) return undefined
  return `${changeBody}#${descriptorChecksum(changeBody)}`
}
