import { ContactBookService as CoreContactBookService } from '../src/contact-book'
import { ChainType } from '@unisat/wallet-types'

class MemoryStorageAdapter {
  private storage: Record<string, any> = {}

  async get(key: string): Promise<any> {
    return this.storage[key]
  }

  async set(key: string, value: any): Promise<void> {
    this.storage[key] = value
  }

  async remove(key: string): Promise<void> {
    delete this.storage[key]
  }
}

export interface ExtensionContactBookItem {
  name: string
  address: string
  chain: ChainType
  isAlias: boolean
  isContact: boolean
  sortIndex?: number
}

export interface UIContactBookItem {
  name: string
  address: string
}

export class ContactBookService extends CoreContactBookService {
  private readonly _storage = new MemoryStorageAdapter()

  async init(): Promise<void> {
    return super.init({
      storage: this._storage as any,
      logger: console,
    })
  }
}

const contactBookService = new ContactBookService()

export default contactBookService
