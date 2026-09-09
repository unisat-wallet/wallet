/**
 * Phishing Service - Cross-platform phishing detection service
 */

import { EventEmitter } from 'eventemitter3'
import { fetchHotlist, fetchPhishingList } from 'utils/fetch'
import type {
  PhishingAdapter,
  PhishingCheckResult,
  PhishingConfig,
  PhishingServiceConfig,
  PhishingServiceEvents,
} from './types'

const STORE_KEY = 'phishing'
const COMPACT_CONFIG_ENCODING = 'newline-list:v1'
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours
const VERSION = 2
const HOTLIST_UPDATE_INTERVAL = 10 * 60 * 1000 // 10 minutes

const initConfig: PhishingConfig = {
  version: VERSION,
  tolerance: 1,
  fuzzylist: [],
  whitelist: [],
  blacklist: [],
  lastFetchTime: 0,
  cacheExpireTime: CACHE_DURATION,
}

interface CompactPhishingConfig {
  encoding: typeof COMPACT_CONFIG_ENCODING
  config: Omit<PhishingConfig, 'blacklist'>
  blacklist: string
}

const isCompactConfig = (config: unknown): config is CompactPhishingConfig => {
  if (!config || typeof config !== 'object') {
    return false
  }

  const { encoding, config: metadata, blacklist } = config as Partial<CompactPhishingConfig>
  return encoding === COMPACT_CONFIG_ENCODING && !!metadata && typeof blacklist === 'string'
}

const decodeConfig = (stored: unknown): PhishingConfig | undefined => {
  if (isCompactConfig(stored)) {
    return {
      ...stored.config,
      blacklist: stored.blacklist ? stored.blacklist.split('\n') : [],
    }
  }

  return stored as PhishingConfig | undefined
}

export class PhishingService extends EventEmitter<PhishingServiceEvents> {
  private config: PhishingConfig = { ...initConfig }

  private adapter: PhishingAdapter = null!
  private logger: any
  private t: any
  private updating = false
  private temporaryWhitelist: Set<string> = new Set()
  private blacklistSet: Set<string> = new Set()
  private whitelistSet: Set<string> = new Set()
  private updateTimer: NodeJS.Timeout | null = null
  private hotlistTimer: NodeJS.Timeout | null = null
  private legacyMigrationTimer: NodeJS.Timeout | null = null
  private initialized = false

  constructor() {
    super()
  }

  /**
   * Initialize the preference service
   */
  async init(configOrAdapter: PhishingServiceConfig): Promise<void> {
    // Support both config object and direct adapter for backward compatibility
    this.adapter = configOrAdapter.adapter
    this.logger = configOrAdapter.logger || console
    this.t = configOrAdapter.t || ((key: string) => key)

    if (this.initialized) {
      return
    }

    await this.loadConfig()
    if (this.config.blacklist.length === 0) {
      this.forceUpdate()
    }
    this.scheduleUpdate()
    this.fetchAndApplyHotlist()
    this.scheduleHotlistUpdate()
    this.initialized = true
  }

