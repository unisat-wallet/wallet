export type DescriptorNetwork = 'mainnet' | 'testnet' | 'signet' | 'regtest'

/** High-level script family for UI policy chips */
export type DescriptorScriptKind =
  | 'wpkh'
  | 'sh-wpkh'
  | 'tr'
  | 'wsh'
  | 'sh'
  | 'pkh'
  | 'unknown'

/**
 * UniSat AddressType subset supported for descriptor export/derive (v1).
 * Numeric values match `@unisat/wallet-types` AddressType.
 */
export enum DescriptorAddressType {
  P2PKH = 0,
  P2WPKH = 1,
  P2TR = 2,
  P2SH_P2WPKH = 3
}

export interface PolicySummary {
  /** Short label for UI, e.g. "Taproot single key" */
  label: string
  kind: DescriptorScriptKind
  /** True if more than one key or a miniscript threshold/timelock is present */
  isComplex: boolean
}

export interface ParsedDescriptor {
  /** Full input including checksum */
  raw: string
  /** Descriptor without #checksum */
  body: string
  checksum: string
  kind: DescriptorScriptKind
  policy: PolicySummary
}

export interface KeyOrigin {
  /** 8 hex chars (4-byte master fingerprint), no 0x */
  fingerprint: string
  /**
   * Hardened account path using `h` or `'`, with or without leading `m/`.
   * Example: `86h/0h/0h` or `m/86'/0'/0'`
   */
  path: string
}

export interface HdAccountDescriptorInput {
  addressType: DescriptorAddressType
  /**
   * Key origin. Omit or leave fingerprint empty/zero to export without `[fpr/path]`
   * (preferred over inventing `00000000`).
   */
  origin?: KeyOrigin
  /** Account-level xpub (e.g. at m/86'/0'/0') */
  xpub: string
  /** Receive (0) or change (1). Default receive. */
  chain?: 0 | 1
}

export interface DeriveAddressOptions {
  network?: DescriptorNetwork
  start?: number
  count?: number
}

export class DescriptorError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'EMPTY'
      | 'MISSING_CHECKSUM'
      | 'INVALID_CHECKSUM'
      | 'UNSUPPORTED'
      | 'PARSE'
      | 'DERIVE'
  ) {
    super(message)
    this.name = 'DescriptorError'
  }
}
