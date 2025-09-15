import { Encryptor } from '../types'

// @ts-ignore
import * as browserPassworder from 'browser-passworder'

// Production-ready encryptor using browser-passworder
export class BrowserPassworderEncryptor implements Encryptor {
  async encrypt(password: string, data: any): Promise<string> {
    return await browserPassworder.encrypt(password, data)
  }

  async decrypt(password: string, encryptedData: string): Promise<any> {
    return await browserPassworder.decrypt(password, encryptedData)
  }
}
