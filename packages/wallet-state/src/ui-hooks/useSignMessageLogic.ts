import {
  AccountSignMethod,
  SignedMessage,
  SignState,
  ToSignMessage,
  WebsiteResult,
} from '@unisat/wallet-shared'
import logger from 'loglevel'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApproval, useI18n, useTools, useWallet } from 'src/context'
import { useCurrentAccountCapabilities } from 'src/hooks'
import { shortAddress } from 'src/utils/ui-utils'
export interface SignMessageProps {
  header?: React.ReactNode
  params: {
    data: {
      toSignMessages: ToSignMessage[]
    }
    session?: {
      origin: string
      icon: string
      name: string
    }
  }
  handleCancel?: () => void
  handleConfirm?: (signedMessages: SignedMessage[]) => void
}

export function useSignMessageLogic(props: SignMessageProps) {
  const {
    params: {
      data: { toSignMessages },
      session,
    },
    handleCancel,
    handleConfirm,
  } = props

  const { resolveApproval, rejectApproval } = useApproval()

  const [websiteCheckStatus, setWebsiteCheckStatus] = useState<'checking' | 'complete' | 'failed'>(
    session?.origin ? 'checking' : 'complete'
  )
  const [checkedWebsite, setCheckedWebsite] = useState<string | undefined>(undefined)
  const [isKeystoneSigning, setIsKeystoneSigning] = useState(false)
  const [isColdWalletSigning, setIsColdWalletSigning] = useState(false)
  const [readonlySignature, setReadonlySignature] = useState('')

  const wallet = useWallet()
  const tools = useTools()
  const accountCapabilities = useCurrentAccountCapabilities()

  const { t } = useI18n()

  const [disclaimerVisible, setDisclaimerVisible] = useState(false)

  const [signingTxIndex, setSigningTxIndex] = useState(toSignMessages.length > 1 ? -1 : 0)
  const [signedStates, setSignedStates] = useState<SignState[]>(
    toSignMessages.map(() => SignState.PENDING)
  )

  const [websiteResult, setWebsiteResult] = useState<WebsiteResult>({
    isScammer: false,
    warning: '',
    allowQuickMultiSign: false,
  })

  const isMultipleViewMode = toSignMessages.length > 1
  const [allowQuickMultiSign, setAllowQuickMultiSign] = useState(false)

  useEffect(() => {
    if (toSignMessages.length <= 1) {
      return
    }

    if (accountCapabilities.signMethod !== AccountSignMethod.Local) {
      return
    }

    setAllowQuickMultiSign(websiteResult.allowQuickMultiSign && toSignMessages.length > 1)
  }, [websiteResult, accountCapabilities, toSignMessages.length])

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
        if (!result.allowQuickMultiSign && toSignMessages.length > 1) {
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
  }, [session?.origin, toSignMessages.length, wallet])

  const currentToSignMessage = toSignMessages[signingTxIndex]

  const signedMessages = useRef<SignedMessage[]>([])

  const isScammer = websiteResult ? websiteResult.isScammer : false
  const canSign =
    websiteCheckStatus === 'complete' && checkedWebsite === session?.origin && !isScammer
  const loading = websiteCheckStatus === 'checking'

  const isAllSigned = signedStates.every(state => state === SignState.SUCCESS)
  const signedCount = signedStates.filter(state => state === SignState.SUCCESS).length

  const defaultHandleCancel = () => rejectApproval()
  const actualHandleCancel = handleCancel || defaultHandleCancel

  const multiSignList = useMemo(() => {
    return toSignMessages.map((data, index) => {
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

      let title = shortAddress(data.text, 10)

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
  }, [toSignMessages, signedStates, t])

  // action
  const onClickBack = () => {
    if (isMultipleViewMode && signingTxIndex != -1) {
      // back to multi sign view
      setSigningTxIndex(-1)
      return
    }
    actualHandleCancel()
  }

  const onClickSign = () => {
    if (!canSign) return
    onNextStep()
  }

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
    for (let i = 0; i < toSignMessages.length; i++) {
      try {
        const toSignMessage = toSignMessages[i]
        const signedData = await wallet.signMessage(toSignMessage)
        onSignedData(signedData, i)
      } catch (e) {
        signedStates[i] = SignState.FAILED
        setSignedStates([...signedStates])
        logger.error(`Quick signing message ${i} failed:`, e)
      }
    }
  }

  const localSign = async () => {
    try {
      const toSignMessage = toSignMessages[signingTxIndex]
      const signedData = await wallet.signMessage(toSignMessage)
      onSignedData(signedData, signingTxIndex)
    } catch (e) {
      signedStates[signingTxIndex] = SignState.FAILED
      setSignedStates([...signedStates])
      logger.error('Local signing failed:', e)
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
        if (!readonlySignature) {
          tools.toastError(t('please_enter_your_signature'))
          return
        }

        onSignedData({ signature: readonlySignature }, signingTxIndex)
        setReadonlySignature('')
        return
      case AccountSignMethod.Local:
        localSign()
        return
      case AccountSignMethod.None:
      default:
        tools.toastError(t('not_supported'))
    }
  }

  const onSignedData = (data: SignedMessage, signingTxIndex: number) => {
    signedStates[signingTxIndex] = SignState.SUCCESS
    setSignedStates([...signedStates])

    signedMessages.current[signingTxIndex] = data

    // check if all signed

    // single mode
    if (!isMultipleViewMode) {
      if (handleConfirm) {
        handleConfirm(signedMessages.current)
      } else {
        resolveApproval(signedMessages.current)
      }
      return
    }

    // multiple mode
    const isAllSigned = signedStates.every(state => state === SignState.SUCCESS)
    if (isAllSigned) {
      if (handleConfirm) {
        handleConfirm(signedMessages.current)
      } else {
        resolveApproval(signedMessages.current)
      }
      return
    } else {
      setSigningTxIndex(-1)
      return
    }
  }

  // keystone
  const onKeystoneSigningSuccess = (data: SignedMessage) => {
    setIsKeystoneSigning(false)
    onSignedData(data, signingTxIndex)
  }

  const onKeystoneSigningBack = () => {
    setIsKeystoneSigning(false)
  }

  // coldwallet
  const onColdWalletSigningSuccess = (data: SignedMessage) => {
    setIsColdWalletSigning(false)
    onSignedData(data, signingTxIndex)
  }

  const onColdWalletSigningBack = () => {
    setIsColdWalletSigning(false)
  }

  // disclaimer modal
  const onDisclaimerModalClose = () => {
    setDisclaimerVisible(false)
  }

  const showMultiSignView = isMultipleViewMode && signingTxIndex == -1

  return {
    loading,
    t,
    session,

    // page state
    isKeystoneSigning,
    isColdWalletSigning,
    showMultiSignView,

    disclaimerVisible,

    // data
    toSignMessages,
    currentToSignMessage,

    // state
    isScammer,
    canSign,
    allowQuickMultiSign,

    // multiple sign state
    isAllSigned,
    signedCount,
    multiSignList,

    // actions
    onClickBack,
    onClickSign,
    onQuickMultiSign,
    onTryMultiSign,
    onTrustSite,

    onKeystoneSigningSuccess,
    onKeystoneSigningBack,

    onColdWalletSigningSuccess,
    onColdWalletSigningBack,

    readonlySignature,
    setReadonlySignature,

    onDisclaimerModalClose,
  }
}
