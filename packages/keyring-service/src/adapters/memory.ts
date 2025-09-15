import { StorageAdapter } from '../types'

/**
 * Memory storage adapter for testing and development
 * Data is only stored in memory and will be lost when the process exits
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private store: Record<string, any> = {}
  private initialized = false

  async init(): Promise<void> {
    if (this.initialized) {
      return
    }
    this.store = {}
    this.initialized = true
  }

  async get(key: string): Promise<any> {
    await this.ensureInitialized()
    return this.store[key]
  }

  async set(key: string, value: any): Promise<void> {
    await this.ensureInitialized()
    this.store[key] = value
  }

  async remove(key: string): Promise<void> {
    await this.ensureInitialized()
    delete this.store[key]
  }

  async clear(): Promise<void> {
    await this.ensureInitialized()
    this.store = {}
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init()
    }
  }

  // Helper method for testing
  getRawStore(): Record<string, any> {
    return { ...this.store }
  }
}
