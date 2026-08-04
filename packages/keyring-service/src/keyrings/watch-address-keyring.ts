import { deriveAddresses, type DescriptorNetwork } from '@unisat/descriptor-service'
import { Keyring, KeyringType, ToSignInput } from '../types'

export interface WatchAddressKeyringData {
  addresses: string[]
  /** Receive descriptor — enables live gap expansion via addAccounts */
  descriptor?: string
  changeDescriptor?: string
  network?: DescriptorNetwork
  /**
   * Count of receive addresses in `addresses` derived from `descriptor`.
   * Gap expansion uses this (not addresses.length) so future change entries
   * cannot corrupt the receive start index.
   */
  receiveCount?: number
}

function isWatchData(opts: unknown): opts is WatchAddressKeyringData {
  return !!opts && typeof opts === 'object' && !Array.isArray(opts) && 'addresses' in (opts as object)
}

/**
 * Watch-only addresses. Optionally stores a BIP-380 descriptor so more
 * receive addresses can be derived later (gap discovery) without private keys.
 *
 * Invariant: when `descriptor` is set, `addresses[0..receiveCount)` are receive
 * addresses from that descriptor (change is never mixed into this prefix).
 */
export class WatchAddressKeyring implements Keyring {
  static type = KeyringType.WatchAddressKeyring
  type = KeyringType.WatchAddressKeyring
  addresses: string[] = []
  descriptor?: string
  changeDescriptor?: string
  network: DescriptorNetwork = 'mainnet'
  /** Length of the receive prefix in `addresses` (see class invariant). */
  receiveCount = 0

  constructor(opts?: string[] | WatchAddressKeyringData) {
    if (Array.isArray(opts)) {
      this.addresses = opts.filter(Boolean)
      this.receiveCount = this.addresses.length
      return
    }
    if (isWatchData(opts)) {
      this.addresses = [...(opts.addresses || [])]
      this.descriptor = opts.descriptor
      this.changeDescriptor = opts.changeDescriptor
      this.network = opts.network || 'mainnet'
      this.receiveCount =
        typeof opts.receiveCount === 'number' ? opts.receiveCount : this.addresses.length
    }
  }

  async getAccounts(): Promise<string[]> {
    return this.addresses
  }

  /**
   * Derive the next `n` receive addresses from the stored descriptor.
   * Returns the new addresses (same contract as other keyrings' addAccounts).
   */
  async addAccounts(n: number): Promise<string[]> {
    if (!this.descriptor) {
      throw new Error(
        'This watch wallet has no stored descriptor. Re-import a descriptor to enable gap discovery.'
      )
    }
    if (n < 1) return []
    const start = this.receiveCount
    const more = deriveAddresses(this.descriptor, {
      network: this.network,
      start,
      count: n,
    })
    // Insert after receive prefix (preserve any trailing non-receive entries)
    this.addresses.splice(this.receiveCount, 0, ...more)
    this.receiveCount += more.length
    return more
  }

  signTransaction(_psbt: any, _inputs: ToSignInput[]): Promise<any> {
    throw new Error('Method not implemented.')
  }

  signMessage(_address: string, _message: string): Promise<string> {
    throw new Error('Method not implemented.')
  }

  verifyMessage(_address: string, _message: string, _sig: string): Promise<boolean> {
    throw new Error('Method not implemented.')
  }

  exportAccount(_address: string): Promise<string> {
    throw new Error('Method not implemented.')
  }

  removeAccount(_address: string): void {
    throw new Error('Method not implemented.')
  }

  async serialize(): Promise<string | WatchAddressKeyringData> {
    // Legacy string form when no descriptor (single-address watch imports)
    if (!this.descriptor && !this.changeDescriptor) {
      return this.addresses.join(',')
    }
    return {
      addresses: this.addresses,
      descriptor: this.descriptor,
      changeDescriptor: this.changeDescriptor,
      network: this.network,
      receiveCount: this.receiveCount,
    }
  }

  async deserialize(opts: string | WatchAddressKeyringData): Promise<void> {
    if (typeof opts === 'string') {
      this.addresses = opts ? opts.split(',').filter(Boolean) : []
      this.descriptor = undefined
      this.changeDescriptor = undefined
      this.network = 'mainnet'
      this.receiveCount = this.addresses.length
      return
    }
    if (isWatchData(opts)) {
      this.addresses = [...(opts.addresses || [])]
      this.descriptor = opts.descriptor
      this.changeDescriptor = opts.changeDescriptor
      this.network = opts.network || 'mainnet'
      this.receiveCount =
        typeof opts.receiveCount === 'number' ? opts.receiveCount : this.addresses.length
      return
    }
    this.addresses = []
    this.receiveCount = 0
  }

  hasDescriptor(): boolean {
    return !!this.descriptor
  }
}
