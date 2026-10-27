import { ErrorCodes } from '@unisat/wallet-shared'
import type { SignPsbtParams, SignedData, ToSignData } from '@unisat/wallet-shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import { useFeeRateBar } from 'src/hooks'
import {
  formatMaxRgbDisplayAmount,
  getRgbIconShortName,
  getRgbTokenPrecision,
  isValidRgbDecimalAmount,
  normalizeRgbAmountInput,
  MAX_RGB_ATOMIC_AMOUNT,
  toRgbAtomicAmount,
  toRgbDisplayAmount,
} from 'src/utils/rgb-amount-utils'
import { UNCONFIGURED_RGB_USDT_ASSET_ID, useRGBListLogic } from './useRGBListLogic'

export type RGBReceiveMode = 'any' | 'fixed'
export type RGBInvoiceRecipientType = 'blind' | 'witness'
export type RGBReceiveScreenStep = 'create_invoice' | 'pending_invoices' | 'sign_rgb_utxo'
export type RgbAssetItem = Record<string, unknown>

export type RgbPendingReceiveInvoice = {
  invoice: string
  recipientId?: string
  assetId?: string | null
  amount?: number | string
  status?: string
  kind?: string
  transferKind?: string
  canCancel?: boolean
  batchTransferIdx?: number
  expirationTimestamp?: number
  createdAt?: number
  [key: string]: unknown
}

type RgbAllocationSummary = {
  available?: boolean
  availableAllocationCount?: number
  freeAllocationCount?: number
  colorableUtxoCount?: number
  [key: string]: unknown
}

type RgbPendingReceiveInvoicesResult = {
  list?: RgbPendingReceiveInvoice[]
  [key: string]: unknown
}

type RgbCancelReceiveInvoiceResult = {
  changed: boolean
}

type RgbAllocationWallet = {
  getRgbAllocationSummary(params?: { skipSync?: boolean }): Promise<RgbAllocationSummary>
}

type RgbReceiveWallet = {
  createRgbBlindReceive(params: {
    assetId?: string
    amount?: number | string
    durationSeconds?: number
    skipSync?: boolean
  }): Promise<unknown>
  createRgbWitnessReceive(params: {
    assetId?: string
    amount?: number | string
    durationSeconds?: number
    skipSync?: boolean
  }): Promise<unknown>
  getRgbPendingReceiveInvoices(params?: {
    skipSync?: boolean
  }): Promise<RgbPendingReceiveInvoicesResult>
  cancelRgbReceiveInvoice(params: {
    batchTransferIdx: number
    skipSync?: boolean
  }): Promise<RgbCancelReceiveInvoiceResult>
  getRgbInvoiceExpirySeconds(): Promise<number>
  setRgbInvoiceExpirySeconds(seconds: number): Promise<void>
}

type RGBReceiveRouteState = {
  assetId?: string
  tokenBalance?: unknown
  initialStep?: RGBReceiveScreenStep
}

export const ANY_RGB_ASSET_ID = '__any_rgb_asset__'
export const ANY_RGB_ASSET = {
  assetId: ANY_RGB_ASSET_ID,
  ticker: 'Any RGB Asset',
  name: 'Any RGB Asset',
  iconInfo: {
    iconShortName: 'RGB',
    iconUrl: '',
  },
}

const DEFAULT_ASSET_TICKER = 'RGB Assets'
const readStringPath = (value: unknown, path: string[]): string | undefined => {
  let current: unknown = value
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }

  return typeof current === 'string' && current.length > 0 ? current : undefined
}

const getInvoiceText = (value: unknown): string => {
  if (!value) return ''
  if (typeof value === 'string') return value

  return readStringPath(getRecordPayload(value) || value, ['invoice']) || JSON.stringify(value)
}

const getErrorMessage = (error: any) => {
  if (typeof error?.msg === 'string') return error.msg
  if (typeof error?.message === 'string') return error.message
  return 'An unknown error occurred'
}

