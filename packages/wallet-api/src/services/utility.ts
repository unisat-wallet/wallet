/**
 * Utility and tool related API methods
 */

import type { BaseHttpClient } from '../client/http-client'
import { Announcement, AppSummary } from '../types'

export class UtilityService {
  constructor(private readonly httpClient: BaseHttpClient) {}

  // ========================================
  // Website and domain related
  // ========================================

  /**
   * Check website
   */
  async checkWebsite(website: string): Promise<{ isScammer: boolean; warning: string }> {
    return this.httpClient.post('/v5/default/check-website', { website })
  }

  // ========================================
  // Purchase related
  // ========================================

  /**
   * Get buy coin channel list
   */
  async getBuyCoinChannelList(coin: 'BTC' | 'FB'): Promise<{ channel: string }[]> {
    if (coin === 'BTC') {
      return this.httpClient.get('/v5/buy-btc/channel-list')
    } else {
      return this.httpClient.get('/v5/buy-fb/channel-list')
    }
  }

  /**
   * Create buy coin payment URL
   */
  async createBuyCoinPaymentUrl(
    coin: 'BTC' | 'FB',
    address: string,
    channel: string
  ): Promise<string> {
    if (coin === 'BTC') {
      return this.httpClient.post('/v5/buy-btc/create', { address, channel })
    } else {
      return this.httpClient.post('/v5/buy-fb/create', { address, channel })
    }
  }

  /**
   * Get application list
   */
  async getAppList(): Promise<
    {
      tab: string
      items: any[]
    }[]
  > {
    return this.httpClient.get('/v5/discovery/app-list')
  }

  /**
   * Get banner list
   */
  async getBannerList(): Promise<
    {
      id: string
      img: string
      link: string
    }[]
  > {
    return this.httpClient.get('/v5/discovery/banner-list')
  }

  /**
   * Get application summary
   */
  async getAppSummary(): Promise<AppSummary> {
    return this.httpClient.get('/v5/default/app-summary-v2')
  }

  /**
   * Get block activity information
   */
  async getBlockActiveInfo(): Promise<{ allTransactions: number; allAddrs: number }> {
    return this.httpClient.get('/v5/default/block-active-info')
  }

  async getAnnouncements(
    cursor: number,
    size: number
  ): Promise<{ hasMore: boolean; list: Announcement[] }> {
    return this.httpClient.get('/v5/announcement/list', {
      query: {
        cursor,
        size,
      },
    })
  }
}
