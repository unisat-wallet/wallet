import { createStorageProvider, StorageContext } from '@unisat/wallet-state';

const _storage = {
  async get(key: string) {
    const val = localStorage.getItem(key);
    if (val === null) return '';
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  },
  async set(key: string, value: any) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

const storageValue = createStorageProvider(_storage);

export function StorageProvider({ children }: { children: React.ReactNode }) {
  return <StorageContext.Provider value={storageValue}>{children}</StorageContext.Provider>;
}
