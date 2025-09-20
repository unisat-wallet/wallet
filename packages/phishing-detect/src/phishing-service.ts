/**
 * Phishing Service - Cross-platform phishing detection service
 */

import { EventEmitter } from 'eventemitter3';
import type { 
  PhishingConfig, 
  PhishingCheckResult, 
  PhishingAdapter,
  PhishingServiceEvents
} from './types';

export class PhishingService extends EventEmitter<PhishingServiceEvents> {
  private config: PhishingConfig = {
    version: 2,
    tolerance: 1,
    fuzzylist: [],
    whitelist: [],
    blacklist: [],
    lastFetchTime: 0,
    cacheExpireTime: 24 * 60 * 60 * 1000 // 24 hours
  };

  private adapter: PhishingAdapter;
  private updating = false;
  private temporaryWhitelist: Set<string> = new Set();
  private blacklistSet: Set<string> = new Set();
  private whitelistSet: Set<string> = new Set();
  private updateTimer: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor(adapter: PhishingAdapter) {
    super();
    this.adapter = adapter;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.loadConfig();
    this.scheduleUpdate();
    this.initialized = true;
  }

  /**
   * Destroy the service and cleanup resources
   */
  destroy(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    this.removeAllListeners();
    this.initialized = false;
  }

  /**
   * Check if a hostname is a phishing site
   */
  checkPhishing(hostname: string): PhishingCheckResult {
    if (!hostname || typeof hostname !== 'string') {
      return { isPhishing: false, reason: 'Invalid hostname' };
    }

    // Normalize hostname
    const normalizedHostname = this.normalizeHostname(hostname);

    // Check temporary whitelist
    if (this.temporaryWhitelist.has(normalizedHostname)) {
      return { isPhishing: false, reason: 'Temporary whitelist' };
    }

    // Check permanent whitelist
    if (this.whitelistSet.has(normalizedHostname)) {
      return { isPhishing: false, reason: 'Permanent whitelist' };
    }

    // Check blacklist
    if (this.blacklistSet.has(normalizedHostname)) {
      this.emit('phishing:detected', hostname, 'Blacklist match');
      return { 
        isPhishing: true, 
        reason: 'Blacklist match',
        matchedPattern: normalizedHostname
      };
    }

    // Check fuzzy matching
    const fuzzyMatch = this.checkFuzzyMatch(normalizedHostname);
    if (fuzzyMatch) {
      this.emit('phishing:detected', hostname, 'Fuzzy match');
      return { 
        isPhishing: true, 
        reason: 'Fuzzy match',
        matchedPattern: fuzzyMatch
      };
    }

    return { isPhishing: false };
  }

  /**
   * Simplified boolean check method for backward compatibility
   */
  isPhishing(hostname: string): boolean {
    return this.checkPhishing(hostname).isPhishing;
  }

  /**
   * Add hostname to temporary whitelist
   */
  addToWhitelist(hostname: string): void {
    const normalizedHostname = this.normalizeHostname(hostname);
    this.temporaryWhitelist.add(normalizedHostname);
  }

  /**
   * Add hostname to permanent whitelist
   */
  async addToPermanentWhitelist(hostname: string): Promise<void> {
    const normalizedHostname = this.normalizeHostname(hostname);
    if (!this.config.whitelist.includes(normalizedHostname)) {
      this.config.whitelist.push(normalizedHostname);
      this.whitelistSet.add(normalizedHostname);
      await this.saveConfig();
    }
  }

  /**
   * Remove hostname from whitelist
   */
  async removeFromWhitelist(hostname: string): Promise<void> {
    const normalizedHostname = this.normalizeHostname(hostname);
    
    // Remove from temporary whitelist
    this.temporaryWhitelist.delete(normalizedHostname);
    
    // Remove from permanent whitelist
    const index = this.config.whitelist.indexOf(normalizedHostname);
    if (index > -1) {
      this.config.whitelist.splice(index, 1);
      this.whitelistSet.delete(normalizedHostname);
      await this.saveConfig();
    }
  }

