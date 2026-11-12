import { bitcoin, scriptPkToAddress, toPsbtNetwork, verifyMessageOfBIP322Simple, verifyMessageOfECDSA } from '@unisat/wallet-bitcoin'
import { assertValidFeeRate } from '@unisat/base-utils'
import {
  createBfaBurnDestinationV1,
  decodeRgbInvoice as decodeLocalRgbInvoice,
} from '@unisat/rgb-service'
import type { BfaBurnDestinationV1 } from '@unisat/rgb-service'
import { keccak_256 } from '@noble/hashes/sha3'
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
  encodeSignature,
} from '@unisat/babylon-service'
import {
  CHAINS,
  CHAINS_MAP,
  NETWORK_TYPES,
  PlatformEnv,
  SESSION_EVENTS,
  AccountSignMethod,
  ErrorCodes,
  SignMessageResult,
  SignMessageType,
  SignPsbtResult,
  ToSignData,
  ToSignMessage,
  WalletError,
  getAccountCapabilities,
  getDefaultRgbProxyEndpoints,
  hasOwn,
  isSupportedChainType,
} from '@unisat/wallet-shared'
import { NetworkType } from '@unisat/wallet-types'
import { formatPsbtHex } from '../../utils/psbt-utils'
import { proxyV1Verify } from '../../adapters/rgb-proxy-v1'

const MAX_MULTI_SIGN_PSBT_COUNT = 50
const MAX_MULTI_SIGN_PSBT_INPUT_COUNT = 1000

function validateRgbProviderFeeRate(req: { data: { params: { feeRate?: number } } }) {
  const { feeRate } = req.data.params
  if (feeRate !== undefined) assertValidFeeRate(feeRate, { supportLowFeeMode: true })
}

function validateCosmosEnableRequest(req: { data: { params?: { chainId?: unknown } } }) {
  const chainId = req.data.params?.chainId
  if (typeof chainId !== 'string' || !hasOwn(wallet.cosmosChainInfoMap, chainId)) {
    throw new Error(`Unsupported Cosmos network: ${String(chainId)}`)
  }
}

type RgbProxyApprovalRequirement = { endpoints: string[] }

function normalizeRgbPaymentAmount(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error('amount must be a positive safe integer')
    }
    return String(value)
  }
  if (typeof value !== 'string') throw new Error('amount must be a string or number')
  const amount = value.trim()
  if (!/^[1-9][0-9]*$/.test(amount)) throw new Error('amount must be a positive integer')
  return amount
}

function prepareRgbPaymentApproval(req: {
  data: { params: { invoice?: string; amount?: unknown; feeRate?: number; rgbProxyApproval?: unknown } }
}) {
  validateRgbProviderFeeRate(req)
  const params = req.data.params
  delete params.rgbProxyApproval
  if (!params.invoice) throw new Error('invoice is required')
  if (params.amount !== undefined) params.amount = normalizeRgbPaymentAmount(params.amount)
  const invoice = decodeLocalRgbInvoice(params.invoice)
  return wallet
    .getRgbProxyApprovalRequirement({ endpoints: invoice.transportEndpoints })
    .then((requirement: RgbProxyApprovalRequirement) => {
      params.rgbProxyApproval = requirement
    })
}

async function approveRgbPaymentProxy(
  requirement: RgbProxyApprovalRequirement | undefined,
  approvalRes?: { approvedRgbProxyEndpoints?: unknown }
) {
  const endpoints = requirement?.endpoints || []
  if (!endpoints.length) return
  const approved = approvalRes?.approvedRgbProxyEndpoints
  if (
    !Array.isArray(approved) ||
    approved.length !== endpoints.length ||
    approved.some((endpoint, index) => endpoint !== endpoints[index])
  ) {
    throw new WalletError(ErrorCodes.UserCancel, 'Third-party RGB proxy was not approved')
  }
  await wallet.approveRgbProxyEndpoints({ endpoints })
}

function webRgbInvalid(message: string): never {
  throw new WalletError(ErrorCodes.INVALID_PARAMS, message)
}

function webRgbSafeNumber(value: string | number | undefined, name: string): number {
  const parsed = Number(value ?? 0)
  if (!Number.isSafeInteger(parsed) || parsed < 0) webRgbInvalid(`${name} exceeds the WebRGB number range`)
  return parsed
}

type WebRgbBurnRecipient = { chainId: string; address: string }
type WebRgbBurnParams = {
  network: string
  assetId: string
  amount: string
  burnRecipient: WebRgbBurnRecipient
  feeRate?: number
  minConfirmations?: number
  burnDestination?: BfaBurnDestinationV1
}

const WEB_RGB_MAX_U64 = (1n << 64n) - 1n

