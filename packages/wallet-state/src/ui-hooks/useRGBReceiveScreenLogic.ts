import type { SignPsbtParams, SignedData, ToSignData } from '@unisat/wallet-shared'
import { useEffect, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import { useFeeRateBar } from 'src/hooks'
import { useRGBListLogic } from './useRGBListLogic'

export type RGBReceiveMode = 'any' | 'fixed'
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

type RgbAllocationWallet = {
  getRgbAllocationSummary(params?: { skipSync?: boolean }): Promise<RgbAllocationSummary>
}

type RgbReceiveWallet = {
  createRgbBlindReceive(params: {
    assetId?: string
    amount?: number | string
    minConfirmations?: number
    durationSeconds?: number
  }): Promise<unknown>
  getRgbPendingReceiveInvoices(): Promise<RgbPendingReceiveInvoicesResult>
  cancelRgbReceiveInvoice(params: {
    batchTransferIdx: number
    skipSync?: boolean
  }): Promise<unknown>
}

type RGBReceiveRouteState = {
  assetId?: string
  tokenBalance?: unknown
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
  if (error.message) return error.message
  return 'An unknown error occurred'
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

const hasAvailableRgbAllocation = (summary: unknown) => {
  const value = getRecordPayload(summary)
  if (!value) return false

  if (typeof value['available'] === 'boolean') return value['available']

  const availableAllocationCount = Number(
    value['availableAllocationCount'] ?? value['freeAllocationCount'] ?? 0
  )
  return Number.isFinite(availableAllocationCount) && availableAllocationCount > 0
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

const getRgbTokenPrecision = (value: unknown) => {
  const tokenInfo = getTokenInfo(value)
  const record =
    tokenInfo && typeof tokenInfo === 'object' ? (tokenInfo as Record<string, unknown>) : {}
  const precision = Number(record['precision'])
  return Number.isInteger(precision) && precision > 0 ? precision : 0
}

const isValidRgbDecimalAmount = (value: string, precision: number) => {
  if (!value) return false
  const decimalPattern = precision > 0 ? `(?:\\.\\d{0,${precision}})?` : ''
  return new RegExp(`^(?:0|[1-9]\\d*)${decimalPattern}$`).test(value)
}

const normalizeRgbAmountInput = (value: string, precision: number) => {
  let nextValue = value.trim().replace(/,/g, '')
  if (!nextValue) return ''

  nextValue = nextValue.replace(/[^\d.]/g, '')
  const [integerPart = '', ...decimalParts] = nextValue.split('.')
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '') || '0'

  if (precision === 0) {
    return normalizedInteger
  }

  if (decimalParts.length === 0) {
    return normalizedInteger
  }

  return `${normalizedInteger}.${decimalParts.join('').slice(0, precision)}`
}

const toRgbAtomicAmount = (value: string, precision: number) => {
  const [integerPart = '0', decimalPart = ''] = value.split('.')
  if (precision === 0) return integerPart

  const paddedDecimal = decimalPart.padEnd(precision, '0').slice(0, precision)
  const atomicAmount = `${integerPart}${paddedDecimal}`.replace(/^0+(?=\d)/, '')
  return atomicAmount || '0'
}

export const getRgbTokenIconInfo = (value: unknown, ticker: string) => {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  const iconInfo =
    record?.['iconInfo'] && typeof record['iconInfo'] === 'object'
      ? (record['iconInfo'] as Record<string, unknown>)
      : {}
  const iconUrl = readStringPath(iconInfo, ['iconUrl']) || readStringPath(record, ['iconUrl']) || ''
  const iconShortName =
    readStringPath(iconInfo, ['iconShortName']) || ticker.slice(0, 2).toUpperCase()
  return { iconUrl, iconShortName }
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

const isInvoiceForAsset = (item: RgbPendingReceiveInvoice, assetId?: string) => {
  if (!assetId) return true
  return !item.assetId || item.assetId === assetId
}

export const formatRgbPendingAmount = (
  amount: RgbPendingReceiveInvoice['amount'],
  ticker: string,
  emptyAmountText = ''
) => {
  if (amount === undefined || amount === null || amount === '' || String(amount) === '0') {
    return emptyAmountText
  }
  return `${amount} ${ticker}`
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
    status === 'waitingcounterparty' &&
    getRgbBatchTransferIdx(item) !== undefined
  )
}

export function useRGBReceiveScreenLogic() {
  const nav = useNavigation()
  const wallet = useWallet()
  const tools = useTools()
  const { t } = useI18n()
  const { feeRate } = useFeeRateBar()
  const { items: rgbItems = [], loading: rgbLoading } = useRGBListLogic()
  const rgbWallet = wallet as typeof wallet & RgbAllocationWallet & RgbReceiveWallet
  const routeState = nav.getRouteState<'RGBReceiveScreen'>() as RGBReceiveRouteState
  const routeAssetId = routeState?.assetId || ''
  const isAssetLocked = !!routeAssetId

  const [selectedAssetId, setSelectedAssetId] = useState(routeAssetId)
  const [selectedTokenBalance, setSelectedTokenBalance] = useState<RgbAssetItem | undefined>(
    routeState?.tokenBalance as RgbAssetItem | undefined
  )
  const [assetSelectorOpen, setAssetSelectorOpen] = useState(false)
  const [mode, setMode] = useState<RGBReceiveMode>('any')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('')
  const [invoice, setInvoice] = useState('')
  const [invoiceLabel, setInvoiceLabel] = useState(t('any_amount'))
  const [selectedPendingInvoice, setSelectedPendingInvoice] = useState<RgbPendingReceiveInvoice>()
  const [error, setError] = useState('')
  const [cancelLoading, setCancelLoading] = useState(false)
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingInvoices, setPendingInvoices] = useState<RgbPendingReceiveInvoice[]>([])
  const [step, setStep] = useState<RGBReceiveScreenStep>('create_invoice')
  const [utxoToSignData, setUtxoToSignData] = useState<ToSignData>()
  const [utxoPendingVanillaTxid, setUtxoPendingVanillaTxid] = useState('')
  const [resumeCreateInvoiceAfterSign, setResumeCreateInvoiceAfterSign] = useState(false)

  const selectedRgbItem =
    selectedAssetId === ANY_RGB_ASSET_ID
      ? ANY_RGB_ASSET
      : rgbItems.find(item => getRgbAssetId(item) === selectedAssetId) ||
        selectedTokenBalance ||
        ANY_RGB_ASSET
  const selectedSpecificAssetId =
    selectedAssetId === ANY_RGB_ASSET_ID ? '' : selectedAssetId || getRgbAssetId(selectedRgbItem)
  const assetId = selectedSpecificAssetId === ANY_RGB_ASSET_ID ? '' : selectedSpecificAssetId
  const assetTicker = getRgbTokenTicker(selectedRgbItem)
  const assetPrecision = getRgbTokenPrecision(selectedRgbItem)
  const displayAmount = amount.trim()
  const isFixedMode = mode === 'fixed'
  const normalizedAmount = isFixedMode ? toRgbAtomicAmount(displayAmount, assetPrecision) : ''
  const isAmountValid =
    !isFixedMode ||
    (isValidRgbDecimalAmount(displayAmount, assetPrecision) && /[1-9]/.test(normalizedAmount))

  const onAmountChange = (value: string) => {
    setAmount(normalizeRgbAmountInput(value, assetPrecision))
  }

  const createReceiveInvoice = () => {
    const params: {
      assetId?: string
      amount?: string
    } = {}

    if (assetId) {
      params.assetId = assetId
    }

    if (isFixedMode) {
      params.amount = normalizedAmount
    }

    return rgbWallet.createRgbBlindReceive(params)
  }

  const loadPendingInvoices = async () => {
    setPendingLoading(true)
    try {
      const value = await rgbWallet.getRgbPendingReceiveInvoices()
      const list = getPendingInvoiceList(value).filter(
        item => item.invoice && isInvoiceForAsset(item, assetId)
      )
      setPendingInvoices(list)
    } catch (e: unknown) {
      setError(getErrorMessage(e))
    } finally {
      setPendingLoading(false)
    }
  }

  useEffect(() => {
    loadPendingInvoices()
  }, [assetId])

  const finishCreateInvoice = async () => {
    setLoadingText('Creating invoice...')
    const value = await createReceiveInvoice()
    setInvoice(getInvoiceText(value))
    setStep('create_invoice')
    loadPendingInvoices()
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
    } catch (e) {
      console.warn('Failed to abort RGB vanilla tx', e)
    }
  }

  const startCreateRgbUtxoSign = async () => {
    setLoadingText('Preparing RGB UTXO...')
    const beginResult = await wallet.createRgbUtxosBegin({
      upTo: true,
      num: 1,
      feeRate,
    })
    const beginResultRecord =
      beginResult && typeof beginResult === 'object'
        ? (beginResult as { toSignData?: ToSignData })
        : {}
    const toSignData = beginResultRecord.toSignData

    if (!toSignData) {
      throw new Error('RGB UTXO creation did not return signing data')
    }

    setUtxoToSignData(toSignData)
    setUtxoPendingVanillaTxid(getRgbUtxoBeginTxid(beginResult))
    setResumeCreateInvoiceAfterSign(true)
    setStep('sign_rgb_utxo')
  }

  const ensureRgbAllocation = async () => {
    setLoadingText('Checking RGB UTXO...')
    const summary = await rgbWallet.getRgbAllocationSummary({ skipSync: false })
    if (hasAvailableRgbAllocation(summary)) {
      return true
    }

    await startCreateRgbUtxoSign()
    return false
  }

  const onCreateInvoice = async () => {
    if (!isAmountValid) return
    setLoading(true)
    setLoadingText('Checking RGB UTXO...')
    setError('')
    setInvoice('')
    setSelectedPendingInvoice(undefined)
    setInvoiceLabel(isFixedMode ? `${displayAmount} ${assetTicker}` : t('any_amount'))
    try {
      const hadAllocation = await ensureRgbAllocation()
      if (!hadAllocation) {
        return
      }

      try {
        await finishCreateInvoice()
      } catch (invoiceError: unknown) {
        console.log('Invoice creation error:', invoiceError)
        setLoadingText('Checking RGB UTXO...')
        const summary = await rgbWallet.getRgbAllocationSummary({ skipSync: false })
        if (hasAvailableRgbAllocation(summary)) {
          setError(getErrorMessage(invoiceError))
          return
        }

        await startCreateRgbUtxoSign()
      }
    } catch (e: unknown) {
      console.log('Error during invoice creation or RGB UTXO preparation:', e)
      setError(getErrorMessage(e))
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
    setLoadingText('Creating RGB UTXO...')
    setError('')
    try {
      const signedPsbt = signedDatas[0]?.psbtHex
      if (!signedPsbt) {
        throw new Error('RGB UTXO PSBT signing did not return psbtHex')
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
      setError(getErrorMessage(e))
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
    setError('')
    setInvoiceLabel(formatRgbPendingAmount(item.amount, assetTicker, t('any_amount')))
    setSelectedPendingInvoice(item)
    setInvoice(item.invoice)
  }

  const onOpenPendingInvoices = () => {
    setError('')
    setStep('pending_invoices')
  }

  const onClosePendingInvoices = () => {
    setError('')
    setStep('create_invoice')
  }

  const onCopyPendingInvoice = (item: RgbPendingReceiveInvoice) => {
    if (!item.invoice) return
    tools.copyToClipboard(item.invoice)
  }

  const onCancelPendingInvoice = async () => {
    const batchTransferIdx = getRgbBatchTransferIdx(selectedPendingInvoice)
    if (batchTransferIdx === undefined || cancelLoading) return

    setCancelLoading(true)
    setError('')
    try {
      await rgbWallet.cancelRgbReceiveInvoice({
        batchTransferIdx,
        skipSync: false,
      })
      await loadPendingInvoices()
      await rgbWallet.getRgbAllocationSummary({ skipSync: false })
      setInvoice('')
      setSelectedPendingInvoice(undefined)
      setStep('pending_invoices')
    } catch (e: unknown) {
      setError(getErrorMessage(e))
    } finally {
      setCancelLoading(false)
    }
  }

  const onSelectAsset = (item: unknown) => {
    if (isAssetLocked) return

    const itemAssetId = getRgbAssetId(item)
    const itemPrecision = getRgbTokenPrecision(item)
    setSelectedAssetId(itemAssetId || ANY_RGB_ASSET_ID)
    setSelectedTokenBalance(itemAssetId ? (item as RgbAssetItem) : undefined)
    setAmount(currentAmount => normalizeRgbAmountInput(currentAmount, itemPrecision))
    setAssetSelectorOpen(false)
    setInvoice('')
    setSelectedPendingInvoice(undefined)
    setPendingInvoices([])
    setStep('create_invoice')
    setError('')
  }

  const onBackToCreate = () => {
    setInvoice('')
    if (selectedPendingInvoice) {
      setSelectedPendingInvoice(undefined)
      setStep('pending_invoices')
      return
    }

    setSelectedPendingInvoice(undefined)
    setStep('create_invoice')
  }

  const onCloseInvoice = () => {
    nav.navToTab()
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
    assetSelectorOpen,
    setAssetSelectorOpen,
    mode,
    setMode,
    amount,
    onAmountChange,
    normalizedAmount,
    isFixedMode,
    isAmountValid,
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
    onBackToCreate,
    onCloseInvoice,
    onClickBack,
  }
}
