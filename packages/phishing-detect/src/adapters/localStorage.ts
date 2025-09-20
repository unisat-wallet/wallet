/**
 * LocalStorage adapter for phishing service (browser environments)
 */

import type { PhishingAdapter } from '../types';

export class LocalStorageAdapter implements PhishingAdapter {
  private prefix: string;

  constructor(prefix = 'unisat-phishing:') {
    this.prefix = prefix;
  }

  async get(key: string): Promise<any> {
    try {
      const item = localStorage.getItem(this.prefix + key);
      return item ? JSON.parse(item) : undefined;
    } catch (error) {
      console.error('Failed to get from localStorage:', error);
      return undefined;
    }
  }

  async set(key: string, value: any): Promise<void> {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (error) {
      console.error('Failed to set to localStorage:', error);
      throw error;
    }
  }

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    return fetch(url, options);
  }
}