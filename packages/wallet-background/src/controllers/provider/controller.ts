import { bitcoin, verifyMessageOfBIP322Simple } from '@unisat/wallet-bitcoin'
import {
  RequestMethodDeriveContextHashParams,
  RequestMethodGetInscriptionsParams,
  RequestMethodSendBitcoinParams,
  RequestMethodSendInscriptionParams,
  RequestMethodSendRunesParams,
  RequestMethodSignMessageParams,
  RequestMethodSignMessagesParams,
  RequestMethodSignPsbtParams,
  RequestMethodSignPsbtsParams,
} from '@unisat/wallet-shared'
import { permissionService, sessionService, walletApiService } from '../../services'
import { getChainInfo, objToUint8Array } from '../../shared/utils'
import { amountToSatoshis } from '../../utils/bitcoin-utils'
import BaseController from '../base'
import wallet from '../wallet'

import {
  arbitrarySignDocToBytesHex,
  directSignDocToBytesHex,
  encodeSignature,
} from '@unisat/babylon-service'
import {
  CHAINS,
  CHAINS_MAP,
  NETWORK_TYPES,
  PlatformEnv,
  SESSION_EVENTS,
  SignMessageResult,
  SignMessageType,
  SignPsbtResult,
} from '@unisat/wallet-shared'
import { NetworkType } from '@unisat/wallet-types'
import { formatPsbtHex } from '../../utils/psbt-utils'

class ProviderController extends BaseController {
  protected override onInitialize(): Promise<void> {
    return Promise.resolve()
  }

  protected override onCleanup(): Promise<void> {
    return Promise.resolve()
  }

  requestAccounts = async ({ session: { origin } }) => {
    if (!permissionService.hasPermission(origin)) {
      throw new Error('Permission denied')
    }

    const _account = await wallet.getCurrentAccount()
    const account = _account ? [_account.address] : []
    sessionService.broadcastEvent(SESSION_EVENTS.accountsChanged, account)
    const connectSite = permissionService.getConnectedSite(origin)
    if (connectSite) {
      const network = wallet.getLegacyNetworkName()
      sessionService.broadcastEvent(
        SESSION_EVENTS.networkChanged,
        {
          network,
        },
        origin
      )
    }
    return account
  }

  disconnect = async ({ session: { origin } }) => {
    wallet.removeConnectedSite(origin)
  }

  @Reflect.metadata('SAFE', true)
  getAccounts = async ({ session: { origin } }) => {
    if (!permissionService.hasPermission(origin)) {
      return []
    }

    const _account = await wallet.getCurrentAccount()
    const account = _account ? [_account.address] : []
    return account
  }

  @Reflect.metadata('SAFE', true)
  getNetwork = async () => {
    return wallet.getLegacyNetworkName()
  }

  @Reflect.metadata('APPROVAL', [
    'SwitchNetwork',
    // @ts-ignore
    async req => {
      const network = req.data.params.network
      if (NETWORK_TYPES[NetworkType.MAINNET]!.validNames.includes(network)) {
        req.data.params.networkType = NetworkType.MAINNET
      } else if (NETWORK_TYPES[NetworkType.TESTNET]!.validNames.includes(network)) {
        req.data.params.networkType = NetworkType.TESTNET
      } else {
        throw new Error(
          `the network is invalid, supported networks: ${NETWORK_TYPES.map(v => v.name).join(',')}`
        )
      }

      if (req.data.params.networkType === wallet.getNetworkType()) {
        // skip approval
        return true
      }
    },
  ])
  switchNetwork = async req => {
    const {
      data: {
        params: { networkType },
      },
    } = req
    wallet.setNetworkType(networkType)
    return NETWORK_TYPES[networkType]!.name
  }

  @Reflect.metadata('SAFE', true)
  getChain = async () => {
    const chainType = wallet.getChainType()
    return getChainInfo(chainType)
  }

  @Reflect.metadata('APPROVAL', [
    'SwitchChain',
    async req => {
      const chainType = req.data.params.chain
      if (!CHAINS_MAP[chainType]) {
        throw new Error(
          `the chain is invalid, supported chains: ${CHAINS.map(v => v.enum).join(',')}`
        )
      }

      if (chainType == wallet.getChainType()) {
        // skip approval
        return true
      }
      return false
    },
  ])
  switchChain = async req => {
    const {
      data: {
        params: { chain },
      },
    } = req
    wallet.setChainType(chain)
    return getChainInfo(chain)
  }

