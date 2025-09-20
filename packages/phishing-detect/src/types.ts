/**
 * Phishing service types
 */

export interface PhishingConfig {
  version: number;
  tolerance: number;
  fuzzylist: string[];
  whitelist: string[];
  blacklist: string[];
  lastFetchTime: number;
  cacheExpireTime: number;
}

export interface PhishingCheckResult {
  isPhishing: boolean;
  reason?: string;
  matchedPattern?: string;
}

export interface PhishingAdapter {
  /**
   * Get stored data
   */
  get(key: string): Promise<any>;
  
  /**
   * Store data
   */
  set(key: string, value: any): Promise<void>;
  
  /**
   * HTTP request
   */
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

export interface PhishingServiceConfig {
  adapter: PhishingAdapter;
  logger?: any;
  t?: any;
}

export interface PhishingServiceEvents {
  'phishing:detected': (hostname: string, reason: string) => void;
  'phishing:updated': (config: PhishingConfig) => void;
  'phishing:error': (error: Error) => void;
}