const isRgbProxyInvoiceError = (error: unknown) =>
  /RGB proxy (?:server\.info|invoice\.prepare)/i.test(getErrorMessage(error))

const isRequestAbortError = (error: unknown) =>
  /signal is aborted without reason|signal timed out|the operation was aborted/i.test(getErrorMessage(error)) ||
  (error as { name?: string } | null)?.name === 'AbortError'

const getInvoiceCreationErrorMessage = (
  error: unknown,
  t: (key: string, substitutions?: Record<string, string | number>) => string
) => {
  const message = getErrorMessage(error)
  const timeout = message.match(/RGB proxy [\w.]+ timed out after (\d+) seconds/i)
  if (timeout) return t('rgb_invoice_proxy_timeout', { seconds: timeout[1] })
  if (/RGB proxy [\w.]+ could not connect/i.test(message)) {
    return t('rgb_invoice_proxy_unreachable')
  }
  if (isRequestAbortError(error)) {
    return t('rgb_invoice_request_timeout')
  }
  return message
}

const isInsufficientBtcError = (error: unknown) => {
  const value = error as { code?: number; message?: string; msg?: string }
  if (
    value?.code === ErrorCodes.INSUFFICIENT_BTC_UTXO ||
    value?.code === ErrorCodes.INSUFFICIENT_FEE_UTXO ||
    // Accept errors produced by extension versions before the JSON-RPC code migration.
    value?.code === -2 ||
    value?.code === -7
  ) return true

  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes('insufficient balance') ||
    message.includes('code_insufficient_balance') ||
    message.includes('code_insufficient_fee_utxo')
  )
}

const getRecordPayload = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  const payload = record['data'] ?? record['result']
  if (payload && typeof payload === 'object') {
    return payload as Record<string, unknown>
  }

  return record
}

/**
 * Mempool funding outputs are safe to reserve for another blind invoice: the
 * service excludes outputs that are already reserved, and keeps the invoice
 * unavailable until the funding transaction confirms. Treat them as reusable
 * here so one five-output funding transaction serves five invoices.
 */
const hasReusableRgbAllocation = (summary: unknown) => {
  const value = getRecordPayload(summary)
  if (!value) return false

  if (value['available'] === true) return true

  const availableAllocationCount = Number(
    value['availableAllocationCount'] ?? value['freeAllocationCount'] ?? 0
  )
  if (Number.isFinite(availableAllocationCount) && availableAllocationCount > 0) return true

  const pendingAllocationCount = Number(value['pendingAllocationCount'] ?? 0)
  return Number.isFinite(pendingAllocationCount) && pendingAllocationCount > 0
}

export const getRgbAssetId = (value: unknown) => {
  return readStringPath(value, ['assetId']) || readStringPath(value, ['id']) || ''
}

const getTokenInfo = (value: unknown) => {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  return record?.['tokenInfo'] || record?.['assetInfo'] || record?.['rgbInfo'] || value
}

export const getRgbTokenTicker = (value: unknown) => {
  const tokenInfo = getTokenInfo(value)
  return readStringPath(tokenInfo, ['ticker']) || DEFAULT_ASSET_TICKER
}

const isBfaRgbAsset = (value: unknown) => {
  const tokenInfo = getTokenInfo(value)
  return String(
    readStringPath(tokenInfo, ['schema']) || readStringPath(value, ['schema']) || ''
  ).toUpperCase() === 'BFA'
}

export const getRgbTokenIconInfo = (value: unknown, ticker: string) => {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  const iconInfo =
    record?.['iconInfo'] && typeof record['iconInfo'] === 'object'
      ? (record['iconInfo'] as Record<string, unknown>)
      : {}
  const tokenInfo = getTokenInfo(value)
  const name = readStringPath(tokenInfo, ['name']) || readStringPath(record, ['name'])
  const iconUrl = readStringPath(iconInfo, ['iconUrl']) || readStringPath(record, ['iconUrl']) || ''
  const iconShortName = getRgbIconShortName(name, ticker)
  return { assetId: getRgbAssetId(value), iconUrl, iconShortName }
}

