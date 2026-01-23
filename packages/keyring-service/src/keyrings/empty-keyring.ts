import { Keyring, KeyringType, ToSignInput } from '../types'
// Empty keyring implementation for placeholder
export class EmptyKeyring implements Keyring {
  type = KeyringType.Empty

  constructor() {
    // Empty implementation
  }

  async addAccounts(n: number): Promise<string[]> {
    return []
  }

  async getAccounts(): Promise<string[]> {
    return []
  }

  signTransaction(psbt: any, inputs: ToSignInput[]): Promise<any> {
    throw new Error('Method not implemented in empty keyring.')
  }

  signMessage(address: string, message: string): Promise<string> {
    throw new Error('Method not implemented in empty keyring.')
  }

  verifyMessage(address: string, message: string, sig: string): Promise<boolean> {
    throw new Error('Method not implemented in empty keyring.')
  }

  exportAccount(address: string): Promise<string> {
    throw new Error('Method not implemented in empty keyring.')
  }

  removeAccount(address: string): void {
    throw new Error('Method not implemented in empty keyring.')
  }

  async serialize(): Promise<any> {
    return {}
  }

  async deserialize(opts: any): Promise<void> {
    // Empty implementation
  }
}
