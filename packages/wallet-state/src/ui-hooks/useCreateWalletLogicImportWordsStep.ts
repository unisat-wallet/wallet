import { OW_HD_PATH, RESTORE_WALLETS, RestoreWalletType, WordsType } from '@unisat/wallet-shared'
import { AddressType } from '@unisat/wallet-types'
import { useEffect, useMemo, useState } from 'react'
import { useI18n, useNavigation, useTools, useWallet } from 'src/context'
import { useAppDispatch, useCreateAccountCallback } from 'src/hooks'
import { accountActions, keyringsActions } from 'src/reducers'
import { validateMnemonic } from 'src/utils/bitcoin-utils'

export enum TabType {
  STEP1 = 'STEP1',
  STEP2 = 'STEP2',
  CHOOSE_ADDRESS_TYPE = 'CHOOSE_ADDRESS_TYPE',
}

function normalizeWhitespace(str: string) {
  str = str.replace(/[\n\r\t]+/g, ' ')
  str = str.replace(/\s+/g, ' ')
  str = str.trim()
  return str
}

export interface ContextData {
  mnemonics: string
  hdPath: string
  passphrase: string
  addressType: AddressType
  step1Completed: boolean
  tabType: TabType
  restoreWalletType: RestoreWalletType
  isRestore: boolean
  isCustom: boolean
  customHdPath: string
  addressTypeIndex: number
  wordsType: WordsType
  walletName?: string
}

export interface UpdateContextDataParams {
  mnemonics?: string
  hdPath?: string
  passphrase?: string
  addressType?: AddressType
  step1Completed?: boolean
  tabType?: TabType
  restoreWalletType?: RestoreWalletType
  isCustom?: boolean
  customHdPath?: string
  addressTypeIndex?: number
  wordsType?: WordsType
  walletName?: string
}

interface WordsItem {
  key: WordsType
  label: string
  count: number
}

const getWords12Item = t => ({
  key: WordsType.WORDS_12,
  label: t('mnemonics_12_words'),
  count: 12,
})

const getWords24Item = t => ({
  key: WordsType.WORDS_24,
  label: t('mnemonics_24_words'),
  count: 24,
})

interface CreateWalletLogicParams {
  contextData: ContextData
  updateContextData: (params: UpdateContextDataParams) => void
}

function textToWordsArray(text: string) {
  return text.split(' ').filter(v => v.trim() !== '')
}

