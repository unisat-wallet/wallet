import { bip32, bitcoin, networkFromName } from './bitcoin'
import { parseDescriptor } from './parse'
import { toBip32Path } from './path'
import {
  DeriveAddressOptions,
  DescriptorError,
  DescriptorScriptKind
} from './types'

interface SinglesigKeyInfo {
  kind: DescriptorScriptKind
  xpub: string
  /** Relative path after xpub before wildcard, e.g. `0` for `/0/*` */
  chainPath: string
}

/**
 * Extract singlesig xpub + chain from a limited set of descriptor shapes:
 * wpkh(...), tr(...), sh(wpkh(...)), pkh(...)
 *
 * Origin path: digits + h/' only — never `*` or hex letters (avoids /* phishing in [fpr/…]).
 */
const ORIGIN_PATH = '([0-9]+[hH\']?(?:\\/[0-9]+[hH\']?)*)'
const XPUB =
  '(xpub[1-9A-HJ-NP-Za-km-z]{79,108}|tpub[1-9A-HJ-NP-Za-km-z]{79,108})'
/** Key expression after xpub: must end with `*` for v1 ranged import/derive. */
const AFTER_XPUB = '([0-9hH/\'*]+)'

/** Non-hardened BIP32 child index must be < 2^31. */
const MAX_NON_HARDENED_INDEX = 0x80000000

/** Body with `[fpr/path]` stripped — use for /* /0/* /1/* presence checks. */
export function descriptorBodyWithoutOrigin(body: string): string {
  return body.replace(/\[[0-9a-fA-F]{8}\/[0-9]+[hH']?(?:\/[0-9]+[hH']?)*\]/g, '')
}

