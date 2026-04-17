import { Keyring, KeyringType, ToSignInput } from '../types'

export class WatchAddressKeyring implements Keyring {
  static type = KeyringType.WatchAddressKeyring
  type = KeyringType.WatchAddressKeyring
  addresses: string[] = []

  constructor(addresses: string[]) {
    this.addresses = addresses
  }

  async getAccounts(): Promise<string[]> {
    return this.addresses
  }

  async addAccounts(_n: number): Promise<string[]> {
    throw new Error('Method not implemented.')
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

  async serialize() {
    return this.addresses.join(',')
  }

  async deserialize(opts: any) {
    this.addresses = opts ? opts.split(',') : []
  }
}
