/**
 * Background Manager - Unified service management for wallet background
 */

import { EventEmitter } from 'eventemitter3';
import type { 
  StorageAdapter, 
  NotificationAdapter, 
  NetworkAdapter, 
  PlatformAdapter 
} from './adapters';

export interface BackgroundManagerConfig {
  storage: StorageAdapter;
  notification: NotificationAdapter;
  network: NetworkAdapter;
  platform: PlatformAdapter;
}

export interface BackgroundManagerEvents {
  'service:ready': (serviceName: string) => void;
  'service:error': (serviceName: string, error: Error) => void;
  'manager:ready': () => void;
  'manager:error': (error: Error) => void;
}

export class BackgroundManager extends EventEmitter<BackgroundManagerEvents> {
  private adapters: BackgroundManagerConfig;
  private services: Map<string, any> = new Map();
  private initialized = false;

  constructor(config: BackgroundManagerConfig) {
    super();
    this.adapters = config;
  }

  /**
   * Initialize all background services
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize core services in dependency order
      await this.initializeServices();
      
      this.initialized = true;
      this.emit('manager:ready');
    } catch (error) {
      this.emit('manager:error', error as Error);
      throw error;
    }
  }

  /**
   * Get service instance by name
   */
  getService<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service ${name} not found`);
    }
    return service;
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get all adapters
   */
  getAdapters(): BackgroundManagerConfig {
    return this.adapters;
  }

  /**
   * Cleanup all services
   */
  async cleanup(): Promise<void> {
    for (const [name, service] of this.services.entries()) {
      try {
        if (typeof service.cleanup === 'function') {
          await service.cleanup();
        }
      } catch (error) {
        console.error(`Error cleaning up service ${name}:`, error);
      }
    }
    
    this.services.clear();
    this.initialized = false;
  }

  private async initializeServices(): Promise<void> {
    try {
      // Initialize services in dependency order
      
      // 1. Initialize base services first (no dependencies)
      await this.initializeSessionService();
      await this.initializeI18nService();
      
      // 2. Initialize core services (depend on base services)
      await this.initializeKeyringService();
      await this.initializePermissionService();
      await this.initializePreferenceService();
      await this.initializeContactBookService();
      await this.initializeNotificationService();
      
      // 3. Initialize API services (depend on core services)
      await this.initializeWalletApiService();
      await this.initializePhishingService();
      
      // 4. Initialize controllers (depend on services)
      await this.initializeWalletController();
      await this.initializePhishingController();
      await this.initializeProviderController();
      
      console.log('[BackgroundManager] All services initialized successfully');
    } catch (error) {
      console.error('[BackgroundManager] Service initialization failed:', error);
      throw error;
    }
  }

  private async initializeSessionService(): Promise<void> {
    const { sessionService } = await import('./services/session');
    await sessionService.init();
    this.services.set('session', sessionService);
    this.emit('service:ready', 'session');
  }

  private async initializeI18nService(): Promise<void> {
    const { i18n } = await import('./services/i18n');
    await i18n.init();
    this.services.set('i18n', i18n);
    this.emit('service:ready', 'i18n');
  }

  private async initializeKeyringService(): Promise<void> {
    const { keyringService } = await import('./services/keyring');
    await keyringService.init();
    this.services.set('keyring', keyringService);
    this.emit('service:ready', 'keyring');
  }

  private async initializePermissionService(): Promise<void> {
    const { default: permissionService } = await import('./services/permission');
    await permissionService.init();
    this.services.set('permission', permissionService);
    this.emit('service:ready', 'permission');
  }

  private async initializePreferenceService(): Promise<void> {
    const { default: preferenceService } = await import('./services/preference');
    await preferenceService.init();
    this.services.set('preference', preferenceService);
    this.emit('service:ready', 'preference');
  }

  private async initializeContactBookService(): Promise<void> {
    const { default: contactBookService } = await import('./services/contactBook');
    await contactBookService.init();
    this.services.set('contactBook', contactBookService);
    this.emit('service:ready', 'contactBook');
  }

  private async initializeNotificationService(): Promise<void> {
    const { default: notificationService } = await import('./services/notification');
    notificationService.setAdapter(this.adapters.notification);
    this.services.set('notification', notificationService);
    this.emit('service:ready', 'notification');
  }

  private async initializeWalletApiService(): Promise<void> {
    const { default: walletApiService } = await import('./services/walletapi');
    walletApiService.setNetworkAdapter(this.adapters.network);
    this.services.set('walletApi', walletApiService);
    this.emit('service:ready', 'walletApi');
  }

  private async initializePhishingService(): Promise<void> {
    const { default: phishingService } = await import('./services/phishing');
    await phishingService.init();
    this.services.set('phishing', phishingService);
    this.emit('service:ready', 'phishing');
  }

  private async initializeWalletController(): Promise<void> {
    const { default: walletController } = await import('./controllers/wallet');
    await walletController.init(this.adapters);
    this.services.set('wallet', walletController);
    this.emit('service:ready', 'wallet');
  }

  private async initializePhishingController(): Promise<void> {
    const { default: phishingController } = await import('./controllers/phishing');
    phishingController.setServices({
      phishing: this.getService('phishing'),
      preference: this.getService('preference')
    });
    this.services.set('phishingController', phishingController);
    this.emit('service:ready', 'phishingController');
  }

  private async initializeProviderController(): Promise<void> {
    const { default: providerController } = await import('./controllers/provider');
    providerController.setServices({
      wallet: this.getService('wallet'),
      permission: this.getService('permission'),
      keyring: this.getService('keyring'),
      preference: this.getService('preference'),
      phishing: this.getService('phishing')
    });
    this.services.set('provider', providerController);
    this.emit('service:ready', 'provider');
  }
}