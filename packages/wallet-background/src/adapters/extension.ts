/**
 * Browser extension implementations of adapters
 */

import type {
  StorageAdapter,
  NotificationAdapter,
  NotificationOptions,
  NetworkAdapter,
  RequestOptions,
  ResponseData,
  PlatformAdapter,
  PlatformInfo,
  TabInfo,
} from './index'

/**
 * Extension storage adapter using chrome.storage API
 */
export class ExtensionStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<any> {
    const result = await chrome.storage.local.get(key)
    return result[key]
  }

  async set(key: string, value: any): Promise<void> {
    await chrome.storage.local.set({ [key]: value })
  }

  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove([key])
  }

  async clear(): Promise<void> {
    await chrome.storage.local.clear()
  }

  async keys(): Promise<string[]> {
    const result = await chrome.storage.local.get()
    return Object.keys(result)
  }

  async has(key: string): Promise<boolean> {
    const result = await chrome.storage.local.get(key)
    return key in result
  }
}

/**
 * Extension notification adapter using chrome.notifications API
 */
export class ExtensionNotificationAdapter implements NotificationAdapter {
  async create(id: string, options: NotificationOptions): Promise<void> {
    await chrome.notifications.create(id, {
      type: options.type || 'basic',
      iconUrl: options.iconUrl || '/assets/icon-128.png',
      title: options.title,
      message: options.message,
      priority: options.priority || 0,
    })
  }

  async clear(id: string): Promise<void> {
    await chrome.notifications.clear(id)
  }

  async clearAll(): Promise<void> {
    if (chrome.notifications?.getAll) {
      // @ts-ignore
      const notifications = await chrome.notifications.getAll()
      await Promise.all(Object.keys(notifications as any).map(id => chrome.notifications.clear(id)))
    }
  }

  isSupported(): boolean {
    return !!(chrome && chrome.notifications)
  }
}

/**
 * Extension network adapter using fetch API
 */
export class ExtensionNetworkAdapter implements NetworkAdapter {
  async request<T = any>(url: string, options?: RequestOptions): Promise<ResponseData<T>> {
    const response = await fetch(url, {
      method: options?.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: options?.body ? JSON.stringify(options.body) : null,
      signal: options?.timeout ? AbortSignal.timeout(options.timeout) : null,
    })

    if (!response.ok) {
      throw new Error(`Network request failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    return {
      data,
      status: response.status,
      statusText: response.statusText,
      headers,
    }
  }

  async get<T = any>(
    url: string,
    options?: Omit<RequestOptions, 'method'>
  ): Promise<ResponseData<T>> {
    return this.request<T>(url, { ...options, method: 'GET' })
  }

  async post<T = any>(
    url: string,
    data?: any,
    options?: Omit<RequestOptions, 'method' | 'body'>
  ): Promise<ResponseData<T>> {
    return this.request<T>(url, { ...options, method: 'POST', body: data })
  }

  async isOnline(): Promise<boolean> {
    return navigator.onLine
  }
}

/**
 * Extension platform adapter using chrome APIs
 */
export class ExtensionPlatformAdapter implements PlatformAdapter {
  getPlatformInfo(): PlatformInfo {
    const manifestVersion = chrome.runtime.getManifest().manifest_version
    return {
      name: 'extension',
      version: chrome.runtime.getManifest().version,
      browser: this.getBrowserName(),
      os: navigator.platform,
    }
  }

  isFeatureSupported(feature: string): boolean {
    switch (feature) {
      case 'tabs':
        return !!(chrome && chrome.tabs)
      case 'notifications':
        return !!(chrome && chrome.notifications)
      case 'storage':
        return !!(chrome && chrome.storage)
      case 'sidePanel':
        return !!(chrome && (chrome as any).sidePanel)
      default:
        return false
    }
  }

  async openUrl(url: string): Promise<void> {
    await chrome.tabs.create({ url })
  }

  async getActiveTab(): Promise<TabInfo | null> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    if (!tab) return null

    return {
      id: tab.id!,
      url: tab.url,
      title: tab.title,
      active: tab.active,
    }
  }

  async getAllTabs(): Promise<TabInfo[]> {
    const tabs = await chrome.tabs.query({})
    return tabs.map(tab => ({
      id: tab.id!,
      url: tab.url,
      title: tab.title,
      active: tab.active,
    }))
  }

  async closeTab(tabId: number): Promise<void> {
    await chrome.tabs.remove(tabId)
  }

  async focusTab(tabId: number): Promise<void> {
    await chrome.tabs.update(tabId, { active: true })
  }

  async getExtensionInfo(): Promise<{ id: string; version: string; name: string }> {
    const manifest = chrome.runtime.getManifest()
    return {
      id: chrome.runtime.id,
      version: manifest.version,
      name: manifest.name,
    }
  }

  async reloadExtension(): Promise<void> {
    chrome.runtime.reload()
  }

  isDevelopment(): boolean {
    return !!(chrome.runtime.getManifest().key === undefined)
  }

  getAppVersion(): string {
    return chrome.runtime.getManifest().version
  }

  private getBrowserName(): string {
    const userAgent = navigator.userAgent
    if (userAgent.includes('Chrome')) return 'chrome'
    if (userAgent.includes('Firefox')) return 'firefox'
    if (userAgent.includes('Safari')) return 'safari'
    if (userAgent.includes('Edge')) return 'edge'
    return 'unknown'
  }
}
