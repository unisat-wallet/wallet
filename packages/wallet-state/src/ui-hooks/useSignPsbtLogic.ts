import { numUtils } from '@unisat/base-utils'
import { ToSignInput } from '@unisat/keyring-service/types'
import {
  AccountSignMethod,
  ApprovalSession,
  ContractResult,
  DecodedPsbt,
  LocalPsbtSummary,
  SignedData,
  SignState,
  TickPriceItem,
  ToSignData,
  WebsiteResult,
} from '@unisat/wallet-shared'
import logger from 'loglevel'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApproval, useI18n, useTools, useWallet } from 'src/context'
import { useCurrentAccountCapabilities } from 'src/hooks'
import { useAsyncEffect } from 'src/utils/ui-utils'

interface InscriptionInfo {
  id: string
  isSent: boolean
}

export interface TxInfo {
  changedBalance: number
  changedInscriptions: InscriptionInfo[]
  rawtx: string
  psbtHex: string
  toSignInputs: ToSignInput[]
  txError: string
  decodedPsbt: DecodedPsbt
  contractResults: ContractResult[]
}

export const initTxInfo: TxInfo = {
  changedBalance: 0,
  changedInscriptions: [],
  rawtx: '',
  psbtHex: '',
  toSignInputs: [],
  txError: '',
  decodedPsbt: {
    inputInfos: [],
    outputInfos: [],
    fee: 0,
    feeRate: 0,
    risks: [],
    features: {
      rbf: false,
    },
    inscriptions: {},
    isScammer: false,
    shouldWarnFeeRate: false,
    recommendedFeeRate: 1,
    isCompleted: false,
  },
  contractResults: [],
}

export interface SignPsbtProps {
  header?: React.ReactNode
  params: {
    data: {
      toSignDatas: ToSignData[]
    }
    session?: ApprovalSession
  }
  handleCancel?: () => void
  handleConfirm?: (signedDatas: SignedData[]) => void
  fromApproval?: boolean
}