  @Reflect.metadata('SAFE', true)
  getPublicKey = async () => {
    const account = await wallet.getCurrentAccount()
    if (!account) return ''
    return account.pubkey
  }

  @Reflect.metadata('SAFE', true)
  getInscriptions = async req => {
    const params: RequestMethodGetInscriptionsParams = req.data.params
    const { cursor, size } = params
    if (typeof cursor !== 'number' || typeof size !== 'number') {
      throw new Error('cursor and size is required')
    }

    const account = await wallet.getCurrentAccount()
    if (!account) return ''
    const { list, total } = await walletApiService.inscriptions.getAddressInscriptions(
      account.address,
      cursor,
      size
    )
    return { list, total }
  }

  @Reflect.metadata('SAFE', true)
  getBalance = async () => {
    const account = await wallet.getCurrentAccount()
    if (!account) return null
    const balance = await wallet.getAddressBalance(account.address)
    return {
      confirmed: amountToSatoshis(balance.confirm_amount),
      unconfirmed: amountToSatoshis(balance.pending_amount),
      total: amountToSatoshis(balance.amount),
    }
  }

  @Reflect.metadata('SAFE', true)
  getBalanceV2 = async () => {
    const account = await wallet.getCurrentAccount()
    if (!account) return null
    const balance = await wallet.getAddressBalanceV2(account.address)
    return {
      available: balance.availableBalance,
      unavailable: balance.unavailableBalance,
      total: balance.totalBalance,
    }
  }

  @Reflect.metadata('SAFE', true)
  verifyMessageOfBIP322Simple = async req => {
    const {
      data: { params },
    } = req
    return verifyMessageOfBIP322Simple(
      params.address,
      params.message,
      params.signature,
      params.network
    )
      ? 1
      : 0
  }

  @Reflect.metadata('APPROVAL', [
    'SignPsbt',
    async req => {
      const params: RequestMethodSendBitcoinParams = req.data.params
      if (!params.sendBitcoinParams.toAddress) {
        throw new Error('toAddress is required')
      }
      if (!params.sendBitcoinParams.satoshis) {
        throw new Error('satoshis is required')
      }
      const toSignData = await wallet.createSendBTCPsbt({
        to: params.sendBitcoinParams.toAddress,
        amount: params.sendBitcoinParams.satoshis,
        feeRate: params.sendBitcoinParams.feeRate!,
        memo: params.sendBitcoinParams.memo!,
        memos: params.sendBitcoinParams.memos!,
      })
      params.toSignDatas = [toSignData]
    },
  ])
  sendBitcoin = async ({ approvalRes }: { approvalRes: SignPsbtResult }) => {
    const psbt = bitcoin.Psbt.fromHex(approvalRes[0]!.psbtHex!)
    const tx = psbt.extractTransaction(true)
    const rawtx = tx.toHex()
    return await wallet.pushTx(rawtx)
  }

  @Reflect.metadata('APPROVAL', [
    'SignPsbt',
    async req => {
      const params: RequestMethodSendInscriptionParams = req.data.params
      if (!params.sendInscriptionParams.toAddress) {
        throw new Error('toAddress is required')
      }
      if (!params.sendInscriptionParams.inscriptionId) {
        throw new Error('inscriptionId is required')
      }
      const toSignData = await wallet.createSendInscriptionPsbt({
        to: params.sendInscriptionParams.toAddress,
        inscriptionId: params.sendInscriptionParams.inscriptionId,
        feeRate: params.sendInscriptionParams.feeRate!,
      })
      params.toSignDatas = [toSignData]
    },
  ])
  sendInscription = async ({ approvalRes }: { approvalRes: SignPsbtResult }) => {
    const psbt = bitcoin.Psbt.fromHex(approvalRes[0]!.psbtHex!)
    const tx = psbt.extractTransaction(true)
    const rawtx = tx.toHex()
    return await wallet.pushTx(rawtx)
  }

  @Reflect.metadata('APPROVAL', [
    'SignPsbt',
    async req => {
      const params: RequestMethodSendRunesParams = req.data.params
      if (!params.sendRunesParams.toAddress) {
        throw new Error('toAddress is required')
      }
      if (!params.sendRunesParams.runeid) {
        throw new Error('runeid is required')
      }
      if (!params.sendRunesParams.amount) {
        throw new Error('amount is required')
      }
      const toSignData = await wallet.createSendRunesPsbt({
        to: params.sendRunesParams.toAddress,
        runeid: params.sendRunesParams.runeid,
        runeAmount: params.sendRunesParams.amount,
        feeRate: params.sendRunesParams.feeRate!,
      })
      params.toSignDatas = [toSignData]
    },
  ])
  sendRunes = async ({ approvalRes }: { approvalRes: SignPsbtResult }) => {
    const psbt = bitcoin.Psbt.fromHex(approvalRes[0]!.psbtHex!)
    const tx = psbt.extractTransaction(true)
    const rawtx = tx.toHex()
    return await wallet.pushTx(rawtx)
  }

