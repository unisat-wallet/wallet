import { StorageAdapter } from '../types'

/**
 * Extension persist store adapter for Chrome extension storage
 * Compatible with createPersistStore function from extension background
 */
export class ExtensionPersistStoreAdapter implements StorageAdapter {
  private store: any = null
  private initialized = false
  private createPersistStore: (config: any) => Promise<any>
  private storeName: string

  constructor(createPersistStore: (config: any) => Promise<any>, storeName: string) {
    this.createPersistStore = createPersistStore
    this.storeName = storeName
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    // Initialize with default template structure
    const defaultTemplate = {
      vault: null,
      booted: null,
    }

    this.store = await this.createPersistStore({
      name: this.storeName,
      template: defaultTemplate,
      fromStorage: true,
    })

    this.initialized = true
  }

  async get(key: string): Promise<any> {
    await this.ensureInitialized()

    if (key === this.storeName) {
      // Return the entire store for main storage key
      return this.store
    }

    return this.store[key]
  }

  async set(key: string, value: any): Promise<void> {
    await this.ensureInitialized()

    if (key === this.storeName && value && typeof value === 'object') {
      // Replace entire store content for main storage key
      Object.keys(this.store).forEach(k => delete this.store[k])
      Object.assign(this.store, value)
    } else if (value !== null && value !== undefined) {
      // Set individual property
      this.store[key] = value
    }
  }

  async remove(key: string): Promise<void> {
    await this.ensureInitialized()
    delete this.store[key]
  }

  async clear(): Promise<void> {
    await this.ensureInitialized()
    Object.keys(this.store).forEach(key => delete this.store[key])
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init()
    }
  }

  // Helper method for testing and debugging
  getRawStore(): any {
    return this.store
  }
}
