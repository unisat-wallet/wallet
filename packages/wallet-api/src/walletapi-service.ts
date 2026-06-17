import { PlatformEnv } from '@unisat/wallet-shared'
import { ProxyStorageAdapter } from '@unisat/wallet-storage'
import randomstring from 'randomstring'
import { UniSatApiClient } from './api-client'
import { BaseHttpClient } from './client/http-client'

interface WalletApiStore {
  deviceId: string
}

// Service configuration
export interface WalletServiceConfig {
  storage?: ProxyStorageAdapter
  logger?: any
  endpoint?: string
  httpClient?: BaseHttpClient
}

export class WalletApiService {
  private store!: WalletApiStore
  private storage: ProxyStorageAdapter = undefined as any
  private client: UniSatApiClient = undefined as any
  private clientAddress = ''
  private currentEndpoint = ''
  private storageKey: string = 'openapi'

  constructor() {
    this.currentEndpoint = 'https://wallet-api-fractal.unisat.space'
  }

  init = async (config: WalletServiceConfig) => {
    if (config.httpClient) {
      this.client = new UniSatApiClient(config.httpClient)
    }

    if (config.storage) {
      this.storage = config.storage
    }

    if (config.endpoint) {
      this.currentEndpoint = config.endpoint
    }

    if (!this.storage) {
      throw new Error('WalletApiService: Storage adapter is required')
    }

    this.store = await this.storage.createPersistentProxy<WalletApiStore>(this.storageKey, {
      deviceId: this.generateDeviceId(),
    })

    // Update client configuration
    this.client.setBaseURL(this.currentEndpoint)

    // Set common headers
    this.updateHeaders()

    if (!this.store.deviceId) {
      this.store.deviceId = this.generateDeviceId()
    }
    PlatformEnv.UDID = this.store.deviceId
  }

  resetAllData = async () => {
    const initialState: WalletApiStore = {
      deviceId: this.generateDeviceId(),
    }

    await this.storage.set(this.storageKey, initialState)

    this.store = await this.storage.createPersistentProxy<WalletApiStore>(
      this.storageKey,
      initialState
    )

    PlatformEnv.UDID = this.store.deviceId

    this.setClientAddress('')
  }

  setEndpoint = async (endpoint: string) => {
    this.currentEndpoint = endpoint
    this.client.setBaseURL(this.currentEndpoint)
    this.updateHeaders()
  }

  setClientAddress = async (address: string) => {
    this.clientAddress = address
    this.updateHeaders()
  }

  updateHeaders = () => {
    const headers: Record<string, string> = {
      'x-client': 'UniSat Wallet',
      'x-version': PlatformEnv.VERSION,
      'x-channel': PlatformEnv.CHANNEL,
      'x-udid': PlatformEnv.UDID,
      'x-udid2': PlatformEnv.UDID2,
    }

    if (this.clientAddress) {
      headers['x-address'] = this.clientAddress
    }

    this.client.setHeaders(headers)
  }

  private generateDeviceId = (): string => {
    return randomstring.generate(12)
  }

  // Expose the client for direct access to all API methods
  getClient = (): UniSatApiClient => {
    return this.client
  }

  // Proxy common methods for convenience
  get bitcoin() {
    return this.client.bitcoin
  }
  get inscriptions() {
    return this.client.inscriptions
  }
  get brc20() {
    return this.client.brc20
  }
  get runes() {
    return this.client.runes
  }
  get rgb() {
    return this.client.rgb
  }
  get alkanes() {
    return this.client.alkanes
  }
  get cat() {
    return this.client.cat
  }
  get market() {
    return this.client.market
  }
  get domain() {
    return this.client.domain as any
  }
  get utility() {
    return this.client.utility
  }
  get config() {
    return this.client.config
  }

  get notification() {
    return this.client.notification
  }
}
