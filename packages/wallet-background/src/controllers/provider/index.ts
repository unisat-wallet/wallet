// Provider controller for handling RPC requests
import { WalletError, ErrorCodes } from '../../utils/error'
import internalMethod from './internalMethod'
import rpcFlow from './rpcFlow'

class ProviderController {
  private services: any = {}

  setServices(services: any) {
    this.services = services
  }

  async handleRequest(req: any) {
    const {
      data: { method },
    } = req

    if (internalMethod[method]) {
      return internalMethod[method](req)
    }

    const hasVault = this.services.keyring?.hasVault()
    if (!hasVault) {
      throw new WalletError(ErrorCodes.UserCancel, 'wallet must has at least one account')
    }
    return rpcFlow(req)
  }
}

export default new ProviderController()
