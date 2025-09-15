import { Encryptor } from '../types'

// Simple browser-compatible encryptor (for development only)
export class SimpleEncryptor implements Encryptor {
  async encrypt(password: string, data: any): Promise<string> {
    const jsonString = JSON.stringify(data)
    const str = jsonString + password
    return Buffer.from(str).toString('base64')
  }

  async decrypt(password: string, encryptedData: string): Promise<any> {
    const str = Buffer.from(encryptedData, 'base64').toString('utf-8')
    const jsonString = str.slice(0, -password.length)
    return JSON.parse(jsonString)
  }
}
