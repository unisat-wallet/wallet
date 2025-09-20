/**
 * Chrome extension storage adapter for phishing service
 */

import type { PhishingAdapter } from '../types';

export class ExtensionAdapter implements PhishingAdapter {
  async get(key: string): Promise<any> {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      throw new Error('Chrome extension storage not available');
    }

    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key]);
      });
    });
  }

  async set(key: string, value: any): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      throw new Error('Chrome extension storage not available');
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    return fetch(url, options);
  }
}