const getPendingInvoiceList = (value: unknown): RgbPendingReceiveInvoice[] => {
  if (!value || typeof value !== 'object') return []
  const record = value as RgbPendingReceiveInvoicesResult
  if (Array.isArray(record.list)) return record.list

  const data = record['data']
  if (
    data &&
    typeof data === 'object' &&
    Array.isArray((data as RgbPendingReceiveInvoicesResult).list)
  ) {
    return (data as RgbPendingReceiveInvoicesResult).list || []
  }

  return []
}

export const isInvoiceForAsset = (item: RgbPendingReceiveInvoice, assetId?: string) => {
  if (!assetId) return true
  return !item.assetId || item.assetId === assetId
}

export const formatRgbPendingAmount = (
  amount: RgbPendingReceiveInvoice['amount'],
  ticker: string,
  emptyAmountText = '',
  precision = 0
) => {
  if (amount === undefined || amount === null || amount === '' || String(amount) === '0') {
    return emptyAmountText
  }
  return `${toRgbDisplayAmount(amount, precision)} ${ticker}`
}

export const formatRgbPendingAmountTag = (
  amount: RgbPendingReceiveInvoice['amount'],
  anyAmountText: string,
  precision = 0
) => {
  if (amount === undefined || amount === null || amount === '' || String(amount) === '0') {
    return anyAmountText
  }
  return toRgbDisplayAmount(amount, precision)
}

export const formatRgbPendingTime = (timestamp?: number) => {
  if (!timestamp) return ''
  const milliseconds = timestamp > 100000000000 ? timestamp : timestamp * 1000
  return new Date(milliseconds).toLocaleString()
}