  /**
   * Force update phishing site list
   */
  async forceUpdate(): Promise<void> {
    if (this.updating) {
      return;
    }

    this.updating = true;
    try {
      await this.updatePhishingList();
    } finally {
      this.updating = false;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): PhishingConfig {
    return { ...this.config };
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
      isUpdating: this.updating
    };
  }

  private async loadConfig(): Promise<void> {
    try {
      const stored = await this.adapter.get('phishing:config');
      if (stored && stored.version === this.config.version) {
        this.config = { ...this.config, ...stored };
        this.updateSets();
      } else {
        // Config version mismatch or doesn't exist, need to update
        await this.updatePhishingList();
      }
    } catch (error) {
      console.error('Failed to load phishing config:', error);
      this.emit('phishing:error', error as Error);
      await this.updatePhishingList();
    }
  }

  private async saveConfig(): Promise<void> {
    try {
      await this.adapter.set('phishing:config', this.config);
    } catch (error) {
      console.error('Failed to save phishing config:', error);
      this.emit('phishing:error', error as Error);
    }
  }

  private updateSets(): void {
    this.blacklistSet = new Set(this.config.blacklist);
    this.whitelistSet = new Set(this.config.whitelist);
  }

  private scheduleUpdate(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }

    const now = Date.now();
    const timeSinceLastUpdate = now - this.config.lastFetchTime;
    const timeUntilNextUpdate = Math.max(0, this.config.cacheExpireTime - timeSinceLastUpdate);

    this.updateTimer = setTimeout(() => {
      this.updatePhishingList();
    }, timeUntilNextUpdate);
  }

  private async updatePhishingList(): Promise<void> {
    try {
      const response = await this.adapter.fetch('https://api.unisat.io/wallet-v4/phishing/list');
      
      if (response.ok) {
        const data = await response.json();
        
        this.config = {
          ...this.config,
          fuzzylist: data.fuzzylist || [],
          blacklist: data.blacklist || [],
          whitelist: data.whitelist || [],
          lastFetchTime: Date.now()
        };

        this.updateSets();
        await this.saveConfig();
        this.emit('phishing:updated', this.config);
        
        // Reschedule next update
        this.scheduleUpdate();
      }
    } catch (error) {
      console.error('Failed to update phishing list:', error);
      this.emit('phishing:error', error as Error);
      
      // Update failed, retry after 1 hour
      this.updateTimer = setTimeout(() => {
        this.updatePhishingList();
      }, 60 * 60 * 1000);
    }
  }

  private normalizeHostname(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, '');
  }

  private checkFuzzyMatch(hostname: string): string | null {
    if (!this.config.fuzzylist.length) {
      return null;
    }

    // Simple fuzzy matching implementation
    for (const pattern of this.config.fuzzylist) {
      if (this.isPhishingMatch(hostname, pattern)) {
        return pattern;
      }
    }

    return null;
  }

  private isPhishingMatch(hostname: string, pattern: string): boolean {
    // Basic fuzzy matching logic implementation
    const normalizedPattern = pattern.toLowerCase();
    const normalizedHostname = hostname.toLowerCase();

    // Check exact match
    if (normalizedHostname === normalizedPattern) {
      return true;
    }

    // Check subdomain match
    if (normalizedHostname.endsWith('.' + normalizedPattern)) {
      return true;
    }

    // Check edit distance
    return this.levenshteinDistance(normalizedHostname, normalizedPattern) <= this.config.tolerance;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];
    const len1 = str1.length;
    const len2 = str2.length;

    if (len1 === 0) return len2;
    if (len2 === 0) return len1;

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
      if (matrix[0]) {
        matrix[0][j] = j;
      }
    }

    // Calculate edit distance
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        const prevRow = matrix[i - 1];
        const currRow = matrix[i];
        const prevCell = matrix[i - 1]?.[j - 1];
        
        if (currRow && prevRow && typeof prevCell === 'number') {
          currRow[j] = Math.min(
            (prevRow[j] || 0) + 1,        // deletion
            (currRow[j - 1] || 0) + 1,    // insertion
            prevCell + cost               // substitution
          );
        }
      }
    }

    return matrix[len1]?.[len2] || 0;
  }
}