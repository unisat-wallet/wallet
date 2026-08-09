import { verifyDescriptorChecksum } from './checksum'
import {
  DescriptorError,
  DescriptorScriptKind,
  ParsedDescriptor,
  PolicySummary
} from './types'

function detectKind(body: string): DescriptorScriptKind {
  const b = body.trim()
  if (b.startsWith('tr(')) return 'tr'
  if (b.startsWith('wpkh(')) return 'wpkh'
  if (b.startsWith('wsh(')) return 'wsh'
  if (b.startsWith('sh(wpkh(')) return 'sh-wpkh'
  if (b.startsWith('sh(')) return 'sh'
  if (b.startsWith('pkh(')) return 'pkh'
  return 'unknown'
}

function policyFor(kind: DescriptorScriptKind, body: string): PolicySummary {
  const complex =
    kind === 'wsh' ||
    body.includes('multi(') ||
    body.includes('multi_a(') ||
    body.includes('sortedmulti') ||
    body.includes('thresh(') ||
    body.includes('older(') ||
    body.includes('after(')

  // Plain-language script type (avoid Miniscript “policy” jargon for singlesig)
  const labels: Record<DescriptorScriptKind, string> = {
    tr: complex ? 'Script: Taproot (script paths)' : 'Script: Taproot (single key)',
    wpkh: 'Script: Native SegWit (single key)',
    'sh-wpkh': 'Script: Nested SegWit (single key)',
    wsh: 'Script: SegWit (multisig / miniscript)',
    sh: 'Script: Legacy P2SH',
    pkh: 'Script: Legacy P2PKH',
    unknown: 'Script: Unknown'
  }

  return {
    label: labels[kind],
    kind,
    isComplex: complex
  }
}

/**
 * Validate BIP-380 checksum and return a lightweight parse (kind + policy label).
 * Address derivation is `deriveAddresses` / `extractSinglesigKey`.
 */
export function parseDescriptor(raw: string): ParsedDescriptor {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new DescriptorError('Descriptor is empty', 'EMPTY')
  }
  // Checksum is exactly 8 chars after a final '#'; reject other '#' placements.
  if (trimmed.length < 10 || trimmed[trimmed.length - 9] !== '#') {
    throw new DescriptorError('Descriptor missing #checksum', 'MISSING_CHECKSUM')
  }
  if (!verifyDescriptorChecksum(trimmed)) {
    throw new DescriptorError('Descriptor checksum invalid', 'INVALID_CHECKSUM')
  }
  const hash = trimmed.length - 9
  const body = trimmed.slice(0, hash)
  const checksum = trimmed.slice(hash + 1)
  const kind = detectKind(body)
  return {
    raw: trimmed,
    body,
    checksum,
    kind,
    policy: policyFor(kind, body)
  }
}
