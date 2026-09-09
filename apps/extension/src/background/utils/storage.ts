import { browserStorageLocalGet, browserStorageLocalSet } from '../webapi/browser';

const cacheMap = new Map<string, unknown>();
const loadedKeys = new Set<string>();
let allKeysLoaded = false;

const get = async (prop?: string) => {
  if (prop === undefined) {
    if (!allKeysLoaded) {
      const result = await browserStorageLocalGet(null);
      Object.entries(result).forEach(([key, value]) => {
        cacheMap.set(key, value);
        loadedKeys.add(key);
      });
      allKeysLoaded = true;
    }
    return Object.fromEntries(cacheMap);
  }

  if (loadedKeys.has(prop)) {
    return cacheMap.get(prop);
  }

  const result = await browserStorageLocalGet(prop);
  const value = result[prop];
  cacheMap.set(prop, value);
  loadedKeys.add(prop);
  return value;
};

const set = async (prop, value): Promise<void> => {
  await browserStorageLocalSet({ [prop]: value });
  cacheMap.set(prop, value);
  loadedKeys.add(prop);
};

const byteInUse = async (): Promise<number> => {
  return new Promise((resolve, reject) => {
    if (chrome) {
      chrome.storage.local.getBytesInUse((value) => {
        resolve(value);
      });
    } else {
      reject('ByteInUse only works in Chrome');
    }
  });
};

export default {
  get,
  set,
  byteInUse
};