  @Reflect.metadata('APPROVAL', [
    'SignMessage',
    async req => {
      const params: RequestMethodSignMessageParams = req.data.params
      if (!params.text) {
        throw new Error('text is required')
      }
      params.toSignMessages = [
        { text: params.text, type: (params.type as any) || SignMessageType.ECDSA },
      ]
    },
  ])
  signMessage = async ({ approvalRes }: { approvalRes: SignMessageResult }) => {
    return approvalRes[0]!.signature
  }

  @Reflect.metadata('SAFE', true)
  pushTx = async ({
    data: {
      params: { rawtx },
    },
  }) => {
    return await wallet.pushTx(rawtx)
  }

  @Reflect.metadata('APPROVAL', [
    'SignPsbt',
    async req => {
      const params: RequestMethodSignPsbtParams = req.data.params
      if (!params.psbtHex) {
        throw new Error('psbtHex is required')
      }

      const psbtHex = formatPsbtHex(params.psbtHex)
      const toSignData = await wallet.getToSignData({
        psbtHex,
        options: params.options,
      })
      params.toSignDatas = [toSignData]
    },
  ])
  signPsbt = async ({ approvalRes }: { approvalRes: SignPsbtResult }) => {
    return approvalRes[0]!.psbtHex
  }

  @Reflect.metadata('APPROVAL', [
    'SignPsbt',
    async req => {
      const params: RequestMethodSignPsbtsParams = req.data.params
      if (!params.psbtHexs) {
        throw new Error('psbtHex is required')
      }

      params.toSignDatas = []
      for (let i = 0; i < params.psbtHexs.length; i++) {
        const psbtHex = formatPsbtHex(params.psbtHexs[i]!)
        const toSignData = await wallet.getToSignData({
          psbtHex,
          options: params.options ? params.options[i] : undefined,
        })
        params.toSignDatas.push(toSignData)
      }
      delete params.psbtHexs
      delete params.options
    },
  ])
  multiSignPsbt = async ({ approvalRes }: { approvalRes: SignPsbtResult }) => {
    return approvalRes.map(v => v.psbtHex)
  }

  @Reflect.metadata('APPROVAL', [
    'SignMessage',
    async req => {
      const params: RequestMethodSignMessagesParams = req.data.params
      if (params.messages.length == 0) {
        throw new Error('data is required')
      }
      for (let i = 0; i < params.messages.length; i++) {
        const message = params.messages[i]!
        if (!message.text) {
          throw new Error('text is required')
        }
        if (message.text.length > 10000) {
          throw new Error('text is too long')
        }
      }

      params.toSignMessages = params.messages.map(v => ({
        text: v.text,
        type: (v.type || SignMessageType.ECDSA) as any,
      }))
    },
  ])
  multiSignMessage = async ({ approvalRes }: { approvalRes: SignMessageResult }) => {
    return approvalRes.map(v => v.signature)
  }

  @Reflect.metadata('SAFE', true)
  pushPsbt = async ({
    data: {
      params: { psbtHex },
    },
  }) => {
    const hexData = formatPsbtHex(psbtHex)
    const psbt = bitcoin.Psbt.fromHex(hexData)
    try {
      psbt.finalizeAllInputs()
    } catch (e) {
      // ignore
    }
    const tx = psbt.extractTransaction(true)
    const rawtx = tx.toHex()
    return await wallet.pushTx(rawtx)
  }

  @Reflect.metadata('APPROVAL', [
    'InscribeTransfer',
    async req => {
      const {
        data: {
          params: { ticker },
        },
      } = req
      // todo
    },
  ])
  inscribeTransfer = async ({ approvalRes }) => {
    return approvalRes
  }

  @Reflect.metadata('SAFE', true)
  getVersion = async () => {
    return PlatformEnv.VERSION
  }

  @Reflect.metadata('SAFE', true)
  isAtomicalsEnabled = async () => {
    return false
  }

  @Reflect.metadata('SAFE', true)
  getBitcoinUtxos = async () => {
    const account = await wallet.getCurrentAccount()
    if (!account) return []
    const utxos = await wallet.getBTCUtxos()
    return utxos
  }

