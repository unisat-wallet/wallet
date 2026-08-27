import { SignPsbtParams, SignedData } from '@unisat/wallet-shared'
import { useEffect, useMemo, useRef, useState } from 'react'
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
}

const BLOCKING_RGB_SEND_STATUSES = new Set([
  'signed',
  'waiting_ack',
  'broadcasting',
  'broadcast_failed',
])

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
  const [step, setStep] = useState(SendRGBScreenStep.CREATE_TX)
  const [blockingSendStatus, setBlockingSendStatus] = useState<string>()
  const transferData = useRef<{ toSignData?: any; beginResult?: any; pendingVanillaTxid?: string }>(
    {}
  )

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
      : ''
  const requiresAmount = invoice.trim().length > 0 && decodedInvoice.needsAmount
  const amountInput = amount.trim()
  const assetPrecision = getRgbTokenPrecision(tokenBalance)
  const spendable = blockingSendStatus ? '0' : toRgbDisplayAmount(rawSpendable, assetPrecision)
  const normalizedAmount = toRgbAtomicAmount(amountInput, assetPrecision)
  const isAmountValid =
    !requiresAmount ||
    (isValidRgbDecimalAmount(amountInput, assetPrecision) && /[1-9]/.test(normalizedAmount))
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

  const disabled = useMemo(() => {
    return (
      !invoiceReadyForAmount ||
      feeRate <= 0 ||
      !isAmountValid ||
      insufficientBalance ||
      !!blockingSendStatus
    )
  }, [invoiceReadyForAmount, feeRate, isAmountValid, insufficientBalance, blockingSendStatus])

  const onClickBack = () => {
    nav.goBack()
  }

  const onInvoiceChange = (value: string) => {
    setInvoice(value)
    setAmount('')
  }

  const onAmountChange = (value: string) => {
    setAmount(value)
  }

  const onClickMaxAmount = () => {
    setAmount(spendable)
  }

  const onClickNext = async () => {
    setError('')
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
      setStep(SendRGBScreenStep.SIGN_TX)
    } catch (e) {
      setError((e as any).message)
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
                  : 'broadcasted',
          local: true,
          to: decodedInvoice.beneficiaryAddress,
        },
      })
      transferData.current = {}
    } catch (e) {
      nav.navigate('TxFailScreen', { error: (e as any).message })
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
    displayAmount,
    amountPlaceholder,
    amountMuted,
    amountInvalidVisible,
    blockingSendMessage,
    feeRate,
    error,
    disabled,
    onClickBack,
    onClickNext,
    signPsbtParams,
    onSignPsbtHandleConfirm,
    onSignPsbtHandleCancel,
    onSignPsbtHandleBack,
  }
}
