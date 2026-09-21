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

const BLOCKING_RGB_SEND_STATUSES = new Set([
  'signed',
  'waiting_ack',
  'broadcasting',
  'broadcast_failed',
])
const RGB_INVOICE_UNAVAILABLE_ERROR_CODE = 'RGB_INVOICE_UNAVAILABLE'
const RGB_FEE_POOL_INSUFFICIENT_BTC_ERROR_CODE = 'RGB_FEE_POOL_INSUFFICIENT_BTC'

type InvoiceAvailability = 'idle' | 'checking' | 'available' | 'unavailable' | 'error'

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
  if (error instanceof Error && error.message) return error.message
  if (!error || typeof error !== 'object') return undefined
  const record = error as Record<string, unknown>
  return typeof record['message'] === 'string'
    ? record['message']
    : typeof record['msg'] === 'string'
      ? record['msg']
      : typeof record['reason'] === 'string'
        ? record['reason']
        : undefined
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

function getBlockingRgbSendStatus(
  transfers: {
    list?: Array<{ assetId?: string; local?: boolean; status?: string; type?: string }>
  },
  assetId: string
) {
  return transfers.list?.find(
    transfer =>
      transfer.local &&
      transfer.type === 'send' &&
      isSameRgbAssetId(transfer.assetId, assetId) &&
      BLOCKING_RGB_SEND_STATUSES.has(String(transfer.status || '').toLowerCase())
  )?.status
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
  const { assetId, tokenBalance } = nav.getRouteState<'SendRGBScreen'>()
  const { feeRate } = useFeeRateBar()
  const [invoice, setInvoice] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [feePoolRequirement, setFeePoolRequirement] = useState<RgbFeePoolRequirement>()
  const [step, setStep] = useState(SendRGBScreenStep.CREATE_TX)
  const [signRequestVersion, setSignRequestVersion] = useState(0)
  const [blockingSendStatus, setBlockingSendStatus] = useState<string>()
  const [invoiceAvailability, setInvoiceAvailability] = useState<InvoiceAvailability>('idle')
  const [invoiceAvailabilityError, setInvoiceAvailabilityError] = useState('')
  const feePoolTransitionStarted = useRef(false)
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
  const hasTransportEndpoint = decodedInvoice.transportEndpoints.length > 0
  const invoiceInvalid =
    invoice.trim().length > 0 && (!decodedInvoice.valid || !hasTransportEndpoint)
  const invoiceReadyForAmount =
    invoice.trim().length > 0 &&
    decodedInvoice.valid &&
    hasTransportEndpoint &&
    !invoiceAssetMismatch
  const invoiceValidationMessage = invoiceInvalid
    ? t('invalid_rgb_invoice')
    : invoiceAssetMismatch
      ? t('invoice_asset_mismatch')
      : invoiceAvailability === 'unavailable'
        ? t('rgb_invoice_unavailable')
        : invoiceAvailability === 'error'
          ? invoiceAvailabilityError || t('rgb_invoice_transport_unreachable')
          : ''
  const requiresAmount = invoice.trim().length > 0 && decodedInvoice.needsAmount
  const amountInput = amount.trim()
  const assetPrecision = getRgbTokenPrecision(tokenBalance)
  const spendable = blockingSendStatus ? '0' : toRgbDisplayAmount(rawSpendable, assetPrecision)
  const normalizedAmount = toRgbAtomicAmount(amountInput, assetPrecision)
  const isAmountFormatValid = isValidRgbDecimalAmount(amountInput, assetPrecision)
  const isAmountValid = !requiresAmount || (isAmountFormatValid && /[1-9]/.test(normalizedAmount))
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
      : t('enter_amount_greater_than_0')
  const blockingSendMessage =
    blockingSendStatus === 'waiting_ack'
      ? t('rgb_transfer_waiting_ack_description')
      : blockingSendStatus
        ? t('rgb_transfer_broadcasting_description')
        : ''

  useEffect(() => {
    let canceled = false
    void wallet
      .getRgbTransfers(1, 50)
      .then(transfers => {
        if (!canceled) setBlockingSendStatus(getBlockingRgbSendStatus(transfers, assetId))
      })
      .catch(() => {
        if (!canceled) setBlockingSendStatus(undefined)
      })

    return () => {
      canceled = true
    }
  }, [assetId, wallet])

  const checkInvoiceAvailability = useCallback(async () => {
    if (typeof wallet.checkRgbInvoiceAvailability !== 'function') return
    setInvoiceAvailability('checking')
    setInvoiceAvailabilityError('')
    try {
      await wallet.checkRgbInvoiceAvailability({ invoice: decodedInvoice.submissionInvoice })
      setInvoiceAvailability('available')
    } catch (error) {
      if (isRgbInvoiceUnavailable(error)) {
        setInvoiceAvailability('unavailable')
        throw error
      }
      setInvoiceAvailability('error')
      setInvoiceAvailabilityError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }, [decodedInvoice.submissionInvoice, wallet])

  useEffect(() => {
    if (!decodedInvoice.valid || !hasTransportEndpoint || invoiceAssetMismatch) {
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
          if (error.message) {
            setInvoiceAvailabilityError(error.message)
            return
          }
          setInvoiceAvailabilityError(error instanceof Error ? error.message : String(error))
        })
    }, 400)
    return () => {
      canceled = true
      clearTimeout(timer)
    }
  }, [decodedInvoice.submissionInvoice, decodedInvoice.valid, hasTransportEndpoint, invoiceAssetMismatch, wallet])

  const disabled = useMemo(() => {
    return (
      !invoiceReadyForAmount ||
      invoiceAvailability === 'checking' ||
      invoiceAvailability === 'unavailable' ||
      invoiceAvailability === 'error' ||
      feeRate <= 0 ||
      !isAmountValid ||
      insufficientBalance ||
      !!blockingSendStatus
    )
  }, [invoiceReadyForAmount, feeRate, isAmountValid, insufficientBalance, blockingSendStatus, invoiceAvailability])

  const onClickBack = () => {
    nav.goBack()
  }

  const onInvoiceChange = (value: string) => {
    setInvoice(value)
    setAmount('')
    setInvoiceAvailability('idle')
    setInvoiceAvailabilityError('')
  }

  const onAmountChange = (value: string) => {
    setAmount(value)
  }

  const onClickMaxAmount = () => {
    setAmount(spendable)
  }

  const prepareRgbSend = async () => {
    const beginResult = await wallet.createRgbSendBegin({
      invoice: decodedInvoice.submissionInvoice,
      assetId: invoiceAssetId || assetId,
      amount: requiresAmount ? normalizedAmount : undefined,
      ticker,
      name,
      precision: assetPrecision,
      feeRate,
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

  const onClickNext = async () => {
    if (!Number.isFinite(feeRate) || feeRate <= 0) return

    setError('')
    setFeePoolRequirement(undefined)
    tools.showLoading(true)
    try {
      const transfers = await wallet.getRgbTransfers(1, 50)
      const pendingStatus = getBlockingRgbSendStatus(transfers, assetId)
      if (pendingStatus) {
        setBlockingSendStatus(pendingStatus)
        throw new Error(
          pendingStatus === 'waiting_ack'
            ? t('rgb_transfer_waiting_ack_description')
            : t('rgb_transfer_broadcasting_description')
        )
      }
      if (!decodedInvoice.valid || !hasTransportEndpoint || invoiceAssetMismatch) {
        throw new Error(invoiceValidationMessage || t('invalid_rgb_invoice'))
      }
      // Always run one final, read-only probe before creating a PSBT: a
      // recipient ID can be occupied after the debounce check completed.
      await checkInvoiceAvailability()
      // Keep compatibility with lightweight wallet implementations while the
      // background service rolls out the dedicated fee-pool RPCs.
      const feePool = wallet.getRgbFeePoolStatus
        ? await wallet.getRgbFeePoolStatus({ feeRate })
        : { ready: true }
      if (!feePool.ready) {
        const topUp = await wallet.createRgbFeePoolTopUpBegin({ feeRate })
        if (!topUp?.toSignData) throw new Error(t('rgb_send_transaction_unavailable'))
        transferData.current = {
          toSignData: topUp.toSignData,
          feePoolTopUp: true,
        }
        setSignRequestVersion(version => version + 1)
        setStep(SendRGBScreenStep.SIGN_TX)
        return
      }
      await prepareRgbSend()
    } catch (e) {
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
              : endResult?.status === 'broadcast_failed'
                ? 'broadcast_failed'
                : endResult?.status === 'rejected'
                  ? 'rejected'
                  : endResult?.status === 'canceled'
                    ? 'canceled'
                    : 'broadcasted',
          local: true,
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
      await wallet.abortRgbVanillaTx({ txid })
    } catch (e) {
      console.warn('Failed to abort RGB send tx', e)
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
    tokenBalance,
    ticker,
    name,
    spendable,
    iconInfo,
    invoice,
    setInvoice,
    amount,
    setAmount,
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