  private _isKeystoneWallet = async () => {
    const currentKeyring = await wallet.getCurrentKeyring()
    return currentKeyring?.type === 'keystone'
  }

  @Reflect.metadata('APPROVAL', [
    'CosmosConnect',
    req => {
      // todo check
    },
  ])
  cosmosEnable = async ({
    data: {
      params: { chainId },
    },
  }) => {
    if (!wallet.cosmosChainInfoMap[chainId]) {
      throw new Error('Not supported chainId')
    }
  }

  @Reflect.metadata('SAFE', true)
  cosmosExperimentalSuggestChain = async ({
    data: {
      params: { chainData },
    },
  }) => {
    // const chainInfo:CosmosChainInfo = chainData;
    // if(chainInfo.chainId && !wallet.cosmosChainInfoMap[chainInfo.chainId]){
    //   wallet.cosmosChainInfoMap[chainInfo.chainId] = chainInfo;
    // }

    throw new Error('not implemented')
  }

  @Reflect.metadata('SAFE', true)
  cosmosGetKey = async ({
    data: {
      params: { chainId },
    },
  }): Promise<any> => {
    const cosmosKeyring = await wallet.getCosmosKeyring(chainId)
    if (!cosmosKeyring) {
      return null
    }

    const key = cosmosKeyring.getKey()
    const _key = Object.assign({}, key, {
      address: key.address.toString(),
      pubKey: key.pubKey.toString(),
    })
    return _key
  }

  @Reflect.metadata('APPROVAL', [
    'CosmosSign',
    async req => {
      const signDoc = req.data.params.signDoc
      req.data.params.signBytesHex = directSignDocToBytesHex(signDoc)
    },
  ])
  cosmosSignDirect = async ({ data: { params: msg }, approvalRes }) => {
    if (!approvalRes) {
      throw new Error('approvalRes is required')
    }
    const { bodyBytes, authInfoBytes, chainId, accountNumber } = msg.signDoc
    const signature = encodeSignature(approvalRes.publicKey, approvalRes.signature)
    const respone = {
      signed: {
        bodyBytes: objToUint8Array(bodyBytes),
        authInfoBytes: objToUint8Array(authInfoBytes),
        chainId,
        accountNumber,
      },
      signature,
    }
    return respone
  }

  @Reflect.metadata('APPROVAL', [
    'CosmosSign',
    async req => {
      const signerAddress = req.data.params.signerAddress
      const data = req.data.params.data
      req.data.params.signBytesHex = arbitrarySignDocToBytesHex(signerAddress, data)
    },
  ])
  cosmosSignArbitrary = async ({ data: { params: msg }, approvalRes }) => {
    if (!approvalRes) {
      throw new Error('approvalRes is required')
    }

    const respone = encodeSignature(approvalRes.publicKey, approvalRes.signature)
    return respone
  }
  @Reflect.metadata('APPROVAL', [
    'DeriveContextHash',
    async req => {
      const params: RequestMethodDeriveContextHashParams = req.data.params
      // Validate appName
      if (!params.appName || typeof params.appName !== 'string') {
        throw new Error('appName is required and must be a string')
      }
      if (params.appName.length === 0) {
        throw new Error('appName must be non-empty')
      }
      const appNameBytes = new TextEncoder().encode(params.appName)
      if (appNameBytes.length > 64) {
        throw new Error('appName must be at most 64 bytes')
      }
      if (!/^[a-z0-9\-]+$/.test(params.appName)) {
        throw new Error('appName must contain only lowercase letters, digits, and hyphens')
      }
      // Validate context
      if (!params.context || typeof params.context !== 'string') {
        throw new Error('context is required and must be a string')
      }
      if (params.context.length === 0) {
        throw new Error('context must be non-empty')
      }
      if (params.context.startsWith('0x') || params.context.startsWith('0X')) {
        throw new Error('context must not have a 0x prefix')
      }
      if (params.context.length % 2 !== 0) {
        throw new Error('context must be an even-length hex string')
      }
      if (params.context.length > 2048) {
        throw new Error('context must not exceed 2048 hex characters (1024 bytes)')
      }
      if (!/^[0-9a-f]+$/.test(params.context)) {
        throw new Error('context must be a lowercase hex string')
      }
    },
  ])
  deriveContextHash = async ({
    data: {
      params: { appName, context },
    },
  }) => {
    return await wallet.deriveContextHash(appName, context)
  }
}

export default new ProviderController()
