import { KeyringType } from '@unisat/keyring-service/types'
import { SignedMessage, SignState, ToSignMessage, WebsiteResult } from '@unisat/wallet-shared'
import logger from 'loglevel'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApproval, useI18n, useTools, useWallet } from 'src/context'
import { useCurrentAccount } from 'src/hooks'
import { shortAddress, useAsyncEffect } from 'src/utils/ui-utils'
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

  const [loading, setLoading] = useState(false)
  const [isKeystoneSigning, setIsKeystoneSigning] = useState(false)
  const [isColdWalletSigning, setIsColdWalletSigning] = useState(false)

  const wallet = useWallet()
  const tools = useTools()
  const currentAccount = useCurrentAccount()
  const keyringType = currentAccount.type

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

    if (
      keyringType === KeyringType.KeystoneKeyring ||
      keyringType === KeyringType.ColdWalletKeyring
    ) {
      return
    }

    setAllowQuickMultiSign(websiteResult.allowQuickMultiSign && toSignMessages.length > 1)
  }, [websiteResult, keyringType])

  useAsyncEffect(async () => {
    const website = session?.origin
    if (website) {
      const result = await wallet.checkWebsite(website)
      setWebsiteResult(result)
    }
  }, [])

  const currentToSignMessage = toSignMessages[signingTxIndex]

  const signedMessages = useRef<SignedMessage[]>([])

  const isScammer = websiteResult ? websiteResult.isScammer : false

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
    onNextStep()
  }

  const onTryMultiSign = async () => {
    setDisclaimerVisible(true)
  }

  const onQuickMultiSign = async () => {
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
    if (keyringType === KeyringType.KeystoneKeyring) {
      setIsKeystoneSigning(true)
    } else if (keyringType === KeyringType.ColdWalletKeyring) {
      setIsColdWalletSigning(true)
    } else {
      localSign()
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

    onKeystoneSigningSuccess,
    onKeystoneSigningBack,

    onColdWalletSigningSuccess,
    onColdWalletSigningBack,

    onDisclaimerModalClose,
  }
}
