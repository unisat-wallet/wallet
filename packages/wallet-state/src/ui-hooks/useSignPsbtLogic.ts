import { numUtils } from '@unisat/base-utils'
import { KeyringType, ToSignInput } from '@unisat/keyring-service/types'
import {
  ApprovalSession,
  ContractResult,
  DecodedPsbt,
  SignedData,
  SignState,
  TickPriceItem,
  ToSignData,
  WebsiteResult,
} from '@unisat/wallet-shared'
import logger from 'loglevel'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApproval, useI18n, useTools, useWallet } from 'src/context'
import { useCurrentAccount } from 'src/hooks'
import { shortAddress, useAsyncEffect } from 'src/utils/ui-utils'

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

export interface LocalParsedPsbtData {
  txid: string
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
  const [isPsbtRiskPopoverVisible, setIsPsbtRiskPopoverVisible] = useState(false)
  const [isKeystoneSigning, setIsKeystoneSigning] = useState(false)
  const [isColdWalletSigning, setIsColdWalletSigning] = useState(false)

  const [contractPopoverData, setContractPopoverData] = useState(undefined)

  const wallet = useWallet()
  const tools = useTools()
  const currentAccount = useCurrentAccount()
  const keyringType = currentAccount.type

  const { t } = useI18n()

  const [disclaimerVisible, setDisclaimerVisible] = useState(false)

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

    if (
      keyringType === KeyringType.KeystoneKeyring ||
      keyringType === KeyringType.ColdWalletKeyring
    ) {
      return
    }

    setAllowQuickMultiSign(websiteResult.allowQuickMultiSign && toSignDatas.length > 1)
  }, [websiteResult, keyringType])

  useAsyncEffect(async () => {
    const website = session?.origin
    if (website) {
      const result = await wallet.checkWebsite(website)
      setWebsiteResult(result)
    }
  }, [])

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

      let title = shortAddress(data.psbtHex, 10)

      const onClick = () => {
        setSigningTxIndex(index)
      }
      return {
        index,
        title,
        buttonText,
        buttonPreset,
        onClick,
      }
    })
  }, [toSignDatas, signedStates, t])

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
    if (currentDecodedPsbt?.risks?.length > 0) {
      setIsPsbtRiskPopoverVisible(true)
      return
    }
    onNextStep()
  }

  const onTryMultiSign = async () => {
    setDisclaimerVisible(true)
  }

  const onQuickMultiSign = async () => {
    for (let i = 0; i < toSignDatas.length; i++) {
      try {
        const toSignData = toSignDatas[i]
        const signedData = await wallet.signPsbtV2(toSignData)
        onSignedData(signedData, i)
      } catch (e) {
        signedStates[i] = SignState.FAILED
        setSignedStates([...signedStates])
        logger.error(`Signing failed for PSBT ${i}:`, e)
      }
    }
  }

  const localSign = async () => {
    try {
      const toSignData = toSignDatas[signingTxIndex]
      const signedData = await wallet.signPsbtV2(toSignData)
      onSignedData(signedData, signingTxIndex)
    } catch (e) {
      logger.error('Local signing failed:', e)
      signedStates[signingTxIndex] = SignState.FAILED
      setSignedStates([...signedStates])
    }
  }

  const onNextStep = () => {
    if (keyringType === KeyringType.KeystoneKeyring) {
      setIsKeystoneSigning(true)
    } else if (keyringType === KeyringType.ColdWalletKeyring) {
      setIsColdWalletSigning(true)
    } else {
      localSign()
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

  const showLoading = isWaitingData || loading

  const backButtonText = isMultipleViewMode ? t('back') : t('reject')

  return {
    isPsbtRiskPopoverVisible,
    contractPopoverData,
    setContractPopoverData,
    t,
    brc20PriceMap,
    runesPriceMap,
    session,

    // page state
    isKeystoneSigning,
    isColdWalletSigning,
    showMultiSignView,
    showLoading,

    disclaimerVisible,

    // data
    toSignDatas,
    currentToSignData,
    currentDecodedPsbt,

    // state
    networkFee,
    isValid,
    hasRisk,
    showFeeSection,
    isScammer,
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

    onKeystoneSigningSuccess,
    onKeystoneSigningBack,

    onColdWalletSigningSuccess,
    onColdWalletSigningBack,

    onRiskPopoverConfirm,
    onRiskPopoverClose,

    onDisclaimerModalClose,
  }
}
