import { SignPsbtParams, SignedData } from '@unisat/wallet-shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import { useFeeRateBar } from 'src/hooks'
import {
  getRgbIconShortName,
  getRgbTokenPrecision,
  isValidRgbDecimalAmount,
  toRgbAtomicAmount,
  toRgbDisplayAmount,
} from 'src/utils/rgb-amount-utils'
import { decodeRgbInvoice } from 'src/utils/rgb-invoice-utils'

export enum SendRGBScreenStep {
  CREATE_TX,
  SIGN_TX,
  FEE_POOL_COMPLETED,
}

const RGB_INVOICE_UNAVAILABLE_ERROR_CODE = 'RGB_INVOICE_UNAVAILABLE'
const RGB_FEE_POOL_INSUFFICIENT_BTC_ERROR_CODE = 'RGB_FEE_POOL_INSUFFICIENT_BTC'

type InvoiceAvailability = 'idle' | 'checking' | 'available' | 'unavailable' | 'error'
type ProxyApprovalStatus = 'idle' | 'checking' | 'ready' | 'error'

export type RgbFeePoolRequirement = {
  requiredSatoshis: number
  availableSatoshis: number
  missingSatoshis: number
  topUpSatoshis: number
  estimatedFeeSatoshis: number
  feePoolUtxoCount: number
}

function getRgbFeePoolRequirement(error: unknown): RgbFeePoolRequirement | undefined {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined
  if (record?.['code'] !== RGB_FEE_POOL_INSUFFICIENT_BTC_ERROR_CODE) return undefined
  const data =
    record['data'] && typeof record['data'] === 'object'
      ? (record['data'] as Record<string, unknown>)
      : undefined
  const values = [
    'requiredSatoshis',
    'availableSatoshis',
    'missingSatoshis',
    'topUpSatoshis',
    'estimatedFeeSatoshis',
    'feePoolUtxoCount',
  ].map(key => Number(data?.[key]))
  if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) return undefined
  const [
    requiredSatoshis,
    availableSatoshis,
    missingSatoshis,
    topUpSatoshis,
    estimatedFeeSatoshis,
    feePoolUtxoCount,
  ] = values
  return {
    requiredSatoshis,
    availableSatoshis,
    missingSatoshis,
    topUpSatoshis,
    estimatedFeeSatoshis,
    feePoolUtxoCount,
  }
}

function getRgbErrorMessage(error: unknown): string | undefined {
  const seen = new Set<unknown>()
  const read = (value: unknown): string | undefined => {
    if (typeof value === 'string') {
      const message = value.trim()
      return message && message !== 'Object' && message !== '[object Object]' ? message : undefined
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return undefined
    seen.add(value)
    const record = value as Record<string, unknown>
    return (
      read(record['message']) ||
      read(record['msg']) ||
      read(record['reason']) ||
      read(record['error']) ||
      read(record['cause'])
    )
  }
  return read(error)
}

function isMissingRgbFeeFunding(error: unknown): boolean {
  return getRgbErrorMessage(error)?.includes(
    'RGB transfer requires an ordinary BTC UTXO to pay the network fee'
  ) === true
}

export function getSendErrorMessage(
  error: unknown,
  fallback: string,
  invoiceUnavailableMessage: string,
  t: (key: string, substitutions?: Record<string, string>) => string
): string {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined
  if (
    record?.['code'] === RGB_INVOICE_UNAVAILABLE_ERROR_CODE ||
    record?.['message'] === RGB_INVOICE_UNAVAILABLE_ERROR_CODE
  ) {
    return invoiceUnavailableMessage
  }
  if (record?.['code'] === RGB_FEE_POOL_INSUFFICIENT_BTC_ERROR_CODE) {
    const requirement = getRgbFeePoolRequirement(error)
    if (requirement) {
      return t('rgb_fee_pool_insufficient_btc', {
        required: String(requirement.requiredSatoshis),
        available: String(requirement.availableSatoshis),
        missing: String(requirement.missingSatoshis),
      })
    }
    return t('rgb_fee_pool_insufficient_btc_generic')
  }
  return getRgbErrorMessage(error) || fallback
}

function isSameRgbAssetId(a?: string, b?: string) {
  const normalize = (value?: string) => value?.replace(/^rgb:/, '')
  return !!a && !!b && normalize(a) === normalize(b)
}

function isRgbAmountWithinSpendable(amount: string | undefined, spendable: string) {
  if (!amount || !/^\d+$/.test(amount) || !/^\d+$/.test(spendable)) return false
  return BigInt(amount) <= BigInt(spendable)
}

function getTokenIconInfo(tokenBalance: unknown, name: string, ticker: string) {
  const record =
    tokenBalance && typeof tokenBalance === 'object' ? (tokenBalance as Record<string, any>) : {}
  const iconInfo =
    record['iconInfo'] && typeof record['iconInfo'] === 'object'
      ? (record['iconInfo'] as Record<string, any>)
      : {}
  const iconUrl = typeof iconInfo['iconUrl'] === 'string' ? iconInfo['iconUrl'] : ''
  return { iconUrl, iconShortName: getRgbIconShortName(name, ticker) }
}

function getRgbBeginTxid(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record['txid'] === 'string') return record['txid']

  const data = record['data']
  if (data && typeof data === 'object') {
    const dataRecord = data as Record<string, unknown>
    if (typeof dataRecord['txid'] === 'string') return dataRecord['txid']
  }

  return ''
}

