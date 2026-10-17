import { bitcoin, scriptPkToAddress, toPsbtNetwork, verifyMessageOfBIP322Simple, verifyMessageOfECDSA } from '@unisat/wallet-bitcoin'
import { assertValidFeeRate } from '@unisat/base-utils'
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
  AccountSignMethod,
  SignMessageResult,
  SignMessageType,
  SignPsbtResult,
  ToSignData,
  ToSignMessage,
  getAccountCapabilities,
  hasOwn,
  isSupportedChainType,
} from '@unisat/wallet-shared'
import { NetworkType } from '@unisat/wallet-types'
import { formatPsbtHex } from '../../utils/psbt-utils'

function validateRgbProviderFeeRate(req: { data: { params: { feeRate?: number } } }) {
  const { feeRate } = req.data.params
  if (feeRate !== undefined) assertValidFeeRate(feeRate, { supportLowFeeMode: true })
}

function assertReadonlyMessageSignature(
  account: Awaited<ReturnType<typeof wallet.getCurrentAccount>>,
  toSignMessage: ToSignMessage,
  signature?: string
) {
  if (!account || getAccountCapabilities(account).signMethod !== AccountSignMethod.External) return

  let verified = false
  if (signature) {
    if (toSignMessage.type === SignMessageType.BIP322_SIMPLE) {
      verified = verifyMessageOfBIP322Simple(
        account.address,
        toSignMessage.text,
        signature,
        wallet.getNetworkType()
      )
    } else {
      verified = verifyMessageOfECDSA(account.pubkey, toSignMessage.text, signature)
    }
  }

  if (!verified) {
    throw new Error('invalid signature')
  }
}

function assertSameUnsignedTx(psbt: bitcoin.Psbt, sourcePsbt: bitcoin.Psbt) {
  const hasSameInputs =
    psbt.txInputs.length === sourcePsbt.txInputs.length &&
    psbt.txInputs.every((input, index) => {
      const sourceInput = sourcePsbt.txInputs[index]
      return (
        sourceInput &&
        input.hash.equals(sourceInput.hash) &&
        input.index === sourceInput.index &&
        input.sequence === sourceInput.sequence
      )
    })
  const hasSameOutputs =
    psbt.txOutputs.length === sourcePsbt.txOutputs.length &&
    psbt.txOutputs.every((output, index) => {
      const sourceOutput = sourcePsbt.txOutputs[index]
      return (
        sourceOutput &&
        output.value === sourceOutput.value &&
        output.script.equals(sourceOutput.script)
      )
    })

  if (!hasSameInputs || !hasSameOutputs) {
    throw new Error('invalid psbt')
  }
}

function assertRequiredSignatures(psbt: bitcoin.Psbt, toSignData: ToSignData) {
  const hasRequiredSignatures = toSignData.toSignInputs.every(toSignInput => {
    const input = psbt.data.inputs[toSignInput.index]
    if (!input) return false

    if (
      input.finalScriptSig ||
      input.finalScriptWitness ||
      input.tapKeySig ||
      input.tapScriptSig?.length
    ) {
      return true
    }

    return input.partialSig?.some(sig => sig.pubkey.toString('hex') === toSignInput.publicKey)
  })

  if (!hasRequiredSignatures) {
    throw new Error('invalid psbt')
  }
}

function assertReadonlySignedPsbt(
  account: Awaited<ReturnType<typeof wallet.getCurrentAccount>>,
  toSignData: ToSignData,
  psbtHex?: string
) {
  if (!account || getAccountCapabilities(account).signMethod !== AccountSignMethod.External) return
  if (!psbtHex) throw new Error('invalid psbt')

  const psbt = bitcoin.Psbt.fromHex(psbtHex)
  const sourcePsbt = bitcoin.Psbt.fromHex(toSignData.psbtHex)
  assertSameUnsignedTx(psbt, sourcePsbt)
  assertRequiredSignatures(psbt, toSignData)

  if (toSignData.autoFinalized !== false) {
    psbt.finalizeAllInputs()
    psbt.extractTransaction(true)
  }
}

type RgbIssueWalletOrder = {
  status: string; network: string; address: string; ticker: string; name: string;
  precision: number; amount: string; feeSats: number; feeAddress: string; paymentTxid?: string
}

async function getRgbIssueWalletOrder(orderId: string): Promise<RgbIssueWalletOrder> {
  if (!/^\d{6}-RGB20-[A-Z0-9]{8}$/.test(orderId)) throw new Error('invalid RGB issue order ID')
  const walletApiUrl = CHAINS_MAP[wallet.getChainType()]?.endpoints[0]
  if (!walletApiUrl) throw new Error('RGB issuance orders are unavailable on this network')
  const response = await fetch(`${walletApiUrl}/v5/rgb/issue/order/${orderId}`)
  if (!response.ok) {
    throw new Error(response.status === 404
      ? 'RGB issuance order verification is unavailable in wallet API (HTTP 404)'
      : `unable to verify RGB issuance order (wallet API HTTP ${response.status})`)
  }
  const payload = await response.json() as { code: number; data?: RgbIssueWalletOrder }
  if (payload.code !== 0 || !payload.data) throw new Error('unable to verify RGB issuance order')
  return payload.data
}

