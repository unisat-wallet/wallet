/**
 * Base storage adapter implementation
 */

import { debounce } from 'debounce'
import { ProxyStorageAdapter } from './types'

export abstract class BaseProxyStorageAdapter implements ProxyStorageAdapter {
  abstract get(key: string): Promise<any>
  abstract set(key: string, value: any): Promise<void>

  /**
   * Create a persistent proxy that automatically saves changes to storage
   */
  async createPersistentProxy<T extends object>(name: string, template: T): Promise<T> {
    let data = template

    // Try to load existing data
    try {
      const stored = await this.get(name)
      if (stored) {
        data = { ...template, ...stored }
      } else {
        // Save initial template
        await this.set(name, data)
      }
    } catch (error) {
      console.warn(`Failed to load stored data for ${name}, using template:`, error)
      await this.set(name, data)
    }

    // Create debounced save function
    const debouncedSave = debounce((target: T) => {
      this.set(name, target).catch(error => {
        console.error(`Failed to save preference data for ${name}:`, error)
      })
    }, 1000)

    // Create proxy to automatically persist changes
    const proxy = new Proxy(data, {
      set(target: any, prop: string | symbol, value: any) {
        target[prop] = value
        debouncedSave(target)
        return true
      },

      deleteProperty(target: any, prop: string | symbol) {
        if (Reflect.has(target, prop)) {
          Reflect.deleteProperty(target, prop)
          debouncedSave(target)
        }
        return true
      },
    })

    return proxy
  }
}