function isRgbInvoiceUnavailable(error: unknown) {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined
  return (
    record?.['code'] === RGB_INVOICE_UNAVAILABLE_ERROR_CODE ||
    record?.['message'] === RGB_INVOICE_UNAVAILABLE_ERROR_CODE
  )
}

export function useSendRGBScreenLogic() {
  const nav = useNavigation()
  const wallet = useWallet()
  const tools = useTools()
  const { t } = useI18n()
  const { assetId, tokenBalance, burn = false } = nav.getRouteState<'SendRGBScreen'>()
  const { feeRate } = useFeeRateBar()
  const [invoice, setInvoice] = useState('')
  const [amount, setAmount] = useState('')
  const [burnReason, setBurnReason] = useState('')
  const [burnDestinationChainId, setBurnDestinationChainId] = useState(42161)
  const [donation, setDonation] = useState(false)
  const [error, setError] = useState('')
  const [feePoolRequirement, setFeePoolRequirement] = useState<RgbFeePoolRequirement>()
  const [step, setStep] = useState(SendRGBScreenStep.CREATE_TX)
  const [signRequestVersion, setSignRequestVersion] = useState(0)
  const [invoiceAvailability, setInvoiceAvailability] = useState<InvoiceAvailability>('idle')
  const [invoiceAvailabilityError, setInvoiceAvailabilityError] = useState('')
  const [proxyApprovalStatus, setProxyApprovalStatus] = useState<ProxyApprovalStatus>('idle')
  const [proxyApprovalEndpoints, setProxyApprovalEndpoints] = useState<string[]>([])
  const [proxyApprovalAccepted, setProxyApprovalAccepted] = useState(false)
  const [proxyApprovalError, setProxyApprovalError] = useState('')
  const feePoolTransitionStarted = useRef(false)
  const invoiceInputVersion = useRef(0)
  const prepareRgbSendRef = useRef<() => Promise<void>>(async () => undefined)
  const transferData = useRef<{
    toSignData?: any
    beginResult?: any
    pendingVanillaTxid?: string
    feePoolTopUp?: boolean
  }>({})

  const ticker = tokenBalance?.ticker || 'RGB'
  const name = tokenBalance?.name || ticker
  const rawSpendable = tokenBalance?.spendable?.toString() || '0'
  const decodedInvoice = useMemo(() => decodeRgbInvoice(invoice), [invoice])
  const invoiceAmount = decodedInvoice.amount
  const invoiceAssetId = decodedInvoice.assetId
  const invoiceAssetMismatch = !!invoiceAssetId && !isSameRgbAssetId(invoiceAssetId, assetId)
  const isBfaAsset = String(tokenBalance?.schema || '').toUpperCase() === 'BFA'
  const invoiceProxyPublicKey = decodedInvoice.query['pk']
  const bfaInvoiceUnsupported =
    isBfaAsset &&
    invoice.trim().length > 0 &&
    !(typeof invoiceProxyPublicKey === 'string' && /^[0-9a-f]{64}$/.test(invoiceProxyPublicKey))
  const hasTransportEndpoint = decodedInvoice.transportEndpoints.length > 0
  const invoiceInvalid = !burn &&
    invoice.trim().length > 0 && (!decodedInvoice.valid || !hasTransportEndpoint)
  const invoiceReadyForAmount = burn || (
    invoice.trim().length > 0 &&
    decodedInvoice.valid &&
    hasTransportEndpoint &&
    !invoiceAssetMismatch &&
    !bfaInvoiceUnsupported)
  const invoiceValidationMessage = burn ? '' : invoiceInvalid
    ? t('invalid_rgb_invoice')
    : invoiceAssetMismatch
      ? t('invoice_asset_mismatch')
      : bfaInvoiceUnsupported
        ? t('rgb_bfa_invoice_not_supported')
        : proxyApprovalStatus === 'error'
          ? proxyApprovalError || t('rgb_invoice_transport_unreachable')
        : invoiceAvailability === 'unavailable'
          ? t('rgb_invoice_unavailable')
          : invoiceAvailability === 'error'
            ? invoiceAvailabilityError || t('rgb_invoice_transport_unreachable')
            : ''
  const requiresAmount = burn || (invoice.trim().length > 0 && decodedInvoice.needsAmount)
  const amountInput = amount.trim()
  const assetPrecision = getRgbTokenPrecision(tokenBalance)
  // The RGB service already excludes reserved allocations from spendable.
  // Do not hide unrelated spendable allocations merely because another send is pending.
  const spendable = toRgbDisplayAmount(rawSpendable, assetPrecision)
  const normalizedAmount = toRgbAtomicAmount(amountInput, assetPrecision)
  const isAmountFormatValid = isValidRgbDecimalAmount(amountInput, assetPrecision)
  const burnBelowMinimum = burn && isAmountFormatValid &&
    BigInt(normalizedAmount) < 10n ** BigInt(assetPrecision)
  const isAmountValid = !requiresAmount ||
    (isAmountFormatValid && /[1-9]/.test(normalizedAmount) && !burnBelowMinimum)
  const requestedAmount = requiresAmount ? normalizedAmount : invoiceAmount
  const insufficientBalance =
    invoiceReadyForAmount &&
    isAmountValid &&
    !isRgbAmountWithinSpendable(requestedAmount, rawSpendable)
  const iconInfo = getTokenIconInfo(tokenBalance, name, ticker)
  const displayInvoiceAmount = toRgbDisplayAmount(invoiceAmount, assetPrecision)
  const displayAmount = requiresAmount ? amount : displayInvoiceAmount
  const amountPlaceholder = requiresAmount ? '0' : invoice.trim() ? t('any_amount') : '0'
  const amountMuted = !displayAmount
  const amountInvalidVisible = requiresAmount && amount.trim().length > 0 && !isAmountValid
  const amountValidationMessage = !amountInvalidVisible
    ? ''
    : !isAmountFormatValid
      ? t('rgb_amount_precision_invalid', { precision: String(assetPrecision) })
      : burnBelowMinimum
        ? t('rgb_burn_minimum_amount', { ticker })
      : t('enter_amount_greater_than_0')
  const blockingSendMessage = ''

  const proxyApprovalReady =
    burn ||
    (proxyApprovalStatus === 'ready' &&
      (proxyApprovalEndpoints.length === 0 || proxyApprovalAccepted))

  useEffect(() => {
    if (
      burn ||
      !decodedInvoice.valid ||
      !hasTransportEndpoint ||
      invoiceAssetMismatch ||
      bfaInvoiceUnsupported
    ) {
      setProxyApprovalStatus('idle')
      setProxyApprovalEndpoints([])
      setProxyApprovalAccepted(false)
      setProxyApprovalError('')
      return undefined
    }

    let canceled = false
    setProxyApprovalStatus('checking')
    setProxyApprovalEndpoints([])
    setProxyApprovalAccepted(false)
    setProxyApprovalError('')
    void wallet
      .getRgbProxyApprovalRequirement({ endpoints: decodedInvoice.transportEndpoints })
      .then(requirement => {
        if (canceled) return
        setProxyApprovalEndpoints(requirement.endpoints)
        setProxyApprovalStatus('ready')
      })
      .catch(error => {
        if (canceled) return
        setProxyApprovalStatus('error')
        setProxyApprovalError(getRgbErrorMessage(error) || t('rgb_invoice_transport_unreachable'))
      })

    return () => {
      canceled = true
    }
  }, [
    bfaInvoiceUnsupported,
    burn,
    decodedInvoice.submissionInvoice,
    decodedInvoice.valid,
    hasTransportEndpoint,
    invoiceAssetMismatch,
    t,
    wallet,
  ])

  const checkInvoiceAvailability = useCallback(async () => {
    if (typeof wallet.checkRgbInvoiceAvailability !== 'function') return
    const inputVersion = invoiceInputVersion.current
    setInvoiceAvailability('checking')
    setInvoiceAvailabilityError('')
    try {
      await wallet.checkRgbInvoiceAvailability({ invoice: decodedInvoice.submissionInvoice })
      if (inputVersion === invoiceInputVersion.current) setInvoiceAvailability('available')
    } catch (error) {
      if (inputVersion !== invoiceInputVersion.current) throw error
      if (isRgbInvoiceUnavailable(error)) {
        setInvoiceAvailability('unavailable')
        throw error
      }
      setInvoiceAvailability('error')
      setInvoiceAvailabilityError(getRgbErrorMessage(error) || t('rgb_invoice_transport_unreachable'))
      throw error
    }
  }, [decodedInvoice.submissionInvoice, t, wallet])

  useEffect(() => {
    if (
      !decodedInvoice.valid ||
      !hasTransportEndpoint ||
      invoiceAssetMismatch ||
      bfaInvoiceUnsupported ||
      !proxyApprovalReady
    ) {
      setInvoiceAvailability('idle')
      setInvoiceAvailabilityError('')
      return undefined
    }
    let canceled = false
    const timer = setTimeout(() => {
      setInvoiceAvailability('checking')
      setInvoiceAvailabilityError('')
      void wallet
        .checkRgbInvoiceAvailability({ invoice: decodedInvoice.submissionInvoice })
        .then(() => {
          if (!canceled) setInvoiceAvailability('available')
        })
        .catch(error => {
          if (canceled) return
          if (isRgbInvoiceUnavailable(error)) {
            setInvoiceAvailability('unavailable')
            return
          }
          setInvoiceAvailability('error')
          setInvoiceAvailabilityError(
            getRgbErrorMessage(error) || t('rgb_invoice_transport_unreachable')
          )
        })
    }, 400)
    return () => {
      canceled = true
      clearTimeout(timer)
    }
  }, [
    decodedInvoice.submissionInvoice,
    decodedInvoice.valid,
    hasTransportEndpoint,
    invoiceAssetMismatch,
    bfaInvoiceUnsupported,
    proxyApprovalReady,
    t,
    wallet,
  ])

  const disabled = useMemo(() => {
    return (
      !invoiceReadyForAmount ||
      (!burn && !proxyApprovalReady) ||
      (!burn && (invoiceAvailability === 'checking' ||
        invoiceAvailability === 'unavailable' || invoiceAvailability === 'error')) ||
      feeRate <= 0 ||
      !isAmountValid ||
      insufficientBalance ||
      (burn && (burnDestinationChainId === 728126428
        ? !(/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(burnReason.trim()) ||
          /^(?:0x)?41[0-9a-f]{40}$/i.test(burnReason.trim()))
        : !/^(?:0x)?[0-9a-f]{40}$/i.test(burnReason.trim()) ||
          /^0+$/.test(burnReason.trim().replace(/^0x/i, ''))))
    )
  }, [invoiceReadyForAmount, proxyApprovalReady, feeRate, isAmountValid, insufficientBalance, invoiceAvailability, burn, burnReason, burnDestinationChainId])

  const onClickBack = () => {
    nav.goBack()
  }

  const onInvoiceChange = (value: string) => {
    invoiceInputVersion.current++
    setInvoice(value)
    setAmount('')
    setError('')
    setFeePoolRequirement(undefined)
    setInvoiceAvailability('idle')
    setInvoiceAvailabilityError('')
    setProxyApprovalStatus('idle')
    setProxyApprovalEndpoints([])
    setProxyApprovalAccepted(false)
    setProxyApprovalError('')
  }

  const onAmountChange = (value: string) => {
    setAmount(value)
  }

  const onClickMaxAmount = () => {
    setAmount(spendable)
  }

  const prepareRgbSend = async () => {
    const beginResult = await wallet.createRgbSendBegin({
      invoice: burn ? '' : decodedInvoice.submissionInvoice,
      assetId: invoiceAssetId || assetId,
      amount: requiresAmount ? normalizedAmount : undefined,
      ticker,
      name,
      precision: assetPrecision,
      feeRate,
      donation,
      burn,
      ...(burnReason.trim() ? { burnReason: burnReason.trim() } : {}),
      ...(burn ? { burnDestinationChainId } : {}),
    })
    const toSignData = beginResult?.toSignData
    if (!toSignData) {
      throw new Error(t('rgb_send_transaction_unavailable'))
    }
    transferData.current = {
      beginResult,
      toSignData,
      pendingVanillaTxid: getRgbBeginTxid(beginResult),
    }
    // Fee-pool funding leaves the UI on SIGN_TX. Its completion replaces the
    // signing request with the RGB transfer PSBT, so changing the ref alone
    // would leave SignPsbt rendering the old funding transaction.
    setSignRequestVersion(version => version + 1)
    setStep(SendRGBScreenStep.SIGN_TX)
  }

  const prepareFeePoolTopUp = async () => {
    const topUp = await wallet.createRgbFeePoolTopUpBegin({ feeRate })
    if (!topUp?.toSignData) throw new Error(t('rgb_send_transaction_unavailable'))
    transferData.current = { toSignData: topUp.toSignData, feePoolTopUp: true }
    setSignRequestVersion(version => version + 1)
    setStep(SendRGBScreenStep.SIGN_TX)
  }

  const onClickNext = async () => {
    if (!Number.isFinite(feeRate) || feeRate <= 0) return
    const inputVersion = invoiceInputVersion.current

    setError('')
    setFeePoolRequirement(undefined)
    tools.showLoading(true)
    try {
      if (!burn && (!decodedInvoice.valid || !hasTransportEndpoint || invoiceAssetMismatch || bfaInvoiceUnsupported)) {
        throw new Error(invoiceValidationMessage || t('invalid_rgb_invoice'))
      }
      if (!burn) {
        const requirement = await wallet.getRgbProxyApprovalRequirement({
          endpoints: decodedInvoice.transportEndpoints,
        })
        if (inputVersion !== invoiceInputVersion.current) return
        const displayedEndpointsMatch =
          requirement.endpoints.length === proxyApprovalEndpoints.length &&
          requirement.endpoints.every(endpoint => proxyApprovalEndpoints.includes(endpoint))
        setProxyApprovalEndpoints(requirement.endpoints)
        setProxyApprovalStatus('ready')
        if (requirement.endpoints.length > 0 && (!proxyApprovalAccepted || !displayedEndpointsMatch)) {
          setProxyApprovalAccepted(false)
          return
        }
        if (requirement.endpoints.length > 0) {
          await wallet.approveRgbProxyEndpoints({ endpoints: requirement.endpoints })
          if (inputVersion !== invoiceInputVersion.current) return
        }
      }
      // Always run one final, read-only probe before creating a PSBT: a
      // recipient ID can be occupied after the debounce check completed.
      if (!burn) await checkInvoiceAvailability()
      if (inputVersion !== invoiceInputVersion.current) return
      const feePool = await wallet.getRgbFeePoolStatus({ feeRate })
      if (inputVersion !== invoiceInputVersion.current) return
      if (!feePool.ready) {
        await prepareFeePoolTopUp()
        return
      }
      try {
        await prepareRgbSend()
      } catch (error) {
        if (!isMissingRgbFeeFunding(error)) throw error
        await prepareFeePoolTopUp()
      }
    } catch (e) {
      if (inputVersion !== invoiceInputVersion.current) return
      const requirement = getRgbFeePoolRequirement(e)
      if (requirement) {
        setFeePoolRequirement(requirement)
        return
      }
      setError(
        getSendErrorMessage(
          e,
          t('rgb_send_transaction_unavailable'),
          t('rgb_invoice_unavailable'),
          t
        )
      )
    } finally {
      tools.showLoading(false)
    }
  }

  const signPsbtParams: SignPsbtParams = {
    data: {
      toSignDatas: transferData.current.toSignData ? [transferData.current.toSignData] : [],
    },
  }

  const onSignPsbtHandleConfirm = async (signedDatas: SignedData[]) => {
    tools.showLoading(true)
    try {
      const signedPsbt = signedDatas[0]?.psbtHex
      if (!signedPsbt) {
        throw new Error(t('rgb_psbt_signing_missing_result'))
      }
      if (transferData.current.feePoolTopUp) {
        await wallet.createRgbFeePoolTopUpEnd({ signedPsbt })
        transferData.current = {}
        feePoolTransitionStarted.current = false
        setStep(SendRGBScreenStep.FEE_POOL_COMPLETED)
        return
      }
      const endResult = await wallet.createRgbSendEnd({
        signedPsbt,
        transferId: transferData.current.pendingVanillaTxid,
      })
      const txid =
        endResult?.txid || endResult?.bitcoinTxid || endResult?.txId || endResult?.id || ''
      const transferId = endResult?.transferId || transferData.current.pendingVanillaTxid
      if (!transferId) {
        throw new Error(t('rgb_send_transaction_unavailable'))
      }
      nav.navigate('RGBTransferDetailScreen', {
        transferId,
        source: 'send_result',
        initialTransfer: {
          id: `local-send:${transferId}`,
          transferId,
          assetId,
          ticker,
          name,
          precision: assetPrecision,
          type: 'send',
          amount: requiresAmount ? normalizedAmount : invoiceAmount || undefined,
          txid,
          timestamp: Date.now(),
          status:
            endResult?.status === 'waiting_ack'
              ? 'waiting_ack'
              : endResult?.status === 'ready_to_broadcast'
                ? 'ready_to_broadcast'
              : endResult?.status === 'broadcast_failed'
                ? 'broadcast_failed'
                : endResult?.status === 'rejected'
                  ? 'rejected'
                  : endResult?.status === 'canceled'
                    ? 'canceled'
                    : 'broadcasted',
          local: true,
          ...(burn ? { burn: true, burnDestinationChainId } : {}),
        },
      })
      transferData.current = {}
    } catch (e) {
      nav.navigate('TxFailScreen', {
        error: getSendErrorMessage(
          e,
          t('rgb_send_transaction_unavailable'),
          t('rgb_invoice_unavailable'),
          t
        ),
      })
    } finally {
      tools.showLoading(false)
    }
  }

  const abortPendingSend = async () => {
    const txid = transferData.current.pendingVanillaTxid
    transferData.current = {}
    if (!txid) return

    try {
      await wallet.abortRgbVanillaTx({ txid, discardUnsigned: true })
    } catch {
      // Cancellation is best-effort while leaving the signing flow.
    }
  }

  const onSignPsbtHandleCancel = async () => {
    await abortPendingSend()
    setStep(SendRGBScreenStep.CREATE_TX)
  }

  const onSignPsbtHandleBack = async () => {
    await abortPendingSend()
    setStep(SendRGBScreenStep.CREATE_TX)
  }

  prepareRgbSendRef.current = prepareRgbSend

  useEffect(() => {
    if (step !== SendRGBScreenStep.FEE_POOL_COMPLETED || feePoolTransitionStarted.current) return
    feePoolTransitionStarted.current = true
    setError('')
    void prepareRgbSendRef.current().catch(e => {
      setStep(SendRGBScreenStep.CREATE_TX)
      setError(
        getSendErrorMessage(
          e,
          t('rgb_send_transaction_unavailable'),
          t('rgb_invoice_unavailable'),
          t
        )
      )
    })
  }, [step, t])

  return {
    step,
    t,
    assetId,
    burn,
    burnReason,
    setBurnReason,
    burnDestinationChainId,
    setBurnDestinationChainId: (chainId: number) => {
      setBurnDestinationChainId(chainId)
      setBurnReason('')
    },
    tokenBalance,
    ticker,
    name,
    assetPrecision,
    spendable,
    iconInfo,
    invoice,
    setInvoice,
    amount,
    setAmount,
    donation,
    setDonation,
    onInvoiceChange,
    onAmountChange,
    onClickMaxAmount,
    requiresAmount,
    isAmountValid,
    insufficientBalance,
    decodedInvoice,
    invoiceAmount,
    displayInvoiceAmount,
    invoiceAssetId,
    invoiceAssetMismatch,
    invoiceInvalid,
    invoiceReadyForAmount,
    invoiceValidationMessage,
    invoiceAvailability,
    proxyApprovalStatus,
    proxyApprovalEndpoints,
    proxyApprovalAccepted,
    setProxyApprovalAccepted,
    displayAmount,
    amountPlaceholder,
    amountMuted,
    amountInvalidVisible,
    amountValidationMessage,
    blockingSendMessage,
    feeRate,
    signRequestVersion,
    error,
    feePoolRequirement,
    dismissFeePoolRequirement: () => setFeePoolRequirement(undefined),
    disabled,
    onClickBack,
    onClickNext,
    signPsbtParams,
    onSignPsbtHandleConfirm,
    onSignPsbtHandleCancel,
    onSignPsbtHandleBack,
  }
}