export function useSignPsbtLogic(props: SignPsbtProps) {
  const {
    params: {
      data: { toSignDatas },
      session,
    },
    handleCancel,
    handleConfirm,
  } = props
  const { resolveApproval, rejectApproval } = useApproval()

  const [loading, setLoading] = useState(false)
  const [websiteCheckStatus, setWebsiteCheckStatus] = useState<'checking' | 'complete' | 'failed'>(
    session?.origin ? 'checking' : 'complete'
  )
  const [checkedWebsite, setCheckedWebsite] = useState<string | undefined>(undefined)
  const [isPsbtSigning, setIsPsbtSigning] = useState(false)
  const [isPsbtRiskPopoverVisible, setIsPsbtRiskPopoverVisible] = useState(false)
  const [isKeystoneSigning, setIsKeystoneSigning] = useState(false)
  const [isColdWalletSigning, setIsColdWalletSigning] = useState(false)
  const [readonlySignedPsbtHex, setReadonlySignedPsbtHex] = useState('')

  const [contractPopoverData, setContractPopoverData] = useState(undefined)

  const wallet = useWallet()
  const tools = useTools()
  const accountCapabilities = useCurrentAccountCapabilities()

  const { t } = useI18n()

  const [disclaimerVisible, setDisclaimerVisible] = useState(false)
  const [localPsbtSummary, setLocalPsbtSummary] = useState<LocalPsbtSummary | null>(null)

  const [signingTxIndex, setSigningTxIndex] = useState(toSignDatas.length > 1 ? -1 : 0)
  const [signedStates, setSignedStates] = useState<SignState[]>(
    toSignDatas.map(() => SignState.PENDING)
  )

  const [websiteResult, setWebsiteResult] = useState<WebsiteResult>({
    isScammer: false,
    warning: '',
    allowQuickMultiSign: false,
  })

  const isMultipleViewMode = toSignDatas.length > 1

  const [allowQuickMultiSign, setAllowQuickMultiSign] = useState(false)

  //

  useEffect(() => {
    if (toSignDatas.length <= 1) {
      return
    }

    if (accountCapabilities.signMethod !== AccountSignMethod.Local) {
      return
    }

    setAllowQuickMultiSign(websiteResult.allowQuickMultiSign && toSignDatas.length > 1)
  }, [websiteResult, accountCapabilities])

  useEffect(() => {
    let active = true
    const website = session?.origin
    if (!website) {
      setCheckedWebsite(undefined)
      setWebsiteResult({ isScammer: false, warning: '', allowQuickMultiSign: false })
      setWebsiteCheckStatus('complete')
      return undefined
    }

    setCheckedWebsite(undefined)
    setWebsiteResult({ isScammer: false, warning: '', allowQuickMultiSign: false })
    setWebsiteCheckStatus('checking')
    setAllowQuickMultiSign(false)

    void (async () => {
      try {
        const result = await wallet.checkWebsite(website)
        if (!active) return
        setWebsiteResult(result)

        // Also check local user-granted trust
        if (!result.allowQuickMultiSign && toSignDatas.length > 1) {
          const sites = await wallet.getConnectedSites()
          if (!active) return
          const site = sites.find(s => s.origin === website)
          if (site?.allowQuickMultiSign) {
            setAllowQuickMultiSign(true)
          }
        }

        setCheckedWebsite(website)
        setWebsiteCheckStatus('complete')
      } catch (error) {
        if (!active) return
        logger.error('Failed to check signing request origin:', error)
        setWebsiteCheckStatus('failed')
      }
    })()

    return () => {
      active = false
    }
  }, [session?.origin, toSignDatas.length, wallet])

  const currentToSignData = toSignDatas[signingTxIndex]

  const signedDatas = useRef<SignedData[]>([])

  const decodedPsbtDatas = useRef<DecodedPsbt[]>([])
  useAsyncEffect(async () => {
    if (decodedPsbtDatas.current[signingTxIndex]) {
      return
    }
    if (!currentToSignData) {
      return
    }
    try {
      setLoading(true)

      const decodedPsbt = await wallet.decodePsbt(currentToSignData.psbtHex, session?.origin || '')
      decodedPsbtDatas.current[signingTxIndex] = decodedPsbt
    } catch (e) {
      logger.error('Failed to decode PSBT data:', e)
    } finally {
      setLoading(false)
    }
  }, [signingTxIndex, currentToSignData])

  const currentDecodedPsbt = decodedPsbtDatas.current[signingTxIndex]

  const [brc20PriceMap, setBrc20PriceMap] = useState<Record<string, TickPriceItem>>()
  const [runesPriceMap, setRunesPriceMap] = useState<Record<string, TickPriceItem>>()

  useEffect(() => {
    if (!currentDecodedPsbt?.inputInfos) return

    const runesMap = {}
    const brc20Map = {}

    // collect asset information
    currentDecodedPsbt.inputInfos.forEach(v => {
      if (v.runes) {
        v.runes.forEach(w => {
          runesMap[w.spacedRune] = true
        })
      }

      if (v.inscriptions) {
        v.inscriptions.forEach(w => {
          const inscription = currentDecodedPsbt.inscriptions[w.inscriptionId]
          if (inscription && inscription.brc20) {
            brc20Map[inscription.brc20.tick] = true
          }
        })
      }
    })

    // get asset price
    if (Object.keys(runesMap).length > 0) {
      wallet
        .getRunesPrice(Object.keys(runesMap))
        .then(setRunesPriceMap)
        .catch(e => tools.toastError(e.message))
    }

    if (Object.keys(brc20Map).length > 0) {
      wallet
        .getBrc20sPrice(Object.keys(brc20Map))
        .then(setBrc20PriceMap)
        .catch(e => tools.toastError(e.message))
    }
  }, [currentDecodedPsbt])

  const networkFee = currentDecodedPsbt ? numUtils.satoshisToAmount(currentDecodedPsbt.fee) : '0'
  const isValid = currentDecodedPsbt ? currentDecodedPsbt.inputInfos.length > 0 : false
  const hasRisk = currentDecodedPsbt ? currentDecodedPsbt.risks.length > 0 : false

  let showFeeSection = false
  if (currentDecodedPsbt && currentDecodedPsbt.isCompleted) {
    showFeeSection = true
  }

  let isScammer = false
  if (currentDecodedPsbt && currentDecodedPsbt.isScammer == true) {
    isScammer = true
  }
  if (websiteResult && websiteResult.isScammer == true) {
    isScammer = true
  }
  const canSign =
    websiteCheckStatus === 'complete' && checkedWebsite === session?.origin && !isScammer

  const isAllSigned = signedStates.every(state => state === SignState.SUCCESS)
  const signedCount = signedStates.filter(state => state === SignState.SUCCESS).length

  const defaultHandleCancel = () => rejectApproval()
  const actualHandleCancel = handleCancel || defaultHandleCancel

  const multiSignList = useMemo(() => {
    return toSignDatas.map((data, index) => {
      const signState = signedStates[index]
      let buttonText = 'View'
      if (signState == SignState.PENDING) {
        buttonText = t('view')
      } else if (signState == SignState.SUCCESS) {
        buttonText = t('signed')
      } else if (signState == SignState.FAILED) {
        buttonText = t('reject')
      }

      let buttonPreset = 'primary'
      if (signState === SignState.SUCCESS) {
        buttonPreset = 'approval'
      } else if (signState === SignState.FAILED) {
        buttonPreset = 'danger'
      }

      const psbtInfo = localPsbtSummary?.items?.[index]

      const onClick = () => {
        setSigningTxIndex(index)
      }
      return {
        index,
        buttonText,
        buttonPreset,
        psbtInfo,
        onClick,
      }
    })
  }, [toSignDatas, signedStates, localPsbtSummary, t])

  // action
  const onClickBack = () => {
    if (isMultipleViewMode && signingTxIndex != -1) {
      // back to multi sign view
      setSigningTxIndex(-1)
      setIsPsbtRiskPopoverVisible(false)
      return
    }
    actualHandleCancel()
  }

  const onClickSign = () => {
    if (!canSign) return
    if (currentDecodedPsbt?.risks?.length > 0) {
      setIsPsbtRiskPopoverVisible(true)
      return
    }
    onNextStep()
  }

  useAsyncEffect(async () => {
    if (toSignDatas.length <= 1) return
    try {
      const summary = await wallet.analyzeLocalPsbts(toSignDatas)
      setLocalPsbtSummary(summary)
    } catch (e) {
      logger.error('analyzeLocalPsbts failed:', e)
    }
  }, [])

  const onTryMultiSign = async () => {
    if (!canSign) return
    setDisclaimerVisible(true)
  }

  const onTrustSite = async () => {
    const origin = session?.origin
    if (!origin) return
    await wallet.updateConnectSite(origin, { allowQuickMultiSign: true })
    setAllowQuickMultiSign(true)
  }

  const onQuickMultiSign = async () => {
    if (!canSign) return
    // Run analysis if not yet done (user clicked before async summary completed)

    try {
      setIsPsbtSigning(true)
      // Yield to the JS event loop so the loading UI can render before heavy signing work begins
      await new Promise<void>(resolve => setTimeout(resolve, 50))
      const summary = localPsbtSummary ?? (await wallet.analyzeLocalPsbts(toSignDatas))
      if (!localPsbtSummary) setLocalPsbtSummary(summary)

      if (summary.parseErrorCount > 0) {
        tools.toastError(t('failed_to_parse_psbt'))
        return
      }
      if (summary.hasSighashNone) {
        tools.toastError(t('sighash_none_detected'))
        return
      }
      if (summary.hasAssets) {
        tools.toastError(t('quick_sign_assets_detected'))
        return
      }

      for (let i = 0; i < toSignDatas.length; i++) {
        try {
          const toSignData = toSignDatas[i]
          const signedData = await wallet.signPsbtV2(toSignData)
          onSignedData(signedData, i)
        } catch (e) {
          signedStates[i] = SignState.FAILED
          setSignedStates([...signedStates])
          tools.toastError(`Signing failed for PSBT ${i}: ${e.message}`)
        }
      }
    } catch {
      // Individual signing failures have already been surfaced to the user.
    } finally {
      setIsPsbtSigning(false)
      setDisclaimerVisible(false)
    }
  }

  const localSign = async () => {
    try {
      setIsPsbtSigning(true)
      // Let React paint the loading page before wallet signing starts.
      await new Promise<void>(resolve => setTimeout(resolve, 50))
      const toSignData = toSignDatas[signingTxIndex]
      const signedData = await wallet.signPsbtV2(toSignData)
      onSignedData(signedData, signingTxIndex)
    } catch (e) {
      logger.error('Local signing failed:', e)
      if (e.message.includes('Can not sign for input')) {
        tools.toastError(t('sign_psbt_input_error'))
      } else {
        tools.toastError(e.message)
      }
      signedStates[signingTxIndex] = SignState.FAILED
      setSignedStates([...signedStates])
    } finally {
      setIsPsbtSigning(false)
    }
  }

  const onNextStep = () => {
    if (!canSign) return
    switch (accountCapabilities.signMethod) {
      case AccountSignMethod.Keystone:
        setIsKeystoneSigning(true)
        return
      case AccountSignMethod.ColdWallet:
        setIsColdWalletSigning(true)
        return
      case AccountSignMethod.External:
        if (!readonlySignedPsbtHex) {
          tools.toastError(t('invalid_psbt'))
          return
        }

        onSignedData({ psbtHex: readonlySignedPsbtHex }, signingTxIndex)
        setReadonlySignedPsbtHex('')
        return
      case AccountSignMethod.Local:
        localSign()
        return
      case AccountSignMethod.None:
      default:
        tools.toastError(t('not_supported'))
    }
  }

  const onSignedData = (data: SignedData, signingTxIndex: number) => {
    signedStates[signingTxIndex] = SignState.SUCCESS
    setSignedStates([...signedStates])

    signedDatas.current[signingTxIndex] = data

    // single mode
    if (!isMultipleViewMode) {
      if (handleConfirm) {
        handleConfirm(signedDatas.current)
      } else {
        resolveApproval(signedDatas.current)
      }
      return
    }

    // multiple mode
    const isAllSigned = signedStates.every(state => state === SignState.SUCCESS)
    if (isAllSigned) {
      if (handleConfirm) {
        handleConfirm(signedDatas.current)
      } else {
        resolveApproval(signedDatas.current)
      }
      return
    } else {
      setSigningTxIndex(-1)
      setIsPsbtRiskPopoverVisible(false)
      return
    }
  }

  // keystone
  const onKeystoneSigningSuccess = (data: SignedData) => {
    setIsKeystoneSigning(false)
    onSignedData(data, signingTxIndex)
  }

  const onKeystoneSigningBack = () => {
    setIsKeystoneSigning(false)
  }

  // coldwallet
  const onColdWalletSigningSuccess = (data: { psbtHex: string; rawtx: string }) => {
    setIsColdWalletSigning(false)
    onSignedData(data, signingTxIndex)
  }

  const onColdWalletSigningBack = () => {
    setIsColdWalletSigning(false)
  }

  // risk popover
  const onRiskPopoverConfirm = () => {
    setIsPsbtRiskPopoverVisible(false)
    onNextStep()
  }

  const onRiskPopoverClose = () => {
    setIsPsbtRiskPopoverVisible(false)
  }

  // disclaimer modal
  const onDisclaimerModalClose = () => {
    setDisclaimerVisible(false)
  }

  const showMultiSignView = isMultipleViewMode && signingTxIndex == -1

  const isWaitingData = showMultiSignView == false && (!currentDecodedPsbt || !currentToSignData)

  const showLoading = isWaitingData || loading || isPsbtSigning || websiteCheckStatus === 'checking'

  const backButtonText = isMultipleViewMode ? t('back') : t('reject')

  return {
    isPsbtRiskPopoverVisible,
    contractPopoverData,
    setContractPopoverData,
    t,
    brc20PriceMap,
    runesPriceMap,
    session,
    isPsbtSigning,

    // page state
    isKeystoneSigning,
    isColdWalletSigning,
    showMultiSignView,
    showLoading,

    disclaimerVisible,
    localPsbtSummary,

    // data
    toSignDatas,
    currentToSignData,
    currentDecodedPsbt,
    readonlySignedPsbtHex,
    setReadonlySignedPsbtHex,

    // state
    networkFee,
    isValid,
    hasRisk,
    showFeeSection,
    isScammer,
    canSign,
    allowQuickMultiSign,

    // multiple sign state
    isAllSigned,
    signedCount,
    multiSignList,

    // actions
    backButtonText,
    onClickBack,
    onClickSign,
    onQuickMultiSign,
    onTryMultiSign,
    onTrustSite,

    onKeystoneSigningSuccess,
    onKeystoneSigningBack,

    onColdWalletSigningSuccess,
    onColdWalletSigningBack,

    onRiskPopoverConfirm,
    onRiskPopoverClose,

    onDisclaimerModalClose,
  }
}