export const getRgbBatchTransferIdx = (item?: RgbPendingReceiveInvoice) => {
  if (!item) return undefined
  const value = item.batchTransferIdx
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export const isCancelableRgbPendingInvoice = (item?: RgbPendingReceiveInvoice) => {
  if (!item) return false

  const type = String(item.kind || item.transferKind || 'ReceiveBlind').toLowerCase()
  const status = String(item.status || '').toLowerCase()
  return (
    type === 'receiveblind' &&
    item.canCancel !== false &&
    ['waitingconfirmations', 'waitingcounterparty'].includes(status) &&
    getRgbBatchTransferIdx(item) !== undefined
  )
}

export const isDeletableRgbWitnessInvoice = (item?: RgbPendingReceiveInvoice) => {
  if (!item) return false

  const type = String(item.kind || item.transferKind || '').toLowerCase()
  const status = String(item.status || '').toLowerCase()
  return (
    type === 'receivewitness' &&
    item.canCancel !== false &&
    status === 'waitingcounterparty' &&
    getRgbBatchTransferIdx(item) !== undefined
  )
}

export const isRgbPendingInvoiceAwaitingConfirmation = (item?: RgbPendingReceiveInvoice) => {
  return String(item?.status || '').toLowerCase() === 'waitingconfirmations'
}

export const isRgbPendingInvoiceAwaitingAcceptance = (item?: RgbPendingReceiveInvoice) => {
  return String(item?.status || '').toLowerCase() === 'pendingaccept'
}

export const isRgbPendingInvoiceAwaitingSenderBroadcast = (item?: RgbPendingReceiveInvoice) => {
  return String(item?.status || '').toLowerCase() === 'waitingsenderbroadcast'
}

export const isRgbPendingInvoiceAwaitingSenderConfirmation = (item?: RgbPendingReceiveInvoice) => {
  return String(item?.status || '').toLowerCase() === 'waitingsenderconfirmation'
}

export function useRGBReceiveScreenLogic(
  defaultInitialStep: RGBReceiveScreenStep = 'create_invoice'
) {
  const nav = useNavigation()
  const wallet = useWallet()
  const tools = useTools()
  const { t } = useI18n()
  const { feeRate } = useFeeRateBar()
  const { items: allRgbItems = [], loading: rgbLoading } = useRGBListLogic({ focused: true })
  const rgbItems = allRgbItems.filter(item => getRgbAssetId(item) !== UNCONFIGURED_RGB_USDT_ASSET_ID)
  const rgbWallet = wallet as typeof wallet & RgbAllocationWallet & RgbReceiveWallet
  const routeState = nav.getRouteState<'RGBReceiveScreen'>() as RGBReceiveRouteState
  const routeAssetId = routeState?.assetId || ''
  const isAssetLocked = !!routeAssetId
  const [initialStep] = useState<RGBReceiveScreenStep>(
    () => routeState?.initialStep || defaultInitialStep
  )
  const enteredViaPendingInvoices = initialStep === 'pending_invoices'
  const [selectedAssetId, setSelectedAssetId] = useState(routeAssetId)
  const [selectedTokenBalance, setSelectedTokenBalance] = useState<RgbAssetItem | undefined>(
    routeState?.tokenBalance as RgbAssetItem | undefined
  )
  const [mode, setModeState] = useState<RGBReceiveMode>('any')
  const [recipientType, setRecipientType] = useState<RGBInvoiceRecipientType>('blind')
  const [invoiceExpirySeconds, setInvoiceExpirySecondsState] = useState(24 * 60 * 60)
  const invoiceExpiryChanged = useRef(false)
  const setInvoiceExpirySeconds = (value: number) => {
    invoiceExpiryChanged.current = true
    setInvoiceExpirySecondsState(value)
    void rgbWallet.setRgbInvoiceExpirySeconds(value).catch((error) => tools.toastError(getErrorMessage(error)))
  }
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('')
  const [invoice, setInvoice] = useState('')
  const [invoiceLabel, setInvoiceLabel] = useState(t('any_amount'))
  const [selectedPendingInvoice, setSelectedPendingInvoice] = useState<RgbPendingReceiveInvoice>()
  const [error, setError] = useState('')
  const [cancelLoading, setCancelLoading] = useState(false)
  const [pendingLoading, setPendingLoading] = useState(true)
  const [pendingInvoices, setPendingInvoices] = useState<RgbPendingReceiveInvoice[]>([])
  const [step, setStep] = useState<RGBReceiveScreenStep>(initialStep)
  const [utxoToSignData, setUtxoToSignData] = useState<ToSignData>()
  const [utxoPendingVanillaTxid, setUtxoPendingVanillaTxid] = useState('')
  const [resumeCreateInvoiceAfterSign, setResumeCreateInvoiceAfterSign] = useState(false)
  const [insufficientBtcForInvoice, setInsufficientBtcForInvoice] = useState(false)

  useEffect(() => {
    let active = true
    rgbWallet
      .getRgbInvoiceExpirySeconds()
      .then(value => {
        if (active && !invoiceExpiryChanged.current) setInvoiceExpirySecondsState(value > 0 ? value : 24 * 60 * 60)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [rgbWallet])

  const selectedRgbItem =
    selectedAssetId === ANY_RGB_ASSET_ID
      ? ANY_RGB_ASSET
      : rgbItems.find(item => getRgbAssetId(item) === selectedAssetId) ||
        selectedTokenBalance ||
        ANY_RGB_ASSET
  const selectedSpecificAssetId =
    selectedAssetId === ANY_RGB_ASSET_ID ? '' : selectedAssetId || getRgbAssetId(selectedRgbItem)
  const assetId = selectedSpecificAssetId === ANY_RGB_ASSET_ID ? '' : selectedSpecificAssetId
  // An Any Asset invoice intentionally has no contract metadata. In
  // particular, it cannot state a human-readable amount because the asset
  // precision is unknown. A configured token without local contract metadata
  // also cannot encode a fixed display amount safely.
  const canSetFixedAmount = Boolean(
    assetId && !selectedRgbItem['configuredPlaceholder'] && !isBfaRgbAsset(selectedRgbItem)
  )
  const assetTicker = getRgbTokenTicker(selectedRgbItem)
  // Balance list responses can omit metadata; retain the route token's
  // precision so fixed invoice amounts are still encoded in atomic units.
  const assetPrecision = getRgbTokenPrecision({
    ...selectedRgbItem,
    tokenInfo: selectedTokenBalance,
  })
  const displayAmount = amount.trim()
  const isFixedMode = mode === 'fixed' && canSetFixedAmount
  const normalizedAmount = isFixedMode ? toRgbAtomicAmount(displayAmount, assetPrecision) : ''
  const isAmountFormatValid = isValidRgbDecimalAmount(displayAmount, assetPrecision)
  const amountExceedsMaximum =
    isFixedMode && isAmountFormatValid && BigInt(normalizedAmount) > MAX_RGB_ATOMIC_AMOUNT
  const isAmountValid =
    !isFixedMode || (isAmountFormatValid && /[1-9]/.test(normalizedAmount) && !amountExceedsMaximum)
  const amountInvalidVisible = isFixedMode && displayAmount.length > 0 && !isAmountValid

  const onAmountChange = (value: string) => {
    if (!canSetFixedAmount) return
    setAmount(normalizeRgbAmountInput(value, assetPrecision))
  }

  const setMode = (nextMode: RGBReceiveMode) => {
    if (nextMode === 'fixed' && !canSetFixedAmount) {
      setModeState('any')
      setAmount('')
      return
    }
    setModeState(nextMode)
    if (nextMode === 'any') setAmount('')
  }

  const createReceiveInvoice = async (skipSync = false) => {
    const params: {
      assetId?: string
      amount?: string
    } = {}

    if (assetId) {
      params.assetId = assetId
    }

    if (isFixedMode && assetId) {
      params.amount = normalizedAmount
    }

    const request = {
      ...params,
      ...(invoiceExpirySeconds > 0 ? { durationSeconds: invoiceExpirySeconds } : {}),
      ...(skipSync ? { skipSync: true } : {}),
    }
    return recipientType === 'witness'
      ? rgbWallet.createRgbWitnessReceive(request)
      : rgbWallet.createRgbBlindReceive(request)
  }

  const loadPendingInvoices = useCallback(async () => {
    setPendingLoading(true)
    try {
      const applyPendingInvoices = (value: RgbPendingReceiveInvoicesResult) => {
        const list = getPendingInvoiceList(value).filter(
          item => item.invoice && isInvoiceForAsset(item, assetId)
        )
        setPendingInvoices(list)
        setSelectedPendingInvoice(current => {
          if (!current) return current
          return (
            list.find(
              item =>
                (current.recipientId && item.recipientId === current.recipientId) ||
                item.invoice === current.invoice
            ) || current
          )
        })
      }

      const localValue = await rgbWallet.getRgbPendingReceiveInvoices({ skipSync: true })
      applyPendingInvoices(localValue)
      setPendingLoading(false)

      const syncedValue = await rgbWallet.getRgbPendingReceiveInvoices()
      applyPendingInvoices(syncedValue)
    } catch (e: unknown) {
      setError(getInvoiceCreationErrorMessage(e, t))
    } finally {
      setPendingLoading(false)
    }
  }, [assetId, rgbWallet])

  useEffect(() => {
    void loadPendingInvoices()
  }, [loadPendingInvoices])

  const hasPendingInvoiceAwaitingUpdate =
    isRgbPendingInvoiceAwaitingConfirmation(selectedPendingInvoice) ||
    isRgbPendingInvoiceAwaitingSenderBroadcast(selectedPendingInvoice) ||
    isRgbPendingInvoiceAwaitingSenderConfirmation(selectedPendingInvoice) ||
    pendingInvoices.some(
      item =>
        isRgbPendingInvoiceAwaitingConfirmation(item) ||
        isRgbPendingInvoiceAwaitingSenderBroadcast(item) ||
        isRgbPendingInvoiceAwaitingSenderConfirmation(item)
    )

  useEffect(() => {
    if (!hasPendingInvoiceAwaitingUpdate) return undefined

    const intervalId = setInterval(() => void loadPendingInvoices(), 10_000)
    return () => clearInterval(intervalId)
  }, [hasPendingInvoiceAwaitingUpdate, loadPendingInvoices])

  const finishCreateInvoice = async (skipSync = false) => {
    setLoadingText(t('rgb_creating_invoice'))
    const value = await createReceiveInvoice(skipSync)
    const invoice = getInvoiceText(value)
    const pendingInvoice = getRecordPayload(value)
    const recipientId = readStringPath(pendingInvoice, ['recipientId'])
    setInvoice(invoice)
    if (recipientId || pendingInvoice?.['invoice']) {
      setSelectedPendingInvoice(pendingInvoice as RgbPendingReceiveInvoice)
    }
    setStep('create_invoice')
  }

  const getRgbUtxoBeginTxid = (value: unknown) => {
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

  const abortRgbVanillaTx = async (txid?: string) => {
    if (!txid) return
    try {
      await wallet.abortRgbVanillaTx({ txid })
    } catch {
      // Cancellation is best-effort while leaving the signing flow.
    }
  }

  const startCreateRgbUtxoSign = async () => {
    setLoadingText(t('rgb_preparing_utxo'))
    const beginResult = await wallet.createRgbUtxosBegin({
      upTo: true,
      // One funding transaction amortizes several future blind invoices.
      num: 5,
      ...(Number.isFinite(feeRate) && feeRate > 0 ? { feeRate } : {}),
    })
    const beginResultRecord =
      beginResult && typeof beginResult === 'object'
        ? (beginResult as { toSignData?: ToSignData })
        : {}
    const toSignData = beginResultRecord.toSignData

    if (!toSignData) {
      throw new Error(t('rgb_utxo_signing_data_missing'))
    }

    setUtxoToSignData(toSignData)
    setUtxoPendingVanillaTxid(getRgbUtxoBeginTxid(beginResult))
    setResumeCreateInvoiceAfterSign(true)
    setStep('sign_rgb_utxo')
  }

  const ensureRgbAllocation = async () => {
    setLoadingText(t('rgb_checking_utxo'))
    const summary = await rgbWallet.getRgbAllocationSummary({ skipSync: false })
    if (hasReusableRgbAllocation(summary)) {
      return true
    }

    await startCreateRgbUtxoSign()
    return false
  }

  const onCreateInvoice = async () => {
    if (routeAssetId === UNCONFIGURED_RGB_USDT_ASSET_ID) return
    if (!isAmountValid) return
    setLoading(true)
    setLoadingText(t('rgb_checking_utxo'))
    setError('')
    setInsufficientBtcForInvoice(false)
    setInvoice('')
    setSelectedPendingInvoice(undefined)
    setInvoiceLabel(isFixedMode ? `${displayAmount} ${assetTicker}` : t('any_amount'))
    try {
      if (recipientType === 'blind') {
        const hadAllocation = await ensureRgbAllocation()
        if (!hadAllocation) return
      }

      try {
        await finishCreateInvoice(true)
      } catch (invoiceError: unknown) {
        if (isInsufficientBtcError(invoiceError)) {
          setInsufficientBtcForInvoice(true)
          setError('')
          return
        }
        if (isRgbProxyInvoiceError(invoiceError) || isRequestAbortError(invoiceError)) {
          setError(getInvoiceCreationErrorMessage(invoiceError, t))
          return
        }
        setLoadingText(t('rgb_checking_utxo'))
        const summary = await rgbWallet.getRgbAllocationSummary({ skipSync: false })
        if (hasReusableRgbAllocation(summary)) {
          setError(getInvoiceCreationErrorMessage(invoiceError, t))
          return
        }

        await startCreateRgbUtxoSign()
      }
    } catch (e: unknown) {
      if (isInsufficientBtcError(e)) {
        setInsufficientBtcForInvoice(true)
        setError('')
        return
      }
      setError(getInvoiceCreationErrorMessage(e, t))
    } finally {
      setLoading(false)
      setLoadingText('')
    }
  }

  const resetRgbUtxoSignStep = async () => {
    await abortRgbVanillaTx(utxoPendingVanillaTxid)
    setStep('create_invoice')
    setUtxoToSignData(undefined)
    setUtxoPendingVanillaTxid('')
    setResumeCreateInvoiceAfterSign(false)
    setLoading(false)
    setLoadingText('')
  }

  const onSignRgbUtxoHandleConfirm = async (signedDatas: SignedData[]) => {
    tools.showLoading(true)
    setLoading(true)
    setLoadingText(t('rgb_creating_utxo'))
    setError('')
    try {
      const signedPsbt = signedDatas[0]?.psbtHex
      if (!signedPsbt) {
        throw new Error(t('rgb_psbt_signing_missing_result'))
      }

      await wallet.createRgbUtxosEnd({ signedPsbt })
      setStep('create_invoice')
      setUtxoToSignData(undefined)
      setUtxoPendingVanillaTxid('')

      if (resumeCreateInvoiceAfterSign) {
        await finishCreateInvoice()
      }
    } catch (e: unknown) {
      await abortRgbVanillaTx(utxoPendingVanillaTxid)
      if (isInsufficientBtcError(e)) {
        setInsufficientBtcForInvoice(true)
        setError('')
      } else {
        setError(getInvoiceCreationErrorMessage(e, t))
      }
      setStep('create_invoice')
      setUtxoToSignData(undefined)
      setUtxoPendingVanillaTxid('')
    } finally {
      setResumeCreateInvoiceAfterSign(false)
      setLoading(false)
      setLoadingText('')
      tools.showLoading(false)
    }
  }

  const signRgbUtxoParams: SignPsbtParams = {
    data: {
      toSignDatas: utxoToSignData ? [utxoToSignData] : [],
    },
  }

  const onSelectPendingInvoice = (item: RgbPendingReceiveInvoice) => {
    const awaitingAcceptance = isRgbPendingInvoiceAwaitingAcceptance(item)
    const awaitingSenderBroadcast = isRgbPendingInvoiceAwaitingSenderBroadcast(item)
    const awaitingSenderConfirmation = isRgbPendingInvoiceAwaitingSenderConfirmation(item)
    if (
      (awaitingAcceptance || awaitingSenderBroadcast || awaitingSenderConfirmation) &&
      item.recipientId
    ) {
      nav.navigate('RGBTransferDetailScreen', {
        transferId: item.recipientId,
        initialTransfer: {
          id: `local-receive:${item.recipientId}`,
          transferId: item.recipientId,
          ...(item.assetId ? { assetId: item.assetId } : {}),
          type: 'receive',
          ...(item.amount === undefined ? {} : { amount: String(item.amount) }),
          timestamp: item.createdAt || Date.now(),
          status: awaitingAcceptance
            ? 'pending_accept'
            : awaitingSenderConfirmation
              ? 'confirming'
              : 'waiting_receive',
          local: true,
        },
      })
      return
    }
    if (item.invoice) {
      nav.navigate('RGBInvoiceDetailScreen', {
        recipientId: item.recipientId,
        invoice: item.invoice,
        initialInvoice: item,
      })
      return
    }
    setError('')
    setInvoiceLabel(
      formatRgbPendingAmount(item.amount, assetTicker, t('any_amount'), assetPrecision)
    )
    setSelectedPendingInvoice(item)
    setInvoice(item.invoice)
  }

  const onOpenPendingInvoices = () => {
    nav.navigate('RGBInvoiceListScreen', {
      ...(assetId ? { assetId } : {}),
      ...(selectedTokenBalance ? { tokenBalance: selectedTokenBalance } : {}),
    })
  }

  const onClosePendingInvoices = () => {
    setError('')
    if (enteredViaPendingInvoices) {
      nav.goBack()
      return
    }
    setStep('create_invoice')
  }

  const onCopyPendingInvoice = (item: RgbPendingReceiveInvoice) => {
    if (!item.invoice) return
    tools.copyToClipboard(item.invoice)
  }

  const onCancelPendingInvoice = async () => {
    const batchTransferIdx = getRgbBatchTransferIdx(selectedPendingInvoice)
    if (batchTransferIdx === undefined || cancelLoading) return false

    setCancelLoading(true)
    setError('')
    try {
      const result = await rgbWallet.cancelRgbReceiveInvoice({
        batchTransferIdx,
        skipSync: false,
      })
      await loadPendingInvoices()
      await rgbWallet.getRgbAllocationSummary({ skipSync: false })
      // The service can refuse a stale release request after a consignment is
      // accepted. Keep the refreshed selection visible instead of presenting
      // that as a successful invoice removal.
      if (!result.changed) return false
      setInvoice('')
      setSelectedPendingInvoice(undefined)
      setStep('pending_invoices')
      return true
    } catch (e: unknown) {
      setError(getErrorMessage(e))
      return false
    } finally {
      setCancelLoading(false)
    }
  }

  const onSelectAsset = (item: unknown) => {
    if (isAssetLocked) return

    const itemAssetId = getRgbAssetId(item)
    const itemPrecision = getRgbTokenPrecision(item)
    const isAnyAsset = !itemAssetId || itemAssetId === ANY_RGB_ASSET_ID
    const itemRecord = item && typeof item === 'object' ? item as RgbAssetItem : undefined
    const itemCanSetFixedAmount = !isAnyAsset &&
      !itemRecord?.['configuredPlaceholder'] && !isBfaRgbAsset(item)
    setSelectedAssetId(isAnyAsset ? ANY_RGB_ASSET_ID : itemAssetId)
    setSelectedTokenBalance(isAnyAsset ? undefined : (item as RgbAssetItem))
    if (!itemCanSetFixedAmount) {
      setModeState('any')
      setAmount('')
    } else {
      setAmount(currentAmount => normalizeRgbAmountInput(currentAmount, itemPrecision))
    }
    setInvoice('')
    setSelectedPendingInvoice(undefined)
    setPendingInvoices([])
    setStep('create_invoice')
    setError('')
  }

  const onCloseInvoice = () => {
    nav.navigate('AssetsTabScreen')
  }

  const onClickBack = () => {
    nav.goBack()
  }

  return {
    step,
    rgbItems,
    rgbLoading,
    isAssetLocked,
    selectedRgbItem,
    selectedAssetId,
    assetId,
    assetTicker,
    assetPrecision,
    canSetFixedAmount,
    mode,
    setMode,
    recipientType,
    setRecipientType,
    invoiceExpirySeconds,
    setInvoiceExpirySeconds,
    amount,
    onAmountChange,
    normalizedAmount,
    isFixedMode,
    isAmountValid,
    amountInvalidVisible,
    amountExceedsMaximum,
    maximumDisplayAmount: formatMaxRgbDisplayAmount(assetPrecision),
    loading,
    loadingText,
    invoice,
    invoiceLabel,
    selectedPendingInvoice,
    error,
    setError,
    cancelLoading,
    pendingLoading,
    pendingInvoices,
    insufficientBtcForInvoice,
    loadPendingInvoices,
    onOpenPendingInvoices,
    onClosePendingInvoices,
    onCopyPendingInvoice,
    onCreateInvoice,
    resetRgbUtxoSignStep,
    signRgbUtxoParams,
    onSignRgbUtxoHandleConfirm,
    onSelectPendingInvoice,
    onCancelPendingInvoice,
    onSelectAsset,
    onCloseInvoice,
    onClickBack,
  }
}
