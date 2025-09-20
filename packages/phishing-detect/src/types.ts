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
   * 获取存储的数据
   */
  get(key: string): Promise<any>;
  
  /**
   * 存储数据
   */
  set(key: string, value: any): Promise<void>;
  
  /**
   * HTTP 请求
   */
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

export interface PhishingServiceEvents {
  'phishing:detected': (hostname: string, reason: string) => void;
  'phishing:updated': (config: PhishingConfig) => void;
  'phishing:error': (error: Error) => void;
}