  /**
   * Destroy the service and cleanup resources
   */
  destroy(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
      this.updateTimer = null
    }
    if (this.hotlistTimer) {
      clearTimeout(this.hotlistTimer)
      this.hotlistTimer = null
    }
    if (this.legacyMigrationTimer) {
      clearTimeout(this.legacyMigrationTimer)
      this.legacyMigrationTimer = null
    }
    this.removeAllListeners()
    this.initialized = false
  }

  /**
   * Check if a hostname is a phishing site
   */
  checkPhishing(hostname: string): PhishingCheckResult {
    if (!hostname || typeof hostname !== 'string') {
      return { isPhishing: false, reason: 'Invalid hostname' }
    }

    // Normalize hostname
    const normalizedHostname = this.normalizeHostname(hostname)

    // Check temporary whitelist
    if (this.temporaryWhitelist.has(normalizedHostname)) {
      return { isPhishing: false, reason: 'Temporary whitelist' }
    }

    // Check permanent whitelist
    if (this.whitelistSet.has(normalizedHostname)) {
      return { isPhishing: false, reason: 'Permanent whitelist' }
    }

    // Check blacklist
    if (this.blacklistSet.has(normalizedHostname)) {
      this.emit('phishing:detected', hostname, 'Blacklist match')
      return {
        isPhishing: true,
        reason: 'Blacklist match',
        matchedPattern: normalizedHostname,
      }
    }

    // Check fuzzy matching
    // const fuzzyMatch = this.checkFuzzyMatch(normalizedHostname)
    // if (fuzzyMatch) {
    //   this.emit('phishing:detected', hostname, 'Fuzzy match')
    //   return {
    //     isPhishing: true,
    //     reason: 'Fuzzy match',
    //     matchedPattern: fuzzyMatch,
    //   }
    // }

    return { isPhishing: false }
  }

  /**
   * Simplified boolean check method for backward compatibility
   */
  isPhishing(hostname: string): boolean {
    return this.checkPhishing(hostname).isPhishing
  }

  /**
   * Add hostname to temporary whitelist
   */
  addToWhitelist(hostname: string): void {
    const normalizedHostname = this.normalizeHostname(hostname)
    this.temporaryWhitelist.add(normalizedHostname)
  }

  /**
   * Add hostname to permanent whitelist
   */
  async addToPermanentWhitelist(hostname: string): Promise<void> {
    const normalizedHostname = this.normalizeHostname(hostname)
    if (!this.config.whitelist.includes(normalizedHostname)) {
      this.config.whitelist.push(normalizedHostname)
      this.whitelistSet.add(normalizedHostname)
      await this.saveConfig()
    }
  }

  /**
   * Remove hostname from whitelist
   */
  async removeFromWhitelist(hostname: string): Promise<void> {
    const normalizedHostname = this.normalizeHostname(hostname)

    // Remove from temporary whitelist
    this.temporaryWhitelist.delete(normalizedHostname)

    // Remove from permanent whitelist
    const index = this.config.whitelist.indexOf(normalizedHostname)
    if (index > -1) {
      this.config.whitelist.splice(index, 1)
      this.whitelistSet.delete(normalizedHostname)
      await this.saveConfig()
    }
  }

  /**
   * Force update phishing site list
   */
  async forceUpdate(): Promise<void> {
    if (this.updating) {
      return
    }

    this.updating = true
    try {
      await this.updatePhishingList()
    } finally {
      this.updating = false
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): PhishingConfig {
    return { ...this.config }
  }

  /**
   * Get statistics information
   */
  getStats() {
    return {
      blacklistSize: this.config.blacklist.length,
      whitelistSize: this.config.whitelist.length,
      fuzzylistSize: this.config.fuzzylist.length,
      temporaryWhitelistSize: this.temporaryWhitelist.size,
      lastUpdate: this.config.lastFetchTime,
      isUpdating: this.updating,
    }
  }

  private async loadConfig(): Promise<void> {
    try {
      const stored = await this.adapter.get(STORE_KEY)
      const storedConfig = decodeConfig(stored)

      if (storedConfig && storedConfig.version === this.config.version) {
        this.config = { ...this.config, ...storedConfig }
        this.updateSets()

        // Migrate legacy formats without holding up startup. A compact string avoids Chrome having
        // to clone and deserialize the full blacklist object on later starts.
        if (!isCompactConfig(stored)) {
          this.scheduleLegacyConfigMigration()
        }
      } else {
        // Config version mismatch or doesn't exist, need to update
        await this.updatePhishingList()
      }
    } catch (error) {
      this.logger.error('Failed to load phishing config:', error)
      this.emit('phishing:error', error as Error)
      await this.updatePhishingList()
    }
  }

  private async saveConfig(): Promise<void> {
    try {
      const { blacklist, ...config } = this.config
      const value: CompactPhishingConfig = {
        encoding: COMPACT_CONFIG_ENCODING,
        config,
        blacklist: blacklist.join('\n'),
      }
      await this.adapter.set(STORE_KEY, value)
    } catch (error) {
      this.logger.error('Failed to save phishing config:', error)
      this.emit('phishing:error', error as Error)
    }
  }

  private scheduleLegacyConfigMigration(): void {
    if (this.legacyMigrationTimer) {
      return
    }

    // Let the current startup finish before replacing the legacy format. Subsequent starts use the
    // compact representation.
    this.legacyMigrationTimer = setTimeout(() => {
      this.legacyMigrationTimer = null
      void this.saveConfig()
    }, 3000)
  }

  private updateSets(): void {
    this.blacklistSet = new Set(this.config.blacklist)
    this.whitelistSet = new Set(this.config.whitelist)
  }

  private scheduleUpdate(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
    }

    const now = Date.now()
    const timeSinceLastUpdate = now - this.config.lastFetchTime
    const timeUntilNextUpdate = Math.max(0, this.config.cacheExpireTime - timeSinceLastUpdate)

    this.updateTimer = setTimeout(() => {
      this.updatePhishingList()
    }, timeUntilNextUpdate)
  }

  private scheduleHotlistUpdate(): void {
    if (this.hotlistTimer) {
      clearTimeout(this.hotlistTimer)
    }
    this.hotlistTimer = setTimeout(() => {
      this.fetchAndApplyHotlist()
    }, HOTLIST_UPDATE_INTERVAL)
  }

  private async fetchAndApplyHotlist(): Promise<void> {
    try {
      const result = await fetchHotlist()
      if (!result) return

      for (const domain of result.allowlist) {
        this.temporaryWhitelist.add(this.normalizeHostname(domain))
      }

      for (const domain of result.blacklist) {
        this.blacklistSet.add(this.normalizeHostname(domain))
      }
    } finally {
      this.scheduleHotlistUpdate()
    }
  }

  private async updatePhishingList(): Promise<void> {
    try {
      const newConfig = await fetchPhishingList()

      // Ensure domains in default whitelist are not in the blacklist
      const defaultWhitelist = new Set(initConfig.whitelist)

      // Filter blacklist, remove whitelisted domains and their subdomains
      let filteredBlacklist: string[] = []
      if (Array.isArray(newConfig.blacklist)) {
        filteredBlacklist = newConfig.blacklist.filter(domain => {
          // Remove domains in whitelist
          if (defaultWhitelist.has(domain)) {
            return false
          }

          // Remove subdomains of whitelisted domains
          const domainParts = domain.split('.')
          if (domainParts.length > 2) {
            const mainDomain = domainParts.slice(domainParts.length - 2).join('.')
            if (defaultWhitelist.has(mainDomain)) {
              return false
            }
          }

          // Keep other domains
          return true
        })
      }

      // Merge remote whitelist and default whitelist
      const mergedWhitelist = Array.from(
        new Set([...(newConfig.whitelist || []), ...initConfig.whitelist])
      )

      this.config = {
        ...newConfig,
        blacklist: filteredBlacklist,
        whitelist: mergedWhitelist,
        version: VERSION,
        lastFetchTime: Date.now(),
        cacheExpireTime: CACHE_DURATION,
      }

      this.updateSets()
      await this.saveConfig()
      this.emit('phishing:updated', this.config)

      // Reschedule next update
      this.scheduleUpdate()
    } catch (error) {
      this.logger.error('Failed to update phishing list:', error)
      this.emit('phishing:error', error as Error)

      // Update failed, retry after 1 hour
      this.updateTimer = setTimeout(
        () => {
          this.updatePhishingList()
        },
        60 * 60 * 1000
      )
    }
  }

  private normalizeHostname(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, '')
  }

  private checkFuzzyMatch(hostname: string): string | null {
    if (!this.config.fuzzylist.length) {
      return null
    }

    // Simple fuzzy matching implementation
    for (const pattern of this.config.fuzzylist) {
      if (this.isPhishingMatch(hostname, pattern)) {
        return pattern
      }
    }

    return null
  }

  private isPhishingMatch(hostname: string, pattern: string): boolean {
    // Basic fuzzy matching logic implementation
    const normalizedPattern = pattern.toLowerCase()
    const normalizedHostname = hostname.toLowerCase()

    // Check exact match
    if (normalizedHostname === normalizedPattern) {
      return true
    }

    // Check subdomain match
    if (normalizedHostname.endsWith('.' + normalizedPattern)) {
      return true
    }

    // Check edit distance
    return this.levenshteinDistance(normalizedHostname, normalizedPattern) <= this.config.tolerance
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = []
    const len1 = str1.length
    const len2 = str2.length

    if (len1 === 0) return len2
    if (len2 === 0) return len1

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i]
    }

    for (let j = 0; j <= len2; j++) {
      if (matrix[0]) {
        matrix[0][j] = j
      }
    }

    // Calculate edit distance
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1
        const prevRow = matrix[i - 1]
        const currRow = matrix[i]
        const prevCell = matrix[i - 1]?.[j - 1]

        if (currRow && prevRow && typeof prevCell === 'number') {
          currRow[j] = Math.min(
            (prevRow[j] || 0) + 1, // deletion
            (currRow[j - 1] || 0) + 1, // insertion
            prevCell + cost // substitution
          )
        }
      }
    }

    return matrix[len1]?.[len2] || 0
  }
}