function parseWebRgbBurnDestination(recipient: WebRgbBurnRecipient): BfaBurnDestinationV1 {
  if (!recipient || typeof recipient !== 'object' || Array.isArray(recipient))
    webRgbInvalid('burnRecipient is required')
  if (typeof recipient.chainId !== 'string' || typeof recipient.address !== 'string' || !recipient.address.trim())
    webRgbInvalid('burnRecipient.chainId and burnRecipient.address are required')
  const match = /^(eip155|tron):([1-9][0-9]*)$/.exec(recipient.chainId)
  if (!match) webRgbInvalid('burnRecipient.chainId must be a supported CAIP-2 chain ID')
  const destinationChainId = Number(match[2])
  if (!Number.isSafeInteger(destinationChainId)) webRgbInvalid('burnRecipient.chainId is out of range')
  if ((match[1] === 'tron') !== (destinationChainId === 728126428))
    webRgbInvalid('burnRecipient namespace does not match its destination chain')
  try {
    return createBfaBurnDestinationV1(destinationChainId, recipient.address)
  } catch (error) {
    webRgbInvalid(error instanceof Error ? error.message : String(error))
  }
}

async function validateWebRgbBurnRequest(req: { data: { params: WebRgbBurnParams } }) {
  validateRgbProviderFeeRate(req)
  const params = req.data.params
  if (!params || typeof params !== 'object' || Array.isArray(params)) webRgbInvalid('burnAsset arguments are required')
  if (typeof params.network !== 'string' || !params.network) webRgbInvalid('network is required')
  if (typeof params.assetId !== 'string' || !params.assetId) webRgbInvalid('assetId is required')
  if (typeof params.amount !== 'string' || !/^[1-9][0-9]*$/.test(params.amount) || BigInt(params.amount) > WEB_RGB_MAX_U64)
    webRgbInvalid('amount must be a positive u64 decimal string')
  if (params.minConfirmations !== undefined &&
      (!Number.isSafeInteger(params.minConfirmations) || params.minConfirmations < 0))
    webRgbInvalid('minConfirmations must be a nonnegative integer')
  const current = await wallet.getCurrentRgbWalletRef()
  if (params.network !== current.network) webRgbInvalid('network does not match the current RGB wallet')
  params.burnDestination = parseWebRgbBurnDestination(params.burnRecipient)
  params.minConfirmations = Math.max(3, params.minConfirmations || 0)
}

async function getWebRgbBurnConsignment(assetId: string, txid: string) {
  const data = await wallet.exportRgbBurnConsignment(txid, assetId)
  const bytes = Buffer.from(data, 'base64')
  return {
    assetId,
    txid,
    encoding: 'base64' as const,
    data,
    byteLength: bytes.byteLength,
    digest: {
      algorithm: 'keccak256' as const,
      value: `0x${Buffer.from(keccak_256(bytes)).toString('hex')}`,
    },
  }
}

