/**
 * UniSat Wallet API Client - Fully compatible with openapi.ts interface
 *
 * This client provides a fully compatible interface with openapi.ts from unisat-extension
 */

// Export client
export { HttpClient } from './client/http-client'

// Export all services
export * from './services'

// Export all types
export * from './types'

// Export main client class
import { BaseHttpClient } from './client/http-client'
import {
  CATService,
  ConfigService,
  MarketService,
  NotificationService,
  UtilityService,
} from './services'
import { AlkanesService } from './services/alkanes'
import { BitcoinService } from './services/bitcoin'
import { BRC20Service } from './services/brc20'
import { DomainService } from './services/domain'
import { InscriptionsService } from './services/inscriptions'
import { RgbService } from './services/rgb'
import { RunesService } from './services/runes'

/**
 * Unified API Client - Matches all methods from openapi.ts
 */
export class UniSatApiClient {
  public readonly bitcoin: BitcoinService
  public readonly inscriptions: InscriptionsService
  public readonly brc20: BRC20Service
  public readonly runes: RunesService
  public readonly rgb: RgbService
  public readonly alkanes: AlkanesService
  public readonly cat: CATService
  public readonly market: MarketService
  public readonly domain: DomainService
  public readonly utility: UtilityService
  public readonly config: ConfigService
  public readonly notification: NotificationService

  private readonly httpClient: BaseHttpClient

  constructor(httpClient: BaseHttpClient) {
    this.httpClient = httpClient

    // Initialize all services
    this.bitcoin = new BitcoinService(this.httpClient)
    this.inscriptions = new InscriptionsService(this.httpClient)
    this.brc20 = new BRC20Service(this.httpClient)
    this.runes = new RunesService(this.httpClient)
    this.rgb = new RgbService(this.httpClient)
    this.alkanes = new AlkanesService(this.httpClient)
    this.cat = new CATService(this.httpClient)
    this.market = new MarketService(this.httpClient)
    this.domain = new DomainService(this.httpClient)
    this.utility = new UtilityService(this.httpClient)
    this.config = new ConfigService(this.httpClient)
    this.notification = new NotificationService(this.httpClient)
  }

  // ========================================
  // HTTP Client configuration methods
  // ========================================

  /**
   * Set base URL
   */
  setBaseURL(baseURL: string): void {
    this.httpClient.setBaseURL(baseURL)
  }

  /**
   * Set request headers
   */
  setHeaders(headers: Record<string, string>): void {
    this.httpClient.setHeaders(headers)
  }

  /**
   * Get underlying HTTP client
   */
  getHttpClient(): BaseHttpClient {
    return this.httpClient
  }
}
