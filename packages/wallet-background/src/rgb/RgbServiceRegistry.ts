import { RgbService } from '@unisat/rgb-service'

import type { LocalRgbServiceContext, LocalRgbWallet } from './RgbWalletCoordinator'

type RgbServiceRegistryDependencies = {
  getWallet: () => Promise<LocalRgbWallet>
  createService: (wallet: LocalRgbWallet) => RgbService
}

/**
 * Owns LocalRgbService instances and makes first-use initialization atomic per
 * funding wallet. Controller methods remain responsible for API synchronization.
 */
export class RgbServiceRegistry {
  private readonly services = new Map<string, RgbService>()
  private readonly initializations = new Map<string, Promise<LocalRgbServiceContext>>()

  constructor(private readonly dependencies: RgbServiceRegistryDependencies) {}

  clear(): void {
    this.services.clear()
    this.initializations.clear()
  }

  async get(): Promise<LocalRgbServiceContext> {
    const wallet = await this.dependencies.getWallet()
    const key = walletKey(wallet)
    const service = this.services.get(key)
    if (service) return { service, wallet }

    const activeInitialization = this.initializations.get(key)
    if (activeInitialization) return activeInitialization

    const initialization = this.initialize(wallet, key)
    this.initializations.set(key, initialization)
    try {
      return await initialization
    } finally {
      if (this.initializations.get(key) === initialization) {
        this.initializations.delete(key)
      }
    }
  }

  private async initialize(wallet: LocalRgbWallet, key: string): Promise<LocalRgbServiceContext> {
    const service = this.dependencies.createService(wallet)
    await service.open(wallet)
    this.services.set(key, service)
    return { service, wallet }
  }
}

function walletKey(wallet: LocalRgbWallet): string {
  return `${wallet.network}:${wallet.fundingAddress}`
}