async function prepareWebRgbConsignmentApproval(req: {
  data: { params: { assetId?: string; txid?: string; proof?: unknown } }
}) {
  const params = req.data.params
  delete params.proof
  if (typeof params?.assetId !== 'string' || !params.assetId) webRgbInvalid('assetId is required')
  if (typeof params.txid !== 'string' || !/^[0-9a-f]{64}$/i.test(params.txid))
    webRgbInvalid('txid must be 64 hexadecimal characters')
  const proof = await getWebRgbBurnConsignment(params.assetId, params.txid.toLowerCase())
  params.txid = proof.txid
  params.proof = { byteLength: proof.byteLength, digest: proof.digest.value }
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
  const hasSameTransactionHeader =
    psbt.version === sourcePsbt.version && psbt.locktime === sourcePsbt.locktime
  const hasSameInputs =
    psbt.txInputs.length === sourcePsbt.txInputs.length &&
    psbt.txInputs.every((input, index) => {
      const sourceInput = sourcePsbt.txInputs[index]
      return (
        sourceInput &&
        input.hash.equals(sourceInput.hash) &&
        input.index === sourceInput.index &&
        input.sequence === sourceInput.sequence &&
        psbt.data.inputs[index]?.sighashType === sourcePsbt.data.inputs[index]?.sighashType
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

  if (!hasSameTransactionHeader || !hasSameInputs || !hasSameOutputs) {
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

function assertExternalSignedPsbt(
  account: Awaited<ReturnType<typeof wallet.getCurrentAccount>>,
  toSignData: ToSignData,
  psbtHex?: string
) {
  if (!account) return
  const signMethod = getAccountCapabilities(account).signMethod
  if (
    signMethod !== AccountSignMethod.External &&
    signMethod !== AccountSignMethod.Keystone &&
    signMethod !== AccountSignMethod.ColdWallet
  ) {
    return
  }
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
      // The proxy may time out while the issuance service continues verifying
      // and commits the payment. Observe the order before retrying the POST so
      // an uncertain response becomes an idempotent success immediately.
      try {
        const observed = await getRgbIssueWalletOrder(orderId)
        if (observed.status === 'paid' && observed.paymentTxid === txid) return observed
        if (observed.status !== 'pending') {
          lastError = new Error('RGB issue order was paid by another transaction')
        }
      } catch {
        // Keep the claim error; the next attempt can recover a transient read.
      }
      if (
        /invalid|insufficient|predates|order wallet|network mismatch|paid by another|belongs to another/i.test(
          lastError.message
        )
      ) {
        break
      }
      if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 1500))
    }
  }
  throw lastError || new Error('RGB issue payment is not visible yet')
}

function hasPsbtInputSignature(input: bitcoin.Psbt['data']['inputs'][number]) {
  return Boolean(
    input.finalScriptSig ||
    input.finalScriptWitness ||
    input.tapKeySig ||
    input.partialSig?.length ||
    input.tapScriptSig?.length
  )
}

function assertNoCounterpartyPsbtSignatures(psbt: bitcoin.Psbt, buyerInputIndexes: Set<number>) {
  if (psbt.data.inputs.some((input, index) =>
    !buyerInputIndexes.has(index) && hasPsbtInputSignature(input)
  )) {
    throw new Error('RGB buy swap PSBT must not expose maker signatures to the wallet client')
  }
}

function rgbBuySwapCommitMessage(input: {
  proxyTransferId: string
  txid: string
  buyerSignedPsbtHash: string
}) {
  return `rgb-buy-swap/commit/v1:${input.proxyTransferId}:${input.txid}:${input.buyerSignedPsbtHash}`
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

async function assertRgbReceiveOrigin(recipientId: string, origin: string) {
  const receive = await wallet.getRgbBuySwapReceive({ recipientId })
  if (receive.providerOrigin !== origin) {
    throw new Error('RGB receive is not available to this site')
  }
  return receive
}

async function prepareRgbPaymentCancelApproval(req: any) {
  const params = req.data.params as { transferId: string; payment?: unknown }
  if (!params.transferId) throw new Error('transferId is required')
  const origin = req.session?.origin
  if (!origin) throw new Error('missing request origin')
  await assertRgbPaymentOrigin(params.transferId, origin)
  params.payment = await wallet.getRgbPaymentStatus({ transferId: params.transferId })
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
      if (params.sendBitcoinParams.feeRate !== undefined) {
        assertValidFeeRate(params.sendBitcoinParams.feeRate, { supportLowFeeMode: true })
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
    assertExternalSignedPsbt(
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
      if (params.sendInscriptionParams.feeRate !== undefined) {
        assertValidFeeRate(params.sendInscriptionParams.feeRate, { supportLowFeeMode: true })
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
    assertExternalSignedPsbt(
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
      if (params.sendRunesParams.feeRate !== undefined) {
        assertValidFeeRate(params.sendRunesParams.feeRate, { supportLowFeeMode: true })
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
    assertExternalSignedPsbt(
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
    assertExternalSignedPsbt(account, toSignData, approvalRes[0]!.psbtHex)
    return approvalRes[0]!.psbtHex
  }

  @Reflect.metadata('APPROVAL', [
    'SignPsbt',
    async req => {
      const params: RequestMethodSignPsbtsParams = req.data.params
      if (!Array.isArray(params.psbtHexs) || params.psbtHexs.length === 0) {
        throw new WalletError(ErrorCodes.INVALID_PARAMS, 'psbtHexs is required')
      }
      if (params.psbtHexs.length > MAX_MULTI_SIGN_PSBT_COUNT) {
        throw new WalletError(
          ErrorCodes.INVALID_PARAMS,
          `Cannot sign more than ${MAX_MULTI_SIGN_PSBT_COUNT} transactions at once`
        )
      }

      const formattedPsbtHexs: string[] = []
      let totalInputCount = 0
      for (const psbt of params.psbtHexs) {
        const psbtHex = formatPsbtHex(psbt)
        totalInputCount += bitcoin.Psbt.fromHex(psbtHex).inputCount
        if (totalInputCount > MAX_MULTI_SIGN_PSBT_INPUT_COUNT) {
          throw new WalletError(
            ErrorCodes.INVALID_PARAMS,
            `Cannot sign more than ${MAX_MULTI_SIGN_PSBT_INPUT_COUNT} UTXOs at once`
          )
        }
        formattedPsbtHexs.push(psbtHex)
      }

      params.toSignDatas = []
      for (let i = 0; i < formattedPsbtHexs.length; i++) {
        const toSignData = await wallet.getToSignData({
          psbtHex: formattedPsbtHexs[i]!,
          ...(params.options?.[i] ? { options: params.options[i] } : {}),
        })
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
      assertExternalSignedPsbt(account, toSignData, approvalRes[index]!.psbtHex)
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

  getRgbAssets = async ({
    data: {
      params: { page = 1, pageSize = 50 },
    },
  }) => {
    return wallet.getRGBList('', page, pageSize, { skipSync: true })
  }

  /** WebRGB uses the existing site connection prompt, but never connects on a read call. */
  webRgbEnable = async ({ session: { origin } }: { session: { origin: string } }) => {
    if (!permissionService.hasPermission(origin)) throw new Error('WebRGB connection was not approved')
  }

  webRgbGetInfo = async () => {
    const feature = await wallet.getRgbFeatureStatus()
    const ready = feature.enabled && feature.supported
    const proxyConfig = ready ? await wallet.getRgbReceiveProxyConfig() : undefined
    const proxyProfiles = (proxyConfig?.profiles || [])
      .filter(profile => profile.selectable !== false)
      .map(profile => ({
        id: profile.id,
        name: profile.name,
        endpoint: profile.endpoint,
        ...(profile.protocolVersion ? { protocolVersion: profile.protocolVersion } : {}),
        ...(profile.serverVersion ? { serverVersion: profile.serverVersion } : {}),
        recommended: profile.id === proxyConfig?.defaultProxyId,
      }))
    return {
      ready,
      network: ready ? (await wallet.getCurrentRgbWalletRef()).network : wallet.getChainType(),
      protocol: ready ? 'RGB_L1' : null,
      methods: ready
        ? ['enable', 'getInfo', 'getAddress', 'blindReceive', 'witnessReceive', 'listAssets',
          'getAssetBalance', 'sendAsset', 'burnAsset', 'getConsignment', 'listTransfers', 'getTransferStatus',
          'decodeRgbInvoice', 'on', 'off']
        : ['enable', 'getInfo'],
      ...(ready ? {
        burnRecipientNamespaces: ['eip155', 'tron'],
        proxyProfiles,
        ...(proxyConfig?.defaultProxyId ? { defaultProxyId: proxyConfig.defaultProxyId } : {}),
      } : {}),
    }
  }

  webRgbGetAddress = async () => wallet.getRgbFundingAddress()

  webRgbListAssets = async () => {
    const assets: any[] = []
    for (let page = 1; page <= 1000; page++) {
      const result = await wallet.getRGBList('', page, 50, { skipSync: true })
      assets.push(...result.list.map(asset => ({ ...asset, id: asset.assetId, asset_id: asset.assetId })))
      if (assets.length >= result.total || result.list.length === 0) return assets
    }
    throw new Error('RGB asset list exceeds the provider pagination limit')
  }

  webRgbGetAssetBalance = async ({ data: { params } }: { data: { params: { assetId: string } } }) => {
    if (typeof params?.assetId !== 'string' || !params.assetId) webRgbInvalid('assetId is required')
    const balance = await wallet.getRGBAssetBalance('', params.assetId)
    if (!balance) {
      throw new WalletError(
        ErrorCodes.RGB_ASSET_NOT_FOUND,
        'RGB asset was not found'
      )
    }
    return { assetId: params.assetId, balance: webRgbSafeNumber(balance.balance, 'balance'), raw: balance }
  }

  webRgbListTransfers = async ({ data: { params } }: { data: { params?: { assetId?: string } } }) => {
    if (params?.assetId !== undefined && (typeof params.assetId !== 'string' || !params.assetId))
      webRgbInvalid('assetId must be a nonempty string')
    const transfers: any[] = []
    for (let page = 1; page <= 1000; page++) {
      const result = await wallet.getRgbTransfers(page, 50, { skipSync: true })
      transfers.push(...result.list)
      if (transfers.length >= result.total || result.list.length === 0) {
        return params?.assetId
          ? transfers.filter(transfer => transfer.assetId === params.assetId)
          : transfers
      }
    }
    throw new Error('RGB transfer list exceeds the provider pagination limit')
  }

  webRgbGetTransferStatus = async ({ data: { params } }: {
    data: { params: { transferId: string; assetId?: string } }
  }) => {
    if (typeof params?.transferId !== 'string' || !params.transferId)
      webRgbInvalid('transferId is required')
    const transfers = await this.webRgbListTransfers({ data: { params: params.assetId ? { assetId: params.assetId } : {} } })
    const transfer = transfers.find(item =>
      [item.transferId, item.recipientId, item.txid, item.id].some(id => id !== undefined && id !== null && String(id) === params.transferId))
    return transfer
      ? { found: true, status: transfer.status || null, transfer }
      : { found: false, status: null, transfer: null }
  }

  @Reflect.metadata('APPROVAL', ['RgbBurn', validateWebRgbBurnRequest])
  webRgbPrepareBurn = async ({
    data: { params },
    session: { origin },
  }: {
    data: { params: WebRgbBurnParams }
    session: { origin: string }
  }) => {
    await validateWebRgbBurnRequest({ data: { params } })
    const prepared = await wallet.createRgbSendBegin({
      invoice: '',
      assetId: params.assetId,
      amount: params.amount,
      burn: true,
      burnDestination: params.burnDestination,
      minConfirmations: params.minConfirmations,
      ...(params.feeRate === undefined ? {} : { feeRate: params.feeRate }),
      providerOrigin: origin,
    })
    return { ...prepared, minConfirmations: params.minConfirmations }
  }

  @Reflect.metadata('APPROVAL', ['RgbConsignment', prepareWebRgbConsignmentApproval])
  webRgbGetConsignment = async ({ data: { params } }: {
    data: { params: { assetId: string; txid: string; proof?: unknown } }
  }) => {
    if (typeof params?.assetId !== 'string' || !params.assetId) webRgbInvalid('assetId is required')
    if (typeof params.txid !== 'string' || !/^[0-9a-f]{64}$/i.test(params.txid))
      webRgbInvalid('txid must be 64 hexadecimal characters')
    return getWebRgbBurnConsignment(params.assetId, params.txid.toLowerCase())
  }

  @Reflect.metadata('SAFE', true)
  webRgbDecodeInvoice = async ({ data: { params } }: { data: { params: { invoice: string } } }) => {
    if (typeof params?.invoice !== 'string' || !params.invoice.trim())
      webRgbInvalid('invoice is required')
    let decoded: ReturnType<typeof decodeLocalRgbInvoice>
    try { decoded = decodeLocalRgbInvoice(params.invoice) }
    catch (error) { webRgbInvalid(`invoice is invalid: ${String(error)}`) }
    return {
      assetId: decoded.assetId,
      amount: decoded.amount && decoded.amount !== '0'
        ? webRgbSafeNumber(decoded.amount, 'invoice amount') : null,
      recipientId: decoded.recipientId,
      expirationTimestamp: decoded.expirationTimestamp,
      network: decoded.network,
      transportEndpoints: decoded.transportEndpoints,
    }
  }

  @Reflect.metadata('SAFE', true)
  webRgbBuildInvoice = async ({ data: { params } }: {
    data: { params: { assetId: string; amount: number; recipientId: string; transportEndpoints?: string[] } }
  }) => {
    if (typeof params?.assetId !== 'string' || !params.assetId) webRgbInvalid('assetId is required')
    if (!Number.isSafeInteger(params.amount) || params.amount <= 0) webRgbInvalid('amount must be a positive safe integer')
    if (typeof params.recipientId !== 'string' || !params.recipientId) webRgbInvalid('recipientId is required')
    const endpoints =
      params.transportEndpoints ?? getDefaultRgbProxyEndpoints(CHAINS_MAP[wallet.getChainType()])
    if (!Array.isArray(endpoints) || !endpoints.length || endpoints.some(item => typeof item !== 'string' || !item))
      webRgbInvalid('transportEndpoints are unavailable')
    const query = new URLSearchParams({ amount: String(params.amount), endpoints: endpoints.join(',') })
    const invoice = `rgb:${params.assetId.replace(/^rgb:/, '')}/~/~/${params.recipientId}?${query}`
    try { decodeLocalRgbInvoice(invoice) }
    catch (error) { webRgbInvalid(`recipientId or assetId is invalid: ${String(error)}`) }
    return { invoice }
  }

  /** Release only this origin's unsigned reservation after the signing prompt is dismissed. */
  webRgbReleasePreparedPayment = async ({ data: { params }, session: { origin } }: {
    data: { params: { transferId: string } }; session: { origin: string }
  }) => {
    if (typeof params?.transferId !== 'string' || !params.transferId)
      webRgbInvalid('transferId is required')
    await assertRgbPaymentOrigin(params.transferId, origin)
    return wallet.abortRgbVanillaTx({ txid: params.transferId })
  }

  getRgbFundingUtxos = async ({ data: { params } }: { data: { params: { assetId: string } } }) => {
    if (!params.assetId) throw new Error('assetId is required')
    return wallet.getRgbFundingUtxos({ assetId: params.assetId })
  }

  getRgbFeeUtxos = async () => wallet.getRgbFeeUtxos()

  getRgbIssueAvailability = async () => wallet.getRgbAllocationSummary({ skipSync: false })

  @Reflect.metadata('APPROVAL', ['RgbIssue', async req => {
    const params = req.data.params as {
      orderId: string; ticker: string; name: string; precision: number; amount: string;
      paymentTxid?: string; toSignData?: ToSignData;
      serviceFeeSats?: number
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
    params.serviceFeeSats = order.feeSats
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
      assertExternalSignedPsbt(currentAccount, params.toSignData, signedPsbt)
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
        issuanceTxid: paymentTxid,
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

  @Reflect.metadata('APPROVAL', ['RgbReceive', async req => {
    const params = req.data.params as {
      proxyId?: string
      proxyProfile?: unknown
    }
    delete params.proxyProfile
    const config = await wallet.getRgbReceiveProxyConfig()
    const selectedId = params.proxyId || config.defaultProxyId
    if (!selectedId) return
    const profile = config.profiles.find(item => item.id === selectedId && item.selectable !== false)
    if (!profile) webRgbInvalid('proxyId is invalid')
    params.proxyId = profile.id
    params.proxyProfile = {
      id: profile.id,
      name: profile.name,
      endpoint: profile.endpoint,
      ...(profile.protocolVersion ? { protocolVersion: profile.protocolVersion } : {}),
      ...(profile.serverVersion ? { serverVersion: profile.serverVersion } : {}),
      recommended: profile.id === config.defaultProxyId,
    }
  }])
  createRgbReceiveInvoice = async ({
    data: { params },
    session: { origin },
  }: {
    data: { params: { assetId?: string; amount?: string; durationSeconds?: number; recipientType?: 'blind' | 'witness'; minConfirmations?: number; purpose?: 'buy_swap'; proxyId?: string } }
    session: { origin: string }
  }) => {
    const receiveParams = {
      ...(params.assetId === undefined ? {} : { assetId: params.assetId }),
      ...(params.amount === undefined ? {} : { amount: params.amount }),
      ...(params.durationSeconds === undefined ? {} : { durationSeconds: params.durationSeconds }),
      ...(params.minConfirmations === undefined ? {} : { minConfirmations: params.minConfirmations }),
      ...(params.proxyId === undefined ? {} : { proxyId: params.proxyId }),
      ...(params.purpose === 'buy_swap' ? { acceptancePolicy: 'buy_swap_backend_commit' as const } : {}),
      providerOrigin: origin,
    }
    return params.recipientType === 'witness'
      ? wallet.createRgbWitnessReceive(receiveParams)
      : wallet.createRgbBlindReceive(receiveParams)
  }

  getRgbPendingReceives = async ({ session: { origin } }: { session: { origin: string } }) =>
    wallet.getRgbPendingReceiveInvoices({ providerOrigin: origin })

  @Reflect.metadata('APPROVAL', [
    'RgbReceiveAccept',
    async req => {
      const params = req.data.params as { recipientId: string; receive?: unknown }
      if (!params.recipientId) throw new Error('recipientId is required')
      const origin = req.session?.origin
      if (!origin) throw new Error('missing request origin')
      const { list } = await wallet.getRgbPendingReceiveInvoices({ providerOrigin: origin })
      const receive = list.find(item => item.recipientId === params.recipientId)
      if (!receive) throw new Error('RGB receive is not awaiting acceptance')
      params.receive = receive
    },
  ])
  acceptRgbReceive = async ({ data: { params }, session: { origin } }: { data: { params: { recipientId: string } }; session: { origin: string } }) => {
    await assertRgbReceiveOrigin(params.recipientId, origin)
    return wallet.acceptRgbReceive({ recipientId: params.recipientId })
  }

  @Reflect.metadata('APPROVAL', [
    'RgbReceiveReject',
    async req => {
      const params = req.data.params as { recipientId: string; receive?: unknown }
      if (!params.recipientId) throw new Error('recipientId is required')
      const origin = req.session?.origin
      if (!origin) throw new Error('missing request origin')
      const { list } = await wallet.getRgbPendingReceiveInvoices({ providerOrigin: origin })
      const receive = list.find(item => item.recipientId === params.recipientId)
      if (!receive) throw new Error('RGB receive is not available')
      params.receive = receive
    },
  ])
  rejectRgbReceive = async ({ data: { params }, session: { origin } }: { data: { params: { recipientId: string } }; session: { origin: string } }) => {
    await assertRgbReceiveOrigin(params.recipientId, origin)
    return wallet.rejectRgbReceive({ recipientId: params.recipientId })
  }

  @Reflect.metadata('APPROVAL', ['RgbPayment', prepareRgbPaymentApproval])
  prepareRgbPayment = async ({
    data: { params },
    session: { origin },
    approvalRes,
  }: {
    data: { params: { invoice: string; assetId: string; amount?: string | number; feeRate?: number; rgbProxyApproval?: RgbProxyApprovalRequirement } }
    session: { origin: string }
    approvalRes?: { approvedRgbProxyEndpoints?: unknown }
  }) => {
    validateRgbProviderFeeRate({ data: { params } })
    if (!params.invoice) throw new Error('invoice is required')
    if (!params.assetId) throw new Error('assetId is required')
    await approveRgbPaymentProxy(params.rgbProxyApproval, approvalRes)
    const amount = normalizeRgbPaymentAmount(params.amount)
    const prepared = await wallet.createRgbSendBegin({
      invoice: params.invoice,
      assetId: params.assetId,
      ...(amount === undefined ? {} : { amount }),
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
    assertExternalSignedPsbt(account, toSignData, signedPsbt)
    return wallet.createRgbSendEnd({
      transferId: params.transferId,
      signedPsbt,
    })
  }

  @Reflect.metadata('APPROVAL', ['RgbPaymentCancel', prepareRgbPaymentCancelApproval])
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
  @Reflect.metadata('APPROVAL', ['RgbPayment', prepareRgbPaymentApproval])
  prepareRgbSwap = async ({
    data: { params },
    session: { origin },
    approvalRes,
  }: {
    data: { params: { invoice: string; assetId: string; amount: string; btcReceiveAmount: string; feeRate?: number; psbt: string; backendPublicKey?: string; rgbProxyApproval?: RgbProxyApprovalRequirement } }
    session: { origin: string }
    approvalRes?: { approvedRgbProxyEndpoints?: unknown }
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
    if (
      params.backendPublicKey !== undefined &&
      !/^[0-9a-f]{64}$/i.test(params.backendPublicKey)
    ) {
      throw new Error('backendPublicKey must be a 32-byte Ed25519 public key')
    }
    const account = await wallet.getCurrentAccount()
    if (!account) throw new Error('no current account')
    const receiveScript = bitcoin.address.toOutputScript(account.address, toPsbtNetwork(wallet.getNetworkType()))
    const makerPsbt = bitcoin.Psbt.fromHex(formatPsbtHex(params.psbt))
    if (!makerPsbt.txOutputs.some(output => output.value >= btcReceiveAmount && output.script.equals(receiveScript))) {
      throw new Error('RGB swap PSBT does not pay the current wallet BTC address')
    }
    await approveRgbPaymentProxy(params.rgbProxyApproval, approvalRes)
    const prepared = await wallet.createRgbSendBegin({
      invoice: params.invoice,
      assetId: params.assetId,
      amount: params.amount,
      ...(params.feeRate === undefined ? {} : { feeRate: params.feeRate }),
      swapPsbt: params.psbt,
      providerOrigin: origin,
      ...(params.backendPublicKey
        ? { providerBackendPublicKey: params.backendPublicKey.toLowerCase() }
        : {}),
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
    assertExternalSignedPsbt(account, toSignData, signedPsbt)
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

  /**
   * The backend retained and finalized the transaction. Authenticate that
   * commitment and the receiver ACK without importing or returning its PSBT.
   */
  acceptRgbSellSwap = async ({
    data: { params },
    session: { origin },
  }: {
    data: { params: { transferId: string; txid: string; transactionCommitment: string } }
    session: { origin: string }
  }) => {
    if (
      !params.transferId ||
      !/^[0-9a-f]{64}$/i.test(params.txid) ||
      !/^[0-9a-f]{128}$/i.test(params.transactionCommitment)
    ) {
      throw new Error('transferId, txid and a 64-byte transactionCommitment are required')
    }
    await assertRgbPaymentOrigin(params.transferId, origin)
    return wallet.acceptRgbSwapExternalBroadcast({
      transferId: params.transferId,
      txid: params.txid.toLowerCase(),
      transactionCommitment: params.transactionCommitment.toLowerCase(),
    })
  }

  @Reflect.metadata('APPROVAL', ['RgbPaymentCancel', prepareRgbPaymentCancelApproval])
  applyRgbSellSwapAbort = async ({ data: { params }, session: { origin } }: { data: { params: { transferId: string } }; session: { origin: string } }) => {
    if (!params.transferId) throw new Error('transferId is required')
    await assertRgbPaymentOrigin(params.transferId, origin)
    return wallet.abortRgbAcknowledgedSwap({ txid: params.transferId })
  }

  @Reflect.metadata('APPROVAL', [
    'RgbReceiveReject',
    async req => {
      const params = req.data.params as { recipientId: string; receive?: unknown }
      if (!params.recipientId) throw new Error('recipientId is required')
      const origin = req.session?.origin
      if (!origin) throw new Error('missing request origin')
      const { list } = await wallet.getRgbPendingReceiveInvoices({ providerOrigin: origin })
      const receive = list.find(item => item.recipientId === params.recipientId)
      if (!receive) throw new Error('RGB receive is not available for swap abort')
      params.receive = receive
    },
  ])
  applyRgbBuySwapAbort = async ({ data: { params }, session: { origin } }: { data: { params: { recipientId: string } }; session: { origin: string } }) => {
    await assertRgbReceiveOrigin(params.recipientId, origin)
    return wallet.abandonRgbAcceptedReceive({ recipientId: params.recipientId })
  }

  @Reflect.metadata('APPROVAL', ['RgbPaymentCancel', prepareRgbPaymentCancelApproval])
  cancelRgbSwap = async ({ data: { params }, session: { origin } }: { data: { params: { transferId: string } }; session: { origin: string } }) => {
    if (!params.transferId) throw new Error('transferId is required')
    await assertRgbPaymentOrigin(params.transferId, origin)
    return wallet.abortRgbVanillaTx({ txid: params.transferId })
  }

  getRgbSwapStatus = async ({ data: { params }, session: { origin } }: { data: { params: { transferId: string } }; session: { origin: string } }) => {
    if (!params.transferId) throw new Error('transferId is required')
    await assertRgbPaymentOrigin(params.transferId, origin)
    return wallet.getRgbPaymentStatus({ transferId: params.transferId })
  }

  /** Sign only buyer-controlled inputs. Maker signatures and ACK are deliberately absent. */
  @Reflect.metadata('APPROVAL', [
    'SignPsbt',
    async req => {
      const params = req.data.params as {
        recipientId: string
        assetId: string
        amount: string
        maxBtcSpend: string
        swapPsbt: string
        toSignDatas?: unknown[]
      }
      if (!params.recipientId || !params.assetId || !params.amount || !params.maxBtcSpend || !params.swapPsbt) {
        throw new Error('recipientId, assetId, amount, maxBtcSpend and swapPsbt are required')
      }
      const receive = await wallet.getRgbBuySwapReceive({ recipientId: params.recipientId })
      const origin = req.session?.origin
      if (!origin || receive.providerOrigin !== origin) {
        throw new Error('RGB receive is not available to this site')
      }
      if (receive.assetId !== params.assetId || receive.amount !== params.amount) {
        throw new Error('RGB swap receipt does not match the requested asset or amount')
      }
      if (receive.accepted) throw new Error('RGB buy swap receipt was already accepted')
      let maxBtcSpend: number
      try {
        maxBtcSpend = Number(BigInt(params.maxBtcSpend))
      } catch {
        throw new Error('maxBtcSpend must be an unsigned integer')
      }
      if (!Number.isSafeInteger(maxBtcSpend) || maxBtcSpend <= 0) throw new Error('maxBtcSpend is out of range')

      const psbt = bitcoin.Psbt.fromHex(formatPsbtHex(params.swapPsbt))
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
      const buyerInputIndexes = new Set(ownedInputs.map(item => item.index))
      assertNoCounterpartyPsbtSignatures(psbt, buyerInputIndexes)
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
  signRgbBuySwap = async ({ data: { params }, session: { origin }, approvalRes }: {
    data: { params: { recipientId: string; toSignDatas?: any[] } }
    session: { origin: string }
    approvalRes: SignPsbtResult
  }) => {
    await assertRgbReceiveOrigin(params.recipientId, origin)
    const account = await wallet.getCurrentAccount()
    const toSignData = getToSignDatas(params.toSignDatas)[0]!
    const signedPsbt = approvalRes[0]?.psbtHex
    if (!signedPsbt) throw new Error('RGB buy swap signing did not return a PSBT')
    const psbt = bitcoin.Psbt.fromHex(formatPsbtHex(signedPsbt))
    const sourcePsbt = bitcoin.Psbt.fromHex(formatPsbtHex(toSignData.psbtHex))
    assertSameUnsignedTx(psbt, sourcePsbt)
    const buyerInputIndexes = new Set(toSignData.toSignInputs.map(input => input.index))
    assertNoCounterpartyPsbtSignatures(psbt, buyerInputIndexes)
    assertExternalSignedPsbt(account, { ...toSignData, autoFinalized: false }, psbt.toHex())
    const transaction = ((psbt.data.globalMap.unsignedTx as any).tx ||
      psbt.data.globalMap.unsignedTx) as any
    const txid = transaction.getId()
    const buyerSignedPsbtHash = bitcoin.crypto.sha256(psbt.toBuffer()).toString('hex')
    await wallet.stageRgbBuySwapIntent({
      recipientId: params.recipientId,
      txid,
      buyerSignedPsbtHash,
    })
    return {
      recipientId: params.recipientId,
      txid,
      status: 'buyer_signed' as const,
      buyerSignedPsbt: psbt.toHex(),
    }
  }

  /** Verify the Proxy v1 sender/backend commit, then send ACK without broadcasting. */
  acceptRgbBuySwap = async ({ data: { params }, session: { origin } }: {
    data: { params: { recipientId: string; backendCommit: string } }
    session: { origin: string }
  }) => {
    if (!params.recipientId || !params.backendCommit) {
      throw new Error('recipientId and backendCommit are required')
    }
    const receive = await assertRgbReceiveOrigin(params.recipientId, origin)
    const intent = receive.buySwapIntent
    if (
      !intent ||
      !receive.proxyTransferId ||
      !receive.proxySenderPublicKey ||
      !proxyV1Verify(
        receive.proxySenderPublicKey,
        params.backendCommit,
        rgbBuySwapCommitMessage({
          proxyTransferId: receive.proxyTransferId,
          txid: intent.txid,
          buyerSignedPsbtHash: intent.buyerSignedPsbtHash,
        })
      )
    ) {
      throw new Error('RGB buy swap backend commitment is invalid')
    }
    const accepted = await wallet.acceptRgbBuySwap({ recipientId: params.recipientId })
    return { recipientId: params.recipientId, status: accepted.status }
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

  @Reflect.metadata('PRECHECK', validateCosmosEnableRequest)
  @Reflect.metadata('APPROVAL', ['CosmosConnect'])
  cosmosEnable = async ({
    data: {
      params: { chainId },
    },
  }) => {
    if (!hasOwn(wallet.cosmosChainInfoMap, chainId)) {
      throw new Error(`Unsupported Cosmos network: ${String(chainId)}`)
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
      const { chainId, signerAddress, signDoc: input } = req.data.params
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
      const prepared = await wallet.prepareCosmosDirectSignRequest({ chainId, signerAddress, signDoc })
      req.data.params = {
        chainId,
        signerAddress,
        signDoc: prepared.signDoc,
        signBytesHex: prepared.signBytesHex,
        summary: prepared.summary,
      }
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
      const { chainId, signerAddress, type: dataType, data } = req.data.params
      const prepared = await wallet.prepareCosmosArbitrarySignRequest({
        chainId,
        signerAddress,
        dataType,
        data,
      })
      req.data.params = { chainId, signerAddress, dataType, data, signBytesHex: prepared.signBytesHex }
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