export function extractSinglesigKey(body: string): SinglesigKeyInfo {
  // Reject private extended keys at key boundaries (not substring of a valid xpub)
  if (/(?:^|[[(,/\s])([xtyuz]prv)/i.test(body)) {
    throw new DescriptorError(
      'Private descriptors (xprv) are not supported; use a watch-only xpub descriptor',
      'UNSUPPORTED'
    )
  }
  // Raw multipath is not a single chainPath — expand /<0;1>/* via normalizeMultipathImport first
  if (body.includes('<') || body.includes(';')) {
    throw new DescriptorError(
      'Multipath descriptors must be normalized first (use normalizeMultipathImport for /<0;1>/*, else paste /0/*)',
      'UNSUPPORTED'
    )
  }
  // SLIP-132 versions — common from Electrum/Ledger; fail with a targeted hint
  if (/(?:^|[[(,/\s])([yzuv]pub)/i.test(body)) {
    throw new DescriptorError(
      'SLIP-132 keys (ypub/zpub/upub/vpub) are not supported; convert to BIP-32 xpub/tpub',
      'UNSUPPORTED'
    )
  }
  // v1: key-path Taproot only (no script tree)
  if (body.startsWith('tr(') && body.includes(',{')) {
    throw new DescriptorError(
      'Taproot script-path descriptors are not supported in v1',
      'UNSUPPORTED'
    )
  }

  const patterns: { kind: DescriptorScriptKind; re: RegExp }[] = [
    {
      kind: 'sh-wpkh',
      re: new RegExp(
        `^sh\\(wpkh\\((?:\\[([0-9a-fA-F]{8})\\/${ORIGIN_PATH}\\])?${XPUB}(?:\\/${AFTER_XPUB})?\\)\\)$`
      )
    },
    {
      kind: 'wpkh',
      re: new RegExp(
        `^wpkh\\((?:\\[([0-9a-fA-F]{8})\\/${ORIGIN_PATH}\\])?${XPUB}(?:\\/${AFTER_XPUB})?\\)$`
      )
    },
    {
      kind: 'tr',
      re: new RegExp(
        `^tr\\((?:\\[([0-9a-fA-F]{8})\\/${ORIGIN_PATH}\\])?${XPUB}(?:\\/${AFTER_XPUB})?(?:,\\{[^)]+\\})?\\)$`
      )
    },
    {
      kind: 'pkh',
      re: new RegExp(
        `^pkh\\((?:\\[([0-9a-fA-F]{8})\\/${ORIGIN_PATH}\\])?${XPUB}(?:\\/${AFTER_XPUB})?\\)$`
      )
    }
  ]

  for (const { kind, re } of patterns) {
    const m = body.match(re)
    if (!m) continue
    const xpub = m[3]
    const rawAfter = m[4] || ''
    if (!xpub) {
      throw new DescriptorError('Could not parse xpub from descriptor', 'PARSE')
    }
    // Fail closed: fixed paths (…/0/0) must not be treated as a gap
    if (!rawAfter.endsWith('*')) {
      throw new DescriptorError(
        'Ranged descriptor required (must end with /*), e.g. wpkh(xpub…/0/*)#checksum',
        'UNSUPPORTED'
      )
    }
    const after = rawAfter.replace(/\/?\*$/, '').replace(/^\//, '')
    // Public nodes cannot harden; fail closed before bip32 throws
    if (/[hH']/.test(after)) {
      throw new DescriptorError('Hardened derivation after xpub is not supported', 'UNSUPPORTED')
    }
    // v1: only /* (chain-level), /0/* (receive), /1/* (change)
    if (after !== '' && after !== '0' && after !== '1') {
      throw new DescriptorError(
        'Only /*, /0/*, or /1/* wildcards are supported in v1',
        'UNSUPPORTED'
      )
    }
    return { kind, xpub, chainPath: after }
  }

  throw new DescriptorError(
    'Only singlesig wpkh/tr/sh(wpkh)/pkh descriptors are supported in v1',
    'UNSUPPORTED'
  )
}

function pubkeyToAddress(
  kind: DescriptorScriptKind,
  pubkey: Buffer,
  network: bitcoin.Network
): string {
  if (kind === 'wpkh') {
    const { address } = bitcoin.payments.p2wpkh({ pubkey, network })
    if (!address) throw new DescriptorError('Failed to derive wpkh address', 'DERIVE')
    return address
  }
  if (kind === 'sh-wpkh') {
    const redeem = bitcoin.payments.p2wpkh({ pubkey, network })
    const { address } = bitcoin.payments.p2sh({ redeem, network })
    if (!address) throw new DescriptorError('Failed to derive sh-wpkh address', 'DERIVE')
    return address
  }
  if (kind === 'pkh') {
    const { address } = bitcoin.payments.p2pkh({ pubkey, network })
    if (!address) throw new DescriptorError('Failed to derive pkh address', 'DERIVE')
    return address
  }
  if (kind === 'tr') {
    const { address } = bitcoin.payments.p2tr({
      internalPubkey: pubkey.subarray(1, 33),
      network
    })
    if (!address) throw new DescriptorError('Failed to derive tr address', 'DERIVE')
    return address
  }
  throw new DescriptorError(`Cannot derive addresses for kind ${kind}`, 'UNSUPPORTED')
}

function deriveChildPubkey(
  xpub: string,
  chainPath: string,
  index: number,
  network: bitcoin.Network
): Buffer {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_NON_HARDENED_INDEX) {
    throw new DescriptorError(
      `Derivation index out of range (0..${MAX_NON_HARDENED_INDEX - 1})`,
      'DERIVE'
    )
  }
  let node
  try {
    node = bip32.fromBase58(xpub, network)
  } catch {
    throw new DescriptorError(
      'Invalid xpub for the selected network (mainnet xpub vs testnet tpub mismatch?)',
      'DERIVE'
    )
  }
  if (chainPath) {
    // chainPath may be `0` or `0/1` style without wildcard
    const rel = chainPath
      .split('/')
      .filter(Boolean)
      .map((p) => p.replace(/h$/i, "'"))
      .join('/')
    if (rel.includes('*')) {
      throw new DescriptorError('Unexpected wildcard in chain path', 'PARSE')
    }
    if (rel) {
      try {
        node = node.derivePath(rel) as typeof node
      } catch {
        throw new DescriptorError('Failed to derive chain path from xpub', 'DERIVE')
      }
    }
  }
  const child = node.derive(index)
  return Buffer.from(child.publicKey)
}

/**
 * Derive receive/change addresses from a checksummed singlesig descriptor.
 */
export function deriveAddresses(
  rawDescriptor: string,
  options: DeriveAddressOptions = {}
): string[] {
  const parsed = parseDescriptor(rawDescriptor)
  // Ignore /* inside origin [fpr/…] — only the key expression after xpub counts
  if (!descriptorBodyWithoutOrigin(parsed.body).includes('/*')) {
    throw new DescriptorError(
      'Ranged descriptor required (must include /*), e.g. wpkh(xpub…/0/*)#checksum',
      'UNSUPPORTED'
    )
  }
  const { kind, xpub, chainPath } = extractSinglesigKey(parsed.body)
  const network = networkFromName(options.network ?? 'mainnet')
  const start = options.start ?? 0
  const count = options.count ?? 1
  if (!Number.isInteger(start) || start < 0) {
    throw new DescriptorError('start must be a non-negative integer', 'DERIVE')
  }
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new DescriptorError('count must be between 1 and 1000', 'DERIVE')
  }
  if (start + count > MAX_NON_HARDENED_INDEX) {
    throw new DescriptorError(
      `start+count exceeds max non-hardened index (${MAX_NON_HARDENED_INDEX - 1})`,
      'DERIVE'
    )
  }

  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const pubkey = deriveChildPubkey(xpub, chainPath, start + i, network)
    out.push(pubkeyToAddress(kind, pubkey, network))
  }
  return out
}

export function addressTypeHintFromKind(
  kind: DescriptorScriptKind
): 'P2WPKH' | 'P2TR' | 'P2SH_P2WPKH' | 'P2PKH' | 'UNKNOWN' {
  switch (kind) {
    case 'wpkh':
      return 'P2WPKH'
    case 'tr':
      return 'P2TR'
    case 'sh-wpkh':
      return 'P2SH_P2WPKH'
    case 'pkh':
      return 'P2PKH'
    default:
      return 'UNKNOWN'
  }
}

/** Re-export for callers that need path conversion when building from HD. */
export { toBip32Path }
