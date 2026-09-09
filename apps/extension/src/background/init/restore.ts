import { EventEmitter } from 'events';
import logger from 'loglevel';

// init/restore.ts
import { i18nService } from '@/shared/utils/i18n';
import { ExtensionAdapter } from '@unisat/phishing-detect';
import {
  bgEventBus,
  contactBookService,
  keyringService,
  notificationService,
  permissionService,
  phishingDetectService,
  preferenceService,
  walletApiService,
  walletController
} from '@unisat/wallet-background';
import { CHAINS_MAP, bgI18n, t } from '@unisat/wallet-shared';
import { BaseProxyStorageAdapter } from '@unisat/wallet-storage';
import { ChainType } from '@unisat/wallet-types';

import { encryptor } from '../utils/encryptor';
import { HttpClient } from '../utils/http-client/httpClient';
import storage from '../utils/storage';

export const AppInitEvent = new EventEmitter();

class ExtensionStorageAdapter extends BaseProxyStorageAdapter {
  constructor(private storage) {
    super();
  }

  async get(key: string): Promise<any> {
    return this.storage.get(key);
  }

  async set(key: string, value: any): Promise<void> {
    await this.storage.set(key, value);
  }
}

let appStateRestored = false;

export async function restoreAppState() {
  try {
    const proxyStorage = new ExtensionStorageAdapter(storage);

    await i18nService.init({ storage: proxyStorage });
    bgI18n.t = i18nService.translate.bind(i18nService);
    bgI18n.changeLanguage = async (locale: string) => {
      await i18nService.changeLanguage(locale);
    };

    const keyringInit = keyringService.init({
      storage: proxyStorage,
      logger: logger,
      encryptor: encryptor,
      t: t,
      eventBus: bgEventBus
    });

    const preferenceInit = preferenceService.init({
      storage: proxyStorage,
      logger: logger,
      t: t,
      eventBus: bgEventBus as any
    });

    const httpClient = new HttpClient();
    const walletApiInit = walletApiService.init({
      storage: proxyStorage,
      logger: logger,
      httpClient: httpClient
    });

    const permissionInit = permissionService.init({
      storage: proxyStorage,
      logger: logger,
      autoSync: true
    });

    const contactBookInit = contactBookService.init({
      storage: proxyStorage,
      logger: logger
    });

    const adapter = new ExtensionAdapter();
    const phishingDetectInit = phishingDetectService.init({
      adapter,
      logger: logger,
      t: t
    });

    await Promise.all([
      keyringInit,
      preferenceInit,
      walletApiInit,
      permissionInit,
      contactBookInit,
      phishingDetectInit
    ]);

    let chainType = preferenceService.getChainType();
    if (!chainType || !CHAINS_MAP[chainType]) {
      chainType = ChainType.BITCOIN_MAINNET;
      preferenceService.setChainType(chainType);
    }
    await walletApiService.setEndpoint(CHAINS_MAP[chainType].endpoints[0]);

    await notificationService.init({
      storage: proxyStorage,
      logger: logger,
      api: walletApiService
    });

    appStateRestored = true;

    await walletController.setBackgroundInited(true);
  } catch (err) {
    console.error('[Background] Initialization failed', err);
  }
}

export function isAppStateRestored(): boolean {
  return appStateRestored;
}
