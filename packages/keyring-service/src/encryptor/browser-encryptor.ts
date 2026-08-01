import { Encryptor } from '../types'
import { WebCryptoVaultEncryptor } from './webcrypto-vault-encryptor'

/**
 * Production encryptor.
 * Historically wrapped browser-passworder (PBKDF2 10k).
 * Now uses WebCryptoVaultEncryptor (PBKDF2 600k) with legacy 10k decrypt fallback.
 */
export class BrowserPassworderEncryptor implements Encryptor {
  private readonly impl = new WebCryptoVaultEncryptor()

  async encrypt(password: string, data: any): Promise<string> {
    return this.impl.encrypt(password, data)
  }

  async decrypt(password: string, encryptedData: string): Promise<any> {
    return this.impl.decrypt(password, encryptedData)
  }
}
