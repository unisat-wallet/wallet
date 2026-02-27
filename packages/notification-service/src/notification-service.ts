import { WalletApiService } from '@unisat/wallet-api'
import { Logger, StoredNotification } from '@unisat/wallet-shared'
import { ProxyStorageAdapter } from '@unisat/wallet-storage'
import { NotificationStore } from './types'

const MAX_NOTIFICATIONS = 20
// Read notifications are deleted after 7 days
const READ_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

// Default no-op logger
const defaultLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

export interface NotificationServiceConfig {
  storage?: ProxyStorageAdapter
  logger?: Logger
  api?: WalletApiService
}

export class NotificationService {
  private storage: ProxyStorageAdapter = undefined as any
  private logger: Logger = defaultLogger
  private storageKey: string = 'notifications'
  private store: NotificationStore = {}
  private api: WalletApiService = undefined as any

  constructor() {}

  async init(config: NotificationServiceConfig): Promise<void> {
    if (config.storage) {
      this.storage = config.storage
    }
    if (config.logger) {
      this.logger = config.logger
    }
    if (config.api) {
      this.api = config.api
    }

    this.logger.debug('Initializing notification service...')

    try {
      const storedData = await this.storage.get(this.storageKey)
      this.store = storedData || {}
      this.logger.debug('Notification service initialization completed')
    } catch (error) {
      this.logger.error('Notification service initialization failed:', error)
      throw error
    }
  }

  resetAllData = () => {
    this.storage.set(this.storageKey, {})
    this.store = {}
  }

  // Fetch from server, merge into local store.
  // Prune read+expired entries, then cap total at MAX_NOTIFICATIONS (keep highest priority / newest).
  getNotifications = async (): Promise<StoredNotification[]> => {
    try {
      const res = await this.api.notification.getList()

      // Merge server items into local store (server is source of truth for content)
      for (const item of res.list) {
        const existing = this.store[item.id]
        this.store[item.id] = {
          ...item,
          // preserve readAt if already marked locally
          readAt: existing?.readAt,
        }
      }

      // Purge read entries that have expired
      const now = Date.now()
      for (const id of Object.keys(this.store)) {
        const entry = this.store[id]
        if (entry.readAt !== undefined && now - entry.readAt > READ_EXPIRY_MS) {
          delete this.store[id]
        }
      }

      // Cap at MAX_NOTIFICATIONS: sort by priority desc, then publishTime desc, keep first N
      const entries = Object.values(this.store)
      if (entries.length > MAX_NOTIFICATIONS) {
        entries.sort((a, b) => b.priority - a.priority || b.publishTime - a.publishTime)
        const keep = entries.slice(0, MAX_NOTIFICATIONS)
        const keepIds = new Set(keep.map(e => e.id))
        for (const id of Object.keys(this.store)) {
          if (!keepIds.has(id)) {
            delete this.store[id]
          }
        }
      }

      await this.storage.set(this.storageKey, this.store)
    } catch (error) {
      this.logger.error('Failed to fetch notifications from server:', error)
      // Fall back to local store on network error
    }

    return Object.values(this.store).sort(
      (a, b) => b.priority - a.priority || b.publishTime - a.publishTime
    )
  }

  markAsRead = async (id: string): Promise<void> => {
    if (!this.store[id]) return

    await this.api.notification.read(id)

    this.store[id] = { ...this.store[id], readAt: Date.now() }
    await this.storage.set(this.storageKey, this.store)
  }

  readAll = async (): Promise<void> => {
    const unreadIds = Object.values(this.store)
      .filter(n => n.readAt === undefined)
      .map(n => n.id)

    await this.api.notification.readAll(unreadIds)
    const now = Date.now()
    for (const id of unreadIds) {
      this.store[id] = { ...this.store[id], readAt: now }
    }
    await this.storage.set(this.storageKey, this.store)
  }

  deleteNotification = async (id: string): Promise<void> => {
    if (!this.store[id]) return

    // Mark as read on server before deleting locally if not already read
    if (this.store[id].readAt === undefined) {
      try {
        await this.api.notification.read(id)
      } catch (error) {
        this.logger.warn('Failed to mark notification as read before deletion:', error)
      }
    }

    delete this.store[id]
    await this.storage.set(this.storageKey, this.store)
  }

  getUnreadCount = (): number => {
    return Object.values(this.store).filter(n => n.readAt === undefined).length
  }
}
