import { SignPsbtParams, SignedData } from '@unisat/wallet-shared'
import { useMemo, useRef, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import { useFeeRateBar } from 'src/hooks'
import type { RgbBalance } from 'src/types'
import { decodeRgbInvoice } from 'src/utils/rgb-invoice-utils'

export enum SendRGBScreenStep {
  CREATE_TX,
  SIGN_TX,
}

function isSameRgbAssetId(a?: string, b?: string) {
  const normalize = (value?: string) => value?.replace(/^rgb:/, '')
  return !!a && !!b && normalize(a) === normalize(b)
}

function getTokenIconInfo(tokenBalance: unknown, ticker: string) {
  const record =
    tokenBalance && typeof tokenBalance === 'object' ? (tokenBalance as Record<string, any>) : {}
  const iconInfo =
    record['iconInfo'] && typeof record['iconInfo'] === 'object'
      ? (record['iconInfo'] as Record<string, any>)
      : {}
  const iconUrl = typeof iconInfo['iconUrl'] === 'string' ? iconInfo['iconUrl'] : ''
  const iconShortName =
    typeof iconInfo['iconShortName'] === 'string' && iconInfo['iconShortName']
      ? iconInfo['iconShortName']
      : ticker.slice(0, 2).toUpperCase()
  return { iconUrl, iconShortName }
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
  const transferData = useRef<{ toSignData?: any; beginResult?: any; pendingVanillaTxid?: string }>(
    {}
  )

  const ticker = tokenBalance?.ticker || 'RGB'
  const name = tokenBalance?.name || ticker
  const spendable = tokenBalance?.spendable?.toString() || '0'
  const decodedInvoice = useMemo(() => decodeRgbInvoice(invoice), [invoice])
  const invoiceAmount = decodedInvoice.amount
  const invoiceAssetId = decodedInvoice.assetId
  const invoiceAssetMismatch = !!invoiceAssetId && !isSameRgbAssetId(invoiceAssetId, assetId)
  const invoiceInvalid = invoice.trim().length > 0 && !decodedInvoice.valid
  const invoiceReadyForAmount =
    invoice.trim().length > 0 && decodedInvoice.valid && !invoiceAssetMismatch
  const invoiceValidationMessage = invoiceInvalid
    ? t('invalid_rgb_invoice')
    : invoiceAssetMismatch
      ? t('invoice_asset_mismatch')
      : ''
  const requiresAmount = invoice.trim().length > 0 && decodedInvoice.needsAmount
  const normalizedAmount = amount.trim()
  const isAmountValid =
    !requiresAmount || (Number(normalizedAmount) > 0 && Number.isFinite(Number(normalizedAmount)))
  const iconInfo = getTokenIconInfo(tokenBalance, ticker)
  const displayAmount = requiresAmount ? amount : invoiceAmount || ''
  const amountPlaceholder = requiresAmount ? '0' : invoice.trim() ? t('any_amount') : '0'
  const amountMuted = !displayAmount
  const amountInvalidVisible = requiresAmount && amount.trim().length > 0 && !isAmountValid

  const disabled = useMemo(() => {
    return !invoiceReadyForAmount || feeRate <= 0 || !isAmountValid
  }, [invoiceReadyForAmount, feeRate, isAmountValid])

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
      const beginResult = await wallet.createRgbSendBegin({
        invoice: invoice.trim(),
        assetId: invoiceAssetId || assetId,
        amount: requiresAmount ? normalizedAmount : undefined,
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
      const endResult = await wallet.createRgbSendEnd({ signedPsbt })
      const txid =
        endResult?.txid || endResult?.bitcoinTxid || endResult?.txId || endResult?.id || ''
      nav.navigate('RGBSendCompleteScreen', {
        assetId,
        tokenBalance: tokenBalance as RgbBalance | undefined,
        txid,
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
    decodedInvoice,
    invoiceAmount,
    invoiceAssetId,
    invoiceAssetMismatch,
    invoiceInvalid,
    invoiceReadyForAmount,
    invoiceValidationMessage,
    displayAmount,
    amountPlaceholder,
    amountMuted,
    amountInvalidVisible,
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
