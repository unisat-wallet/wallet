// Storage adapter interface
export interface ProxyStorageAdapter {
  get(key: string): Promise<any>
  set(key: string, value: any): Promise<void>
  createPersistentProxy<T extends object>(name: string, template: T): Promise<T>
}