async function claimRgbIssueWalletPayment(orderId: string, txid: string): Promise<RgbIssueWalletOrder> {
  const walletApiUrl = CHAINS_MAP[wallet.getChainType()]?.endpoints[0]
  if (!walletApiUrl) throw new Error('RGB issuance orders are unavailable on this network')
  let lastError: Error | undefined
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await fetch(`${walletApiUrl}/v5/rgb/issue/order/${orderId}/claim-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid }),
      })
      if (!response.ok) throw new Error(`wallet API payment verification failed (HTTP ${response.status})`)
      const payload = await response.json() as { code: number; msg?: string; data?: RgbIssueWalletOrder }
      if (payload.code === 0 && payload.data?.status === 'paid' && payload.data.paymentTxid === txid) {
        return payload.data
      }
      throw new Error(payload.msg || 'RGB issue payment is not visible yet')
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (/invalid|insufficient|predates|order wallet|network mismatch/i.test(lastError.message)) break
      if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 1500))
    }
  }
  throw lastError || new Error('RGB issue payment is not visible yet')
}

function restoreCounterpartyFinalizedInputs(
  signedPsbt: bitcoin.Psbt,
  sourcePsbt: bitcoin.Psbt,
  buyerInputIndexes: Set<number>
) {
  for (let index = 0; index < signedPsbt.inputCount; index++) {
    if (buyerInputIndexes.has(index)) continue
    const source = sourcePsbt.data.inputs[index]!
    const signed = signedPsbt.data.inputs[index]!
    // Only restore final scripts produced locally from the exact maker PSBT;
    // never copy buyer data and never alter the unsigned transaction.
    if (source.finalScriptSig && !signed.finalScriptSig) signed.finalScriptSig = source.finalScriptSig
    if (source.finalScriptWitness && !signed.finalScriptWitness) signed.finalScriptWitness = source.finalScriptWitness
  }
}

/** bitcoinjs interprets an omitted type as DEFAULT for P2TR, ALL otherwise. */
function effectiveInputSighashType(input: bitcoin.Psbt['data']['inputs'][number]) {
  const script = input.witnessUtxo?.script
  const isTaproot = Boolean(script && script.length === 34 && script[0] === 0x51 && script[1] === 0x20)
  // A non-taproot input with an encoded zero follows bitcoinjs' `|| ALL`
  // behavior, while a P2TR zero is the valid SIGHASH_DEFAULT value.
  if (input.sighashType === undefined) {
    return isTaproot ? bitcoin.Transaction.SIGHASH_DEFAULT : bitcoin.Transaction.SIGHASH_ALL
  }
  return input.sighashType === bitcoin.Transaction.SIGHASH_DEFAULT && !isTaproot
    ? bitcoin.Transaction.SIGHASH_ALL
    : input.sighashType
}

function getToSignDatas(toSignDatas?: ToSignData[]) {
  if (!toSignDatas?.length) {
    throw new Error('invalid psbt')
  }
  return toSignDatas
}

/** Prepared RGB payments remain bound to their creating dApp after a worker restart. */
async function assertRgbPaymentOrigin(transferId: string, origin: string) {
  if ((await wallet.getRgbPaymentOrigin({ transferId })) !== origin) {
    throw new Error('RGB payment is not available to this site')
  }
}

export async function getPsbtToSignData(psbt: string, options?: { [key: string]: any }) {
  const psbtHex = formatPsbtHex(psbt)
  return wallet.getToSignData({ psbtHex, ...(options ? { options } : {}) })
}

function getToSignMessages(toSignMessages?: ToSignMessage[]) {
  if (!toSignMessages?.length) {
    throw new Error('invalid message')
  }
  toSignMessages.forEach(message => assertValidMessageText(message.text))
  return toSignMessages
}

function assertValidMessageText(text: unknown): asserts text is string {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('text is required and must be a string')
  }
  if (text.length > 10000) {
    throw new Error('text is too long')
  }
}

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
      if (!isSupportedChainType(chainType)) {
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
    if (!isSupportedChainType(chain)) {
      throw new Error(
        `the chain is invalid, supported chains: ${CHAINS.map(v => v.enum).join(',')}`
      )
    }
    await wallet.setChainType(chain)
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
  sendBitcoin = async ({
    data: { params },
    approvalRes,
  }: {
    data: { params: RequestMethodSendBitcoinParams }
    approvalRes: SignPsbtResult
  }) => {
    const account = await wallet.getCurrentAccount()
    assertReadonlySignedPsbt(
      account,
      getToSignDatas(params.toSignDatas)[0]!,
      approvalRes[0]!.psbtHex
    )
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
  sendInscription = async ({
    data: { params },
    approvalRes,
  }: {
    data: { params: RequestMethodSendInscriptionParams }
    approvalRes: SignPsbtResult
  }) => {
    const account = await wallet.getCurrentAccount()
    assertReadonlySignedPsbt(
      account,
      getToSignDatas(params.toSignDatas)[0]!,
      approvalRes[0]!.psbtHex
    )
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
  sendRunes = async ({
    data: { params },
    approvalRes,
  }: {
    data: { params: RequestMethodSendRunesParams }
    approvalRes: SignPsbtResult
  }) => {
    const account = await wallet.getCurrentAccount()
    assertReadonlySignedPsbt(
      account,
      getToSignDatas(params.toSignDatas)[0]!,
      approvalRes[0]!.psbtHex
    )
    const psbt = bitcoin.Psbt.fromHex(approvalRes[0]!.psbtHex!)
    const tx = psbt.extractTransaction(true)
    const rawtx = tx.toHex()
    return await wallet.pushTx(rawtx)
  }

  @Reflect.metadata('APPROVAL', [
    'SignMessage',
    async req => {
      const params: RequestMethodSignMessageParams = req.data.params
      assertValidMessageText(params.text)
      params.toSignMessages = [
        { text: params.text, type: (params.type as any) || SignMessageType.ECDSA },
      ]
    },
  ])
  signMessage = async ({
    data: { params },
    approvalRes,
  }: {
    data: { params: RequestMethodSignMessageParams }
    approvalRes: SignMessageResult
  }) => {
    const account = await wallet.getCurrentAccount()
    assertReadonlyMessageSignature(
      account,
      getToSignMessages(params.toSignMessages)[0]!,
      approvalRes[0]!.signature
    )
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

      const toSignData = await getPsbtToSignData(params.psbtHex, params.options)
      params.toSignDatas = [toSignData]
    },
  ])
  signPsbt = async ({
    data: { params },
    approvalRes,
  }: {
    data: { params: RequestMethodSignPsbtParams }
    approvalRes: SignPsbtResult
  }) => {
    const account = await wallet.getCurrentAccount()
    const toSignData = getToSignDatas(params.toSignDatas)[0]!
    assertReadonlySignedPsbt(account, toSignData, approvalRes[0]!.psbtHex)
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
        const toSignData = await getPsbtToSignData(params.psbtHexs[i]!, params.options?.[i])
        params.toSignDatas.push(toSignData)
      }
      delete params.psbtHexs
      delete params.options
    },
  ])
  multiSignPsbt = async ({
    data: { params },
    approvalRes,
  }: {
    data: { params: RequestMethodSignPsbtsParams }
    approvalRes: SignPsbtResult
  }) => {
    const account = await wallet.getCurrentAccount()
    getToSignDatas(params.toSignDatas).forEach((toSignData, index) => {
      assertReadonlySignedPsbt(account, toSignData, approvalRes[index]!.psbtHex)
    })
    return approvalRes.map(v => v.psbtHex)
  }

  @Reflect.metadata('APPROVAL', [
    'SignMessage',
    async req => {
      const params: RequestMethodSignMessagesParams = req.data.params
      if (!Array.isArray(params.messages) || params.messages.length === 0) {
        throw new Error('data is required')
      }
      for (let i = 0; i < params.messages.length; i++) {
        const message = params.messages[i]!
        assertValidMessageText(message?.text)
      }

      params.toSignMessages = params.messages.map(v => ({
        text: v.text,
        type: (v.type || SignMessageType.ECDSA) as any,
      }))
    },
  ])
  multiSignMessage = async ({
    data: { params },
    approvalRes,
  }: {
    data: { params: RequestMethodSignMessagesParams }
    approvalRes: SignMessageResult
  }) => {
    const account = await wallet.getCurrentAccount()
    getToSignMessages(params.toSignMessages).forEach((toSignMessage, index) => {
      assertReadonlyMessageSignature(account, toSignMessage, approvalRes[index]!.signature)
    })
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

  @Reflect.metadata('SAFE', true)
  getRgbAssets = async ({
    data: {
      params: { page = 1, pageSize = 50 },
    },
  }) => {
    return wallet.getRGBList('', page, pageSize, { skipSync: true })
  }

  @Reflect.metadata('SAFE', true)
  getRgbFundingUtxos = async ({ data: { params } }: { data: { params: { assetId: string } } }) => {
    if (!params.assetId) throw new Error('assetId is required')
    return wallet.getRgbFundingUtxos({ assetId: params.assetId })
  }

  @Reflect.metadata('SAFE', true)
  getRgbFeeUtxos = async () => wallet.getRgbFeeUtxos()

  @Reflect.metadata('SAFE', true)
  getRgbIssueAvailability = async () => wallet.getRgbAllocationSummary({ skipSync: false })

  @Reflect.metadata('APPROVAL', ['RgbIssue', async req => {
    const params = req.data.params as {
      orderId: string; ticker: string; name: string; precision: number; amount: string;
      paymentTxid?: string; toSignData?: ToSignData
    }
    if (!/^[1-9][0-9]*$/.test(params.amount)) throw new Error('invalid RGB issue amount')
    const order = await getRgbIssueWalletOrder(params.orderId)
    const account = await wallet.getCurrentAccount()
    if (!account || order.network !== wallet.getChainType() || order.address !== account.address ||
        order.ticker !== params.ticker || order.name !== params.name ||
        order.precision !== params.precision || order.amount !== params.amount ||
        !Number.isSafeInteger(order.feeSats) || order.feeSats < 546 || !order.feeAddress ||
        !['pending', 'paid'].includes(order.status)) {
      throw new Error('RGB issuance order does not match this wallet')
    }
    delete params.toSignData
    if (params.paymentTxid && !/^[0-9a-f]{64}$/i.test(params.paymentTxid)) {
      throw new Error('invalid RGB issue payment transaction ID')
    }
    if (order.status === 'pending' && !params.paymentTxid) {
      const prepared = await wallet.createRgbUtxosBegin({
        num: 1,
        payment: { address: order.feeAddress, satoshis: order.feeSats },
        issue: { ticker: order.ticker, name: order.name, amount: order.amount, precision: order.precision },
      })
      params.toSignData = prepared.toSignData
    }
  }])
  issueRgbNia = async ({ data: { params }, approvalRes }: {
    data: { params: {
      orderId: string; ticker: string; name: string; precision: number; amount: string;
      paymentTxid?: string; toSignData?: ToSignData
    } }
    approvalRes?: { signedPsbt?: string }
  }) => {
    if (!/^[1-9][0-9]*$/.test(params.amount)) throw new Error('invalid RGB issue amount')
    const currentAccount = await wallet.getCurrentAccount()
    if (!currentAccount) throw new Error('no current account')
    let order = await getRgbIssueWalletOrder(params.orderId)
    if (!['pending', 'paid'].includes(order.status) || order.network !== wallet.getChainType() ||
        order.address !== currentAccount.address ||
        order.ticker !== params.ticker || order.name !== params.name ||
        order.precision !== params.precision || order.amount !== params.amount ||
        !Number.isSafeInteger(order.feeSats) || order.feeSats < 546) {
      throw new Error('RGB issuance order does not match this wallet')
    }
    let paymentTxid = order.paymentTxid || params.paymentTxid
    if (params.toSignData) {
      const signedPsbt = approvalRes?.signedPsbt
      if (!signedPsbt) throw new Error('RGB funding transaction was not signed')
      assertReadonlySignedPsbt(currentAccount, params.toSignData, signedPsbt)
      if (order.status !== 'pending') throw new Error('RGB issuance order changed during signing')
      const transaction = bitcoin.Psbt.fromHex(signedPsbt).extractTransaction(true)
      const paid = transaction.outs
        .filter(output => scriptPkToAddress(output.script, wallet.getNetworkType()) === order.feeAddress)
        .reduce((sum, output) => sum + Number(output.value), 0)
      if (paid < order.feeSats) throw new Error('RGB issuance transaction is missing the service fee')
      const funded = await wallet.createRgbUtxosEnd({ signedPsbt })
      paymentTxid = funded.txid
    }
    if (!paymentTxid || !/^[0-9a-f]{64}$/i.test(paymentTxid)) {
      throw new Error('RGB issuance payment transaction ID is missing')
    }
    if (order.status === 'pending') {
      try {
        order = await claimRgbIssueWalletPayment(params.orderId, paymentTxid)
      } catch (error) {
        return { status: 'payment_pending', paymentTxid, error: error instanceof Error ? error.message : String(error) }
      }
    }
    if (order.status !== 'paid' || order.paymentTxid !== paymentTxid ||
        order.network !== wallet.getChainType() || order.address !== currentAccount.address ||
        order.ticker !== params.ticker || order.name !== params.name ||
        order.precision !== params.precision || order.amount !== params.amount) {
      throw new Error('RGB issuance order does not match the paid transaction')
    }
    try {
      const issued = await wallet.createRgbIssueNia({
        orderId: params.orderId,
        ticker: params.ticker,
        name: params.name,
        precision: params.precision,
        amounts: [params.amount],
      })
      return {
        status: 'issued',
        paymentTxid,
        assetId: issued.assetId,
        pendingConfirmation: issued.pendingConfirmation,
        syncPending: issued.syncPending,
      }
    } catch (error) {
      return { status: 'issuance_pending', paymentTxid, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Reflect.metadata('APPROVAL', ['RgbReceive'])
  createRgbReceiveInvoice = async ({
    data: { params },
  }: {
    data: { params: { assetId?: string; amount?: string; durationSeconds?: number; recipientType?: 'blind' | 'witness' } }
  }) => {
    const receiveParams = {
      ...(params.assetId === undefined ? {} : { assetId: params.assetId }),
      ...(params.amount === undefined ? {} : { amount: params.amount }),
      ...(params.durationSeconds === undefined ? {} : { durationSeconds: params.durationSeconds }),
    }
    return params.recipientType === 'witness'
      ? wallet.createRgbWitnessReceive(receiveParams)
      : wallet.createRgbBlindReceive(receiveParams)
  }

  @Reflect.metadata('SAFE', true)
  getRgbPendingReceives = async () => wallet.getRgbPendingReceiveInvoices()

  @Reflect.metadata('APPROVAL', [
    'RgbReceiveAccept',
    async req => {
      const params = req.data.params as { recipientId: string; receive?: unknown }
      if (!params.recipientId) throw new Error('recipientId is required')
      const { list } = await wallet.getRgbPendingReceiveInvoices()
      const receive = list.find(item => item.recipientId === params.recipientId)
      if (!receive) throw new Error('RGB receive is not awaiting acceptance')
      params.receive = receive
    },
  ])
  acceptRgbReceive = async ({ data: { params } }: { data: { params: { recipientId: string } } }) => {
    return wallet.acceptRgbReceive({ recipientId: params.recipientId })
  }

  @Reflect.metadata('APPROVAL', [
    'RgbReceiveReject',
    async req => {
      const params = req.data.params as { recipientId: string; receive?: unknown }
      if (!params.recipientId) throw new Error('recipientId is required')
      const { list } = await wallet.getRgbPendingReceiveInvoices()
      const receive = list.find(item => item.recipientId === params.recipientId)
      if (!receive) throw new Error('RGB receive is not available')
      params.receive = receive
    },
  ])
  rejectRgbReceive = async ({ data: { params } }: { data: { params: { recipientId: string } } }) => {
    return wallet.rejectRgbReceive({ recipientId: params.recipientId })
  }

  @Reflect.metadata('APPROVAL', ['RgbPayment', validateRgbProviderFeeRate])
  prepareRgbPayment = async ({
    data: { params },
    session: { origin },
  }: {
    data: { params: { invoice: string; assetId: string; amount?: string; feeRate?: number } }
    session: { origin: string }
  }) => {
    validateRgbProviderFeeRate({ data: { params } })
    if (!params.invoice) throw new Error('invoice is required')
    if (!params.assetId) throw new Error('assetId is required')
    const prepared = await wallet.createRgbSendBegin({
      invoice: params.invoice,
      assetId: params.assetId,
      ...(params.amount === undefined ? {} : { amount: params.amount }),
      ...(params.feeRate === undefined ? {} : { feeRate: params.feeRate }),
      providerOrigin: origin,
    })
    return prepared
  }

  @Reflect.metadata('APPROVAL', [
    'SignPsbt',
    async req => {
      const params = req.data.params as { transferId: string; toSignDatas?: unknown[] }
      if (!params.transferId) throw new Error('transferId is required')
      const origin = req.session?.origin
      if (!origin) throw new Error('missing request origin')
      await assertRgbPaymentOrigin(params.transferId, origin)
      params.toSignDatas = [await wallet.getRgbPaymentSigningData({ transferId: params.transferId })]
    },
  ])
  signRgbPayment = async ({
    data: { params },
    session: { origin },
    approvalRes,
  }: {
    data: { params: { transferId: string; toSignDatas?: any[] } }
    session: { origin: string }
    approvalRes: SignPsbtResult
  }) => {
    await assertRgbPaymentOrigin(params.transferId, origin)
    const account = await wallet.getCurrentAccount()
    const toSignData = getToSignDatas(params.toSignDatas)[0]!
    const signedPsbt = approvalRes[0]?.psbtHex
    if (!signedPsbt) throw new Error('RGB payment signing did not return a PSBT')
    assertReadonlySignedPsbt(account, toSignData, signedPsbt)
    return wallet.createRgbSendEnd({
      transferId: params.transferId,
      signedPsbt,
    })
  }

  @Reflect.metadata('APPROVAL', ['RgbPaymentCancel'])
  cancelRgbPayment = async ({
    data: { params },
    session: { origin },
  }: {
    data: { params: { transferId: string } }
    session: { origin: string }
  }) => {
    if (!params.transferId) throw new Error('transferId is required')
    await assertRgbPaymentOrigin(params.transferId, origin)
    return wallet.abortRgbVanillaTx({ txid: params.transferId })
  }

  @Reflect.metadata('SAFE', true)
  getRgbPaymentStatus = async ({
    data: { params },
    session: { origin },
  }: {
    data: { params: { transferId: string } }
    session: { origin: string }
  }) => {
    if (!params.transferId) throw new Error('transferId is required')
    await assertRgbPaymentOrigin(params.transferId, origin)
    return wallet.getRgbPaymentStatus({ transferId: params.transferId })
  }

  /**
   * Prepare a seller-side RGB/BTC swap. The local RGB encoder validates the
   * maker template and replaces only its empty Opret host with the commitment.
   */
  @Reflect.metadata('APPROVAL', ['RgbPayment', validateRgbProviderFeeRate])
  prepareRgbSwap = async ({
    data: { params },
    session: { origin },
  }: {
    data: { params: { invoice: string; assetId: string; amount: string; btcReceiveAmount: string; feeRate?: number; psbt: string } }
    session: { origin: string }
  }) => {
    validateRgbProviderFeeRate({ data: { params } })
    if (!params.invoice || !params.assetId || !params.amount || !params.btcReceiveAmount || !params.psbt) {
      throw new Error('invoice, assetId, amount, btcReceiveAmount and psbt are required')
    }
    let btcReceiveAmount: number
    try {
      btcReceiveAmount = Number(BigInt(params.btcReceiveAmount))
    } catch {
      throw new Error('btcReceiveAmount must be an unsigned integer')
    }
    if (!Number.isSafeInteger(btcReceiveAmount) || btcReceiveAmount <= 0) {
      throw new Error('btcReceiveAmount is out of range')
    }
    const account = await wallet.getCurrentAccount()
    if (!account) throw new Error('no current account')
    const receiveScript = bitcoin.address.toOutputScript(account.address, toPsbtNetwork(wallet.getNetworkType()))
    const makerPsbt = bitcoin.Psbt.fromHex(formatPsbtHex(params.psbt))
    if (!makerPsbt.txOutputs.some(output => output.value >= btcReceiveAmount && output.script.equals(receiveScript))) {
      throw new Error('RGB swap PSBT does not pay the current wallet BTC address')
    }
    const prepared = await wallet.createRgbSendBegin({
      invoice: params.invoice,
      assetId: params.assetId,
      amount: params.amount,
      ...(params.feeRate === undefined ? {} : { feeRate: params.feeRate }),
      swapPsbt: params.psbt,
      providerOrigin: origin,
    })
    return {
      transferId: prepared.id,
      coloredPsbt: prepared.psbt,
      status: 'waiting_counterparty_signature' as const,
    }
  }

  @Reflect.metadata('APPROVAL', [
    'SignPsbt',
    async req => {
      const params = req.data.params as { transferId: string; makerSignedPsbt: string; toSignDatas?: unknown[] }
      if (!params.transferId || !params.makerSignedPsbt) {
        throw new Error('transferId and makerSignedPsbt are required')
      }
      const origin = req.session?.origin
      if (!origin) throw new Error('missing request origin')
      await assertRgbPaymentOrigin(params.transferId, origin)
      params.toSignDatas = [
        await wallet.getRgbPaymentSigningData({ transferId: params.transferId, psbt: params.makerSignedPsbt }),
      ]
    },
  ])
  signRgbSellSwapAndPublishConsignment = async ({
    data: { params },
    session: { origin },
    approvalRes,
  }: {
    data: { params: { transferId: string; makerSignedPsbt: string; toSignDatas?: any[] } }
    session: { origin: string }
    approvalRes: SignPsbtResult
  }) => {
    await assertRgbPaymentOrigin(params.transferId, origin)
    const account = await wallet.getCurrentAccount()
    const toSignData = getToSignDatas(params.toSignDatas)[0]!
    const signedPsbt = approvalRes[0]?.psbtHex
    if (!signedPsbt) throw new Error('RGB swap signing did not return a PSBT')
    assertReadonlySignedPsbt(account, toSignData, signedPsbt)
    const published = await wallet.publishRgbSwap({ transferId: params.transferId, signedPsbt })
    return { ...published, makerSignedPsbt: signedPsbt }
  }

  /**
   * The buyer has accepted the consignment and returned a fully signed PSBT.
   * The seller has already explicitly approved the exact unsigned transaction
   * in signRgbSellSwapAndPublishConsignment. This remains origin-bound and
   * validates/records the buyer completion, but deliberately leaves broadcast
   * to the dApp, so no second approval is needed here.
   */
  @Reflect.metadata('SAFE', true)
  confirmRgbSellSwap = async ({
    data: { params },
    session: { origin },
  }: {
    data: { params: { transferId: string; signedPsbt: string } }
    session: { origin: string }
  }) => {
    if (!params.transferId || !params.signedPsbt) {
      throw new Error('transferId and signedPsbt are required')
    }
    await assertRgbPaymentOrigin(params.transferId, origin)
    return wallet.prepareRgbSwapExternalBroadcast({
      transferId: params.transferId,
      signedPsbt: params.signedPsbt,
    })
  }

  @Reflect.metadata('APPROVAL', ['RgbPaymentCancel'])
  applyRgbSellSwapAbort = async ({ data: { params }, session: { origin } }: { data: { params: { transferId: string } }; session: { origin: string } }) => {
    if (!params.transferId) throw new Error('transferId is required')
    // A mutually signed terminal abort intentionally remains recoverable after
    // a dApp migration. Normal payment/swap operations stay origin-bound.
    const createdAtOrigin = await wallet.getRgbPaymentOrigin({ transferId: params.transferId })
    const result = await wallet.abortRgbAcknowledgedSwap({ txid: params.transferId })
    return { ...result, createdAtOrigin, currentOrigin: origin, originMatches: createdAtOrigin === origin }
  }

  @Reflect.metadata('SAFE', true)
  getRgbSellSwapAbortOrigin = async ({ data: { params }, session: { origin } }: { data: { params: { transferId: string } }; session: { origin: string } }) => {
    if (!params.transferId) throw new Error('transferId is required')
    const createdAtOrigin = await wallet.getRgbPaymentOrigin({ transferId: params.transferId })
    return { createdAtOrigin, currentOrigin: origin, originMatches: createdAtOrigin === origin }
  }

  @Reflect.metadata('APPROVAL', [
    'RgbReceiveReject',
    async req => {
      const params = req.data.params as { recipientId: string; receive?: unknown }
      if (!params.recipientId) throw new Error('recipientId is required')
      const { list } = await wallet.getRgbPendingReceiveInvoices()
      const receive = list.find(item => item.recipientId === params.recipientId)
      if (!receive) throw new Error('RGB receive is not available for swap abort')
      params.receive = receive
    },
  ])
  applyRgbBuySwapAbort = async ({ data: { params } }: { data: { params: { recipientId: string } } }) => {
    return wallet.abandonRgbAcceptedReceive({ recipientId: params.recipientId })
  }

  @Reflect.metadata('APPROVAL', ['RgbPaymentCancel'])
  cancelRgbSwap = async ({ data: { params }, session: { origin } }: { data: { params: { transferId: string } }; session: { origin: string } }) => {
    if (!params.transferId) throw new Error('transferId is required')
    // Cancelling a P2P swap is a recovery action. Keep regular RGB payments
    // origin-bound, but let the wallet owner release this unacknowledged swap
    // after explicit cancellation approval even if the market site migrated.
    const createdAtOrigin = await wallet.getRgbPaymentOrigin({ transferId: params.transferId })
    const result = await wallet.abortRgbVanillaTx({ txid: params.transferId })
    return { ...result, createdAtOrigin, currentOrigin: origin, originMatches: createdAtOrigin === origin }
  }

  @Reflect.metadata('SAFE', true)
  getRgbSwapStatus = async ({ data: { params }, session: { origin } }: { data: { params: { transferId: string } }; session: { origin: string } }) => {
    if (!params.transferId) throw new Error('transferId is required')
    await assertRgbPaymentOrigin(params.transferId, origin)
    return wallet.getRgbPaymentStatus({ transferId: params.transferId })
  }

  /**
   * Buyer-side completion: the maker must have already delivered a validated
   * consignment for the invoice, then signed every maker-controlled BTC/RGB
   * input. The signed PSBT is returned only after the wallet has sent ACK.
   */
  @Reflect.metadata('APPROVAL', [
    'SignPsbt',
    async req => {
      const params = req.data.params as {
        recipientId: string
        assetId: string
        amount: string
        maxBtcSpend: string
        makerSignedPsbt: string
        toSignDatas?: unknown[]
        receiptAlreadyAccepted?: boolean
      }
      if (!params.recipientId || !params.assetId || !params.amount || !params.maxBtcSpend || !params.makerSignedPsbt) {
        throw new Error('recipientId, assetId, amount, maxBtcSpend and makerSignedPsbt are required')
      }
      const receive = await wallet.getRgbBuySwapReceive({ recipientId: params.recipientId })
      if (receive.assetId !== params.assetId || receive.amount !== params.amount) {
        throw new Error('RGB swap receipt does not match the requested asset or amount')
      }
      params.receiptAlreadyAccepted = receive.accepted
      let maxBtcSpend: number
      try {
        maxBtcSpend = Number(BigInt(params.maxBtcSpend))
      } catch {
        throw new Error('maxBtcSpend must be an unsigned integer')
      }
      if (!Number.isSafeInteger(maxBtcSpend) || maxBtcSpend <= 0) throw new Error('maxBtcSpend is out of range')

      const psbt = bitcoin.Psbt.fromHex(formatPsbtHex(params.makerSignedPsbt))
      const transaction = ((psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx) as any
      if (!transaction?.getId || transaction.getId() !== receive.txid) {
        throw new Error('RGB swap PSBT does not match the validated consignment transaction')
      }
      if (transaction.locktime !== 0 || transaction.ins.some((input: any) => input.sequence !== 0xffff_ffff)) {
        throw new Error('RGB swap PSBT must disable RBF and locktime')
      }
      if (psbt.data.inputs.some(input => input.sighashType !== undefined && input.sighashType !== 0 && input.sighashType !== 1)) {
        throw new Error('RGB swap PSBT must use SIGHASH_ALL')
      }
      const account = await wallet.getCurrentAccount()
      if (!account) throw new Error('no current account')
      const networkType = wallet.getNetworkType()
      const ownedInputs = psbt.data.inputs
        .map((input, index) => ({ input, index }))
        .filter(({ input }) => input.witnessUtxo && scriptPkToAddress(input.witnessUtxo.script, networkType) === account.address)
      if (!ownedInputs.length) throw new Error('RGB buy swap has no input owned by the current wallet')
      if (
        psbt.data.inputs.some((input, index) => {
          const owned = ownedInputs.some(item => item.index === index)
          const signed = input.finalScriptSig || input.finalScriptWitness || input.tapKeySig || input.partialSig?.length || input.tapScriptSig?.length
          return !owned && !signed
        })
      ) {
        throw new Error('RGB buy swap maker inputs must be signed before wallet approval')
      }
      const userInputValue = ownedInputs.reduce((total, { input }) => total + input.witnessUtxo!.value, 0)
      const userChangeValue = psbt.txOutputs
        .filter(output => scriptPkToAddress(output.script, networkType) === account.address)
        .reduce((total, output) => total + output.value, 0)
      if (userInputValue - userChangeValue > maxBtcSpend) {
        throw new Error('RGB buy swap exceeds maxBtcSpend')
      }
      params.toSignDatas = [
        await wallet.getToSignData({
          psbtHex: psbt.toHex(),
          options: {
            // Honor the input's effective sighash. Omitted P2TR is DEFAULT
            // (0), while omitted non-taproot is ALL (1).
            toSignInputs: ownedInputs.map(({ input, index }) => ({
              index,
              address: account.address,
              sighashTypes: [effectiveInputSighashType(input)],
            })),
            autoFinalized: true,
          },
        }),
      ]
    },
  ])
  signRgbBuySwapAndAcceptConsignment = async ({ data: { params }, approvalRes }: {
    data: { params: { recipientId: string; toSignDatas?: any[]; receiptAlreadyAccepted?: boolean } }
    approvalRes: SignPsbtResult
  }) => {
    const account = await wallet.getCurrentAccount()
    const toSignData = getToSignDatas(params.toSignDatas)[0]!
    const signedPsbt = approvalRes[0]?.psbtHex
    if (!signedPsbt) throw new Error('RGB buy swap signing did not return a PSBT')
    const psbt = bitcoin.Psbt.fromHex(formatPsbtHex(signedPsbt))
    const sourcePsbt = bitcoin.Psbt.fromHex(formatPsbtHex(toSignData.psbtHex))
    assertSameUnsignedTx(psbt, sourcePsbt)
    restoreCounterpartyFinalizedInputs(
      psbt,
      sourcePsbt,
      new Set(toSignData.toSignInputs.map(input => input.index))
    )
    // The dApp owns finalization and broadcast for a P2P market swap. The
    // wallet signs only its own inputs and ACKs the validated RGB receipt;
    // it deliberately does not require extractTransaction()/finalizeAllInputs
    // here. Keep the unsigned transaction and required buyer signatures bound
    // to the approved request, including for external signer wallets.
    assertReadonlySignedPsbt(account, { ...toSignData, autoFinalized: false }, psbt.toHex())
    const accepted = params.receiptAlreadyAccepted ? { accepted: true } : await wallet.acceptRgbReceive({ recipientId: params.recipientId })
    if (!accepted?.accepted) return accepted
    return { recipientId: params.recipientId, status: 'accepted' as const, signedPsbt: psbt.toHex() }
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
    if (!hasOwn(wallet.cosmosChainInfoMap, chainId)) {
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
      const { signerAddress, signDoc: input } = req.data.params
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Invalid Cosmos signDoc')
      }
      // Only these fields enter the approval and the signed response. Never forward
      // caller-supplied display text or signing bytes for a Direct request.
      const signDoc = {
        bodyBytes: input.bodyBytes,
        authInfoBytes: input.authInfoBytes,
        chainId: input.chainId,
        accountNumber: input.accountNumber,
      }
      const signBytesHex = directSignDocToBytesHex(signDoc)
      req.data.params = { signerAddress, signDoc, signBytesHex }
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
      const { signerAddress, data } = req.data.params
      const signBytesHex = arbitrarySignDocToBytesHex(signerAddress, data)
      req.data.params = { signerAddress, data, signBytesHex }
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
      if (!/^[a-z0-9-]+$/.test(params.appName)) {
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
