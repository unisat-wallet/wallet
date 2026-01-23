import { Keyring, KeyringType, ToSignInput } from '../types'

export class ReadonlyKeyring implements Keyring {
  static type = KeyringType.ReadonlyKeyring
  type = KeyringType.ReadonlyKeyring
  pubkeys: string[] = []
  constructor(pubkeys: string[]) {
    this.pubkeys = pubkeys
  }
  async addAccounts(n: number): Promise<string[]> {
    throw new Error('Method not implemented.')
  }

  async getAccounts(): Promise<string[]> {
    return this.pubkeys
  }

  signTransaction(psbt: any, inputs: ToSignInput[]): Promise<any> {
    throw new Error('Method not implemented.')
  }
  signMessage(address: string, message: string): Promise<string> {
    throw new Error('Method not implemented.')
  }
  verifyMessage(address: string, message: string, sig: string): Promise<boolean> {
    throw new Error('Method not implemented.')
  }

  exportAccount(address: string): Promise<string> {
    throw new Error('Method not implemented.')
  }
  removeAccount(address: string): void {
    throw new Error('Method not implemented.')
  }

  async serialize() {
    return this.pubkeys.join(',')
  }

  async deserialize(opts: any) {
    this.pubkeys = opts.split(',')
  }
}
