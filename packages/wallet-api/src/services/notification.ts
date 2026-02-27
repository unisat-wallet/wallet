/**
 * Notification related API methods
 */

import { NotificationListItem } from '@unisat/wallet-shared'
import type { BaseHttpClient } from '../client/http-client'

export class NotificationService {
  constructor(private readonly httpClient: BaseHttpClient) {}

  // ========================================
  // Notification related
  // ========================================

  /**
   * Get notification list
   */
  async getList(): Promise<{
    list: NotificationListItem[]
    total: number
  }> {
    return this.httpClient.get('/v5/notification/list', {})
  }

  async read(notificationId: string): Promise<{
    success: boolean
  }> {
    return this.httpClient.post('/v5/notification/read', { notificationId })
  }

  async readAll(notificationIds: string[]): Promise<{
    success: boolean
  }> {
    return this.httpClient.post('/v5/notification/read-all', {
      notificationIds,
    })
  }
}