export function useCreateWalletLogicImportWordsStep(params: CreateWalletLogicParams) {
  const { contextData, updateContextData } = params
  const { t } = useI18n()

  const walletTypeConfig = RESTORE_WALLETS.find(
    item => item.value === contextData.restoreWalletType
  )
  const wordsItems: Array<WordsItem> = useMemo(() => {
    const supportedWordsItems: WordsItem[] = []
    if (walletTypeConfig) {
      if (walletTypeConfig.wordsTypes.includes(WordsType.WORDS_12)) {
        supportedWordsItems.push(getWords12Item(t))
      }
      if (walletTypeConfig.wordsTypes.includes(WordsType.WORDS_24)) {
        supportedWordsItems.push(getWords24Item(t))
      }
      return supportedWordsItems
    } else {
      return [getWords12Item(t), getWords24Item(t)]
    }
  }, [contextData.restoreWalletType, t])

  const wallet = useWallet()

  const [disabled, setDisabled] = useState(true)

  const [inputWords, setInputWords] = useState<Array<string>>(
    new Array(wordsItems[contextData.wordsType].count).fill('')
  )
  const [inputWordsText, setInputWordsText] = useState('')
  const [inputWordsError, setInputWordsError] = useState(false)
  const tools = useTools()

  const createAccount = useCreateAccountCallback()
  const nav = useNavigation()

  const dispatch = useAppDispatch()
  const [loading, setLoading] = useState(false)

  const [enteredWordsCount, setEnteredWordsCount] = useState(0)

  const enablePhrase = walletTypeConfig?.phraseSupport

  const maxWordsCount = wordsItems[contextData.wordsType].count

  const initKey = async () => {
    let totalKeyringCount = 0
    try {
      totalKeyringCount = await wallet.getTotalKeyringCount()
    } catch (e) {
      const error = e as Error
      tools.toastError(error.message)
    }
    updateContextData({ walletName: `HD Wallet #${totalKeyringCount + 1}` })
  }

  useEffect(() => {
    initKey()
  }, [])

  useEffect(() => {
    setDisabled(true)

    const words = textToWordsArray(inputWordsText)
    if (words.length !== maxWordsCount) {
      return
    }

    const mnemonic = words.join(' ')
    if (!validateMnemonic(mnemonic)) {
      return
    }

    setDisabled(false)
  }, [inputWordsText])

  const updateWords = (words: Array<string>, isEndedWithSpace?: boolean) => {
    setInputWords(words)
    let text = words.join(' ')
    setInputWordsText(isEndedWithSpace ? text + ' ' : text)

    const enteredWordsCount = words.filter(key => {
      return key.trim() != ''
    }).length

    setEnteredWordsCount(enteredWordsCount)

    if (!validateMnemonic(text) && enteredWordsCount >= maxWordsCount) {
      setInputWordsError(true)
    } else {
      setInputWordsError(false)
    }
  }

  const onInputWordsTextChange = (e: { target: { value: string } } | string) => {
    let value = typeof e === 'string' ? e : e.target.value
    let isEndedWithSpace = /\s$/.test(value)
    value = normalizeWhitespace(value)

    const wordsArr = textToWordsArray(value)
    updateWords(wordsArr, isEndedWithSpace)
  }

  const onInputWordsChange = (e: { target: { value: string } } | string, index: number) => {
    let value = typeof e === 'string' ? e : e.target.value
    value = normalizeWhitespace(value)

    const newKeys = [...inputWords]
    newKeys.splice(index, 1, value)
    updateWords(newKeys)
  }

  // extension
  const onHandleEventPaste = (event, index: number) => {
    const copyText = event.clipboardData?.getData('text/plain')
    const textArr = normalizeWhitespace(copyText).split(' ')
    const newKeys = [...inputWords]
    if (textArr) {
      for (let i = 0; i < inputWords.length - index; i++) {
        if (textArr.length == i) {
          break
        }
        newKeys[index + i] = textArr[i]
      }
      updateWords(newKeys)
    }

    event.preventDefault()
  }

  const onInputWalletNameChange = (e: { target: { value: string } } | string) => {
    const value = typeof e === 'string' ? e : e.target.value
    updateContextData({ walletName: value })
  }

  const onClickNext = async () => {
    try {
      const mnemonics = inputWords.join(' ')

      if (contextData.wordsType === WordsType.WORDS_12) {
        if (inputWords.length !== 12) {
          tools.toastError(t('ErrorPrompt_CreateHDwallet_StepImport_Not_12_words'))
          return
        }
      }

      if (contextData.wordsType === WordsType.WORDS_24) {
        if (inputWords.length !== 24) {
          tools.toastError(t('ErrorPrompt_CreateHDwallet_StepImport_Not_24_words'))
          return
        }
      }

      if (!validateMnemonic(mnemonics)) {
        tools.toastError(t('ErrorPrompt_CreateHDwallet_StepImport_InvalidMnemonic'))
        return
      }

      setLoading(true)

      if (contextData.restoreWalletType === RestoreWalletType.OW) {
        await createAccount(mnemonics, OW_HD_PATH, '', AddressType.P2TR, 1)
        const keyrings = await wallet.getKeyrings()
        const keyring = keyrings[keyrings.length - 1]
        if (contextData.walletName) {
          keyring.alianName = contextData.walletName
          await wallet.setKeyringAlianName(keyring, contextData.walletName)
        }
        await wallet.changeKeyring(keyring)
        const _keyrings = await wallet.getKeyrings()
        // @ts-ignore SAFE
        dispatch(keyringsActions.setKeyrings(_keyrings))
        // @ts-ignore SAFE
        dispatch(keyringsActions.setCurrent(keyring))
        // @ts-ignore SAFE
        dispatch(accountActions.setCurrent(keyring?.accounts[0]))

        nav.navToTab()
      } else {
        updateContextData({
          walletName: contextData.walletName,
          mnemonics,
          tabType: TabType.CHOOSE_ADDRESS_TYPE,
        })
      }
    } catch (e) {
      tools.toastError((e as any).message)
    } finally {
      setLoading(false)
    }
  }

  const onClickWordsItem = (wordsItem: WordsItem) => {
    updateContextData({ wordsType: wordsItem.key })
    setInputWordsText('')
    setInputWords(new Array(wordsItem.count).fill(''))
  }

  const shouldEnteredWordsCount = wordsItems[contextData.wordsType].count

  return {
    wordsItems,
    t,
    disabled,
    inputWords,
    inputWordsText,
    onHandleEventPaste,
    onClickNext,
    onClickWordsItem,
    inputWordsError,
    onInputWordsTextChange,
    onInputWordsChange,
    loading,
    enablePhrase,
    walletName: contextData.walletName,
    onInputWalletNameChange,
    enteredWordsCount,
    shouldEnteredWordsCount,
  }
}
