import { keyringService, permissionService } from '../../services'
import { getTrustedProviderOrigin } from '../../utils/provider-origin'

import wallet from '../wallet'

const tabCheckin = ({
  data: {
    params: { name, icon },
  },
  session,
  port,
}) => {
  const trustedOrigin = getTrustedProviderOrigin(port?.sender)
  if (session.origin && session.origin !== trustedOrigin) {
    throw new Error('Request origin changed')
  }

  session.setProp({ origin: trustedOrigin, name, icon })
}

const getProviderState = async req => {
  const {
    session: { origin },
  } = req

  const isUnlocked = keyringService.memStore.getState().isUnlocked
  const accounts: string[] = []
  if (isUnlocked && permissionService.hasPermission(origin)) {
    const currentAccount = await wallet.getCurrentAccount()
    if (currentAccount) {
      accounts.push(currentAccount.address)
    }
  }
  return {
    network: wallet.getLegacyNetworkName(),
    isUnlocked,
    accounts,
  }
}

const keepAlive = () => {
  return 'ACK_KEEP_ALIVE_MESSAGE'
}

export default {
  tabCheckin,
  getProviderState,
  keepAlive,
}
