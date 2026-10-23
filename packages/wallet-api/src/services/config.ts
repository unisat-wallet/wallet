/**
 * Configuration and utility API methods
 */

import type { BaseHttpClient, HttpClient } from '../client/http-client'
import type {
  WalletConfig,
  AppInfo,
  AppSummary,
  VersionDetail,
  CoinPrice,
  TickPriceItem,
  PaginationParams,
  RgbProxyPolicy,
} from '../types'

export class ConfigService {
  constructor(private readonly httpClient: BaseHttpClient) {}

  /**
   * Get wallet configuration
   */
  async getWalletConfig(): Promise<WalletConfig> {
    return this.httpClient.get('/v5/default/config')
  }

  async getRgbProxyPolicy(): Promise<RgbProxyPolicy> {
    return this.httpClient.get('/v5/rgb/proxy-policy', { retries: 0 })
  }

  /**
   * Get application list
   */
  async getAppList(): Promise<{
    apps: AppSummary[]
    featured: AppSummary[]
    categories: Array<{
      id: string
      name: string
      apps: AppSummary[]
    }>
  }> {
    return this.httpClient.get('/v5/default/app-list')
  }

  /**
   * Get banner list
   */
  async getBannerList(): Promise<
    Array<{
      id: string
      title: string
      description?: string
      imageUrl: string
      link?: string
      startTime?: number
      endTime?: number
      priority: number
      target: 'all' | 'mobile' | 'extension'
    }>
  > {
    return this.httpClient.get('/v5/default/banner-list')
  }

  /**
   * Get block activity information
   */
  async getBlockActiveInfo(): Promise<{
    allTransactions: number
    allAddrs: number
    currentHeight: number
    recentBlocks: Array<{
      height: number
      timestamp: number
      txCount: number
    }>
  }> {
    return this.httpClient.get('/v5/default/block-active-info')
  }

  /**
   * Get version details
   */
  async getVersionDetail(version: string): Promise<VersionDetail> {
    return this.httpClient.get('/v5/version/detail', { query: { version } })
  }

  /**
   * Get Bitcoin price
   */
  async getBitcoinPrice(): Promise<CoinPrice> {
    return this.httpClient.get('/v5/market/bitcoin/price')
  }

  /**
   * Get tick prices
   */
  async getTickPrices(ticks: string[]): Promise<TickPriceItem[]> {
    return this.httpClient.post('/v5/market/tick-prices', { ticks })
  }

  // ========================================
  // Babylon related
  // ========================================

  /**
   * Get Babylon configuration
   */
  async getBabylonConfig(): Promise<any> {
    return this.httpClient.get('/v5/babylon/config')
  }
}
