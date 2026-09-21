import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n, useWallet } from '../context'
import { useChain, useFeeRateBar, useUpdateFeeRateBar } from '../hooks'
import { useAsyncEffect } from '../utils/ui-utils'

enum FeeRateType {
  SLOW,
  AVG,
  FAST,
  CUSTOM,
}

interface FeeOption {
  type?: FeeRateType
  title: string
  desc?: string
  feeRate: number
}

const translationKeys = {
  [FeeRateType.SLOW]: { type: FeeRateType.SLOW, title: 'slow', desc: 'feerate_slow_desc' },
  [FeeRateType.AVG]: { type: FeeRateType.AVG, title: 'avg', desc: 'feerate_avg_desc' },
  [FeeRateType.FAST]: { type: FeeRateType.FAST, title: 'fast', desc: 'feerate_fast_desc' },
} as const

const MAX_FEE_RATE = 10000
const DEFAULT_FEE_RATE = 1
const AVG_OPTION_INDEX = 1

function isIntermediateFeeRateInput(value: string) {
  return value === '' || value === '0' || value.endsWith('.')
}

// Fee rate display rules:
// if (Fast = Avg = Slow) -> show Fast time (30s) for all
// if (Fast = Avg) -> show Fast time (30s) for both
// if (Avg = Slow) -> show Avg time (1.5m) for both

function suffixDesc(key: string, isFractal: boolean) {
  if (isFractal) {
    return key + '_fb'
  }
  return key
}

function getFractalFeeDesc(
  index: FeeRateType,
  fastRate: number,
  avgRate: number,
  slowRate: number,
  t: (key: string) => string,
  isFractal: boolean
): string {
  const { FAST, AVG, SLOW } = FeeRateType

  // All rates are equal
  if (fastRate === avgRate && avgRate === slowRate) {
    return t(suffixDesc('feerate_fast_desc', isFractal))
  }

  // Fast equals Avg
  if (fastRate === avgRate) {
    return index === SLOW
      ? t(suffixDesc('feerate_slow_desc', isFractal))
      : t(suffixDesc('feerate_fast_desc', isFractal))
  }

  // Avg equals Slow
  if (avgRate === slowRate && (index === AVG || index === SLOW)) {
    return t(suffixDesc('feerate_avg_desc', isFractal))
  }

  // Default descriptions
  const descriptions = {
    [FAST]: 'feerate_fast_desc',
    [AVG]: 'feerate_avg_desc',
    [SLOW]: 'feerate_slow_desc',
  }

  return t(suffixDesc(descriptions[index] || '', isFractal))
}

function formatFeeRateTextKey(
  list: FeeOption[],
  isFractal: boolean,
  supportLowFeeMode: boolean,
  t: (key: string) => string
): FeeOption[] {
  const { FAST, AVG, SLOW } = FeeRateType
  const fastRate = list[FAST]?.feeRate ?? 0
  const avgRate = list[AVG]?.feeRate ?? 0
  const slowRate = list[SLOW]?.feeRate ?? 0

  return list.map((option, index) => {
    const keys = translationKeys[index as FeeRateType]
    if (!keys) return option

    let title = t(keys.title)

    let desc = t(keys.desc)

    desc = getFractalFeeDesc(index, fastRate, avgRate, slowRate, t, isFractal)

    if (supportLowFeeMode) {
      if (index === SLOW) {
        title = t('feerate_sub1_title')
        desc = ''
      }
    }

    return {
      ...option,
      title,
      desc,
    }
  })
}

function buildPlaceholderFeeOptions(
  supportLowFeeMode: boolean,
  readonly: boolean | undefined,
  t: (key: string) => string,
  avgFeeRate: number
): FeeOption[] {
  const slowRate = supportLowFeeMode ? 0.1 : avgFeeRate
  const list: FeeOption[] = [
    {
      type: FeeRateType.SLOW,
      title: supportLowFeeMode ? t('feerate_sub1_title') : t('slow'),
      desc: supportLowFeeMode ? '' : t('feerate_slow_desc'),
      feeRate: slowRate,
    },
    {
      type: FeeRateType.AVG,
      title: t('avg'),
      desc: t('feerate_avg_desc'),
      feeRate: avgFeeRate,
    },
    {
      type: FeeRateType.FAST,
      title: t('fast'),
      desc: t('feerate_fast_desc'),
      feeRate: avgFeeRate,
    },
  ]

  if (!readonly) {
    list.push({ type: FeeRateType.CUSTOM, title: t('custom'), feeRate: 0 })
  }

  return list
}

export function useFeeRateBarLogic({ readonly }: { readonly?: boolean }) {
  const wallet = useWallet()
  const [feeOptions, setFeeOptions] = useState<FeeOption[]>([])
  const feeRateBarState = useFeeRateBar()
  const updateFeeRateBar = useUpdateFeeRateBar()
  const feeRateInputVal = feeRateBarState.feeRateInputVal
  const feeOptionIndex = feeRateBarState.feeOptionIndex
  const feeRate = feeRateBarState.feeRate
  const { t, isSpecialLocale } = useI18n()
  const chain = useChain()
  const isFractal = chain.isFractal
  const fontSize = useMemo(() => (isSpecialLocale ? 'xxxs' : 'xxs'), [isSpecialLocale])

  const [showLowFeeModeTipsPopover, setShowLowFeeModeTipsPopover] = useState(false)

  const supportLowFeeMode = chain.enableLowFeeMode ?? false

  const placeholderFeeOptions = useMemo(
    () =>
      buildPlaceholderFeeOptions(
        supportLowFeeMode,
        readonly,
        t,
        feeRate > 0 ? feeRate : DEFAULT_FEE_RATE
      ),
    [supportLowFeeMode, readonly, t, feeRate]
  )

  const hasLoadedFeeOptions = feeOptions.length > 0
  const resolvedFeeOptions = hasLoadedFeeOptions ? feeOptions : placeholderFeeOptions

  useAsyncEffect(async () => {
    const [feeSummary, lowFeeSummary] = await Promise.all([
      wallet.getFeeSummary(),
      supportLowFeeMode ? wallet.getLowFeeSummary() : Promise.resolve(null),
    ])

    if (supportLowFeeMode && lowFeeSummary) {
      feeSummary.list[0] = lowFeeSummary.list[1]

      // try use slow fee rate if it's lower than 1 sat/vB
      if (feeSummary.list[0].feeRate > 1) {
        feeSummary.list[0] = lowFeeSummary.list[0]
      }

      // ensure slow fee rate is below 1 sat/vB
      if (feeSummary.list[0].feeRate > 1) {
        feeSummary.list[0].feeRate = 0.1
      }
    }

    const translatedList = formatFeeRateTextKey(feeSummary.list, isFractal, supportLowFeeMode, t)
    const options = readonly
      ? translatedList
      : [...translatedList, { type: FeeRateType.CUSTOM, title: t('custom'), feeRate: 0 }]

    setFeeOptions(options)
  }, [wallet, isFractal, t, supportLowFeeMode, readonly])

  // Memoize default value to avoid repeated calculations
  const defaultFeeRate = useMemo(
    () => resolvedFeeOptions[AVG_OPTION_INDEX]?.feeRate ?? DEFAULT_FEE_RATE,
    [resolvedFeeOptions]
  )

  useEffect(() => {
    let val = defaultFeeRate
    if (feeOptionIndex === FeeRateType.CUSTOM) {
      val = parseFloat(feeRateInputVal) || 0
      // Zero marks an unfinished custom fee so send screens disable submission.
      if (val <= 0) {
        if (feeRate !== 0) updateFeeRateBar({ feeRate: 0 })
        return
      }
    } else if (resolvedFeeOptions.length > 0) {
      val = resolvedFeeOptions[feeOptionIndex]?.feeRate ?? defaultFeeRate
    }

    if (val.toString() == feeRate.toString()) {
      return
    }

    if (val === feeRate) {
      return
    }

    updateFeeRateBar({ feeRate: val })
  }, [resolvedFeeOptions, feeOptionIndex, feeRateInputVal, defaultFeeRate, feeRate])

  const adjustFeeRateInput = useCallback(
    (inputVal: string) => {
      // When user manually changes the input, check if we need to switch to CUSTOM
      const shouldSwitchToCustom =
        feeOptionIndex !== FeeRateType.CUSTOM &&
        hasLoadedFeeOptions &&
        resolvedFeeOptions.length > 0
      const selectedOption = resolvedFeeOptions[feeOptionIndex]

      // If currently on SLOW/AVG/FAST and user changes the value, switch to CUSTOM
      if (shouldSwitchToCustom && selectedOption) {
        const currentValue = selectedOption.feeRate.toString()
        if (inputVal !== currentValue) {
          updateFeeRateBar({
            feeRateInputVal: inputVal,
            feeOptionIndex: FeeRateType.CUSTOM,
          })
          return
        }
      }

      // Allow empty input
      if (inputVal === '') {
        updateFeeRateBar({ feeRateInputVal: '' })
        return
      }

      const val = parseFloat(inputVal)

      // Check if input is a valid number
      if (isNaN(val)) {
        updateFeeRateBar({ feeRateInputVal: '' })
        return
      }

      // Preserve intermediate text for both regular and low-fee decimal input.
      if (isIntermediateFeeRateInput(inputVal)) {
        updateFeeRateBar({ feeRateInputVal: inputVal })
        return
      }

      // Validate and constrain the value
      if (val <= 0) {
        updateFeeRateBar({ feeRateInputVal: defaultFeeRate.toString() })
      } else if (val > MAX_FEE_RATE) {
        updateFeeRateBar({ feeRateInputVal: MAX_FEE_RATE.toString() })
      } else if (val < 1 && supportLowFeeMode == false) {
        updateFeeRateBar({ feeRateInputVal: '1' })
      } else if (val < 0.1) {
        updateFeeRateBar({ feeRateInputVal: '0.1' })
      } else {
        updateFeeRateBar({ feeRateInputVal: inputVal })
      }
    },
    [
      defaultFeeRate,
      updateFeeRateBar,
      feeOptionIndex,
      resolvedFeeOptions,
      hasLoadedFeeOptions,
      supportLowFeeMode,
    ]
  )

  const isCustomOption = useCallback((option: FeeOption) => option.type === FeeRateType.CUSTOM, [t])

  const toggleLowFeeRate = useCallback(async () => {
    const selectedOption = resolvedFeeOptions[FeeRateType.SLOW]
    updateFeeRateBar({
      feeOptionIndex: FeeRateType.SLOW,
      showCustomInput: true,
      feeRateInputVal: selectedOption.feeRate.toString(),
    })
  }, [resolvedFeeOptions, updateFeeRateBar, feeRateInputVal])

  const setFeeOptionIndex = useCallback(
    async (index: number) => {
      const selectedOption = resolvedFeeOptions[index]
      if (supportLowFeeMode && index === FeeRateType.SLOW) {
        const acceptLowFeeMode = await wallet.getAcceptLowFeeMode()
        if (acceptLowFeeMode === false) {
          setShowLowFeeModeTipsPopover(true)
          return
        }
      }

      const showInput =
        index === FeeRateType.CUSTOM || (supportLowFeeMode && index === FeeRateType.SLOW)

      if (index === FeeRateType.CUSTOM) {
        updateFeeRateBar({
          feeOptionIndex: index,
          showCustomInput: showInput,
        })
      } else if (selectedOption) {
        updateFeeRateBar({
          feeOptionIndex: index,
          showCustomInput: showInput,
          feeRateInputVal: selectedOption.feeRate.toString(),
        })
      }
    },
    [resolvedFeeOptions, updateFeeRateBar, supportLowFeeMode, wallet]
  )

  const toggleCustomInput = useCallback(
    (show: boolean) => {
      updateFeeRateBar({ showCustomInput: show })
    },
    [updateFeeRateBar]
  )

  const isSub1FeeOptionOn = useMemo(() => {
    if (supportLowFeeMode && feeOptionIndex === FeeRateType.SLOW) {
      return true
    }
    return false
  }, [feeOptionIndex, supportLowFeeMode])

  const resolvedShowCustomInput = useMemo(() => {
    if (readonly) {
      return false
    }
    if (feeOptionIndex === FeeRateType.CUSTOM) {
      return true
    }
    if (supportLowFeeMode && feeOptionIndex === FeeRateType.SLOW) {
      return true
    }
    return false
  }, [readonly, feeOptionIndex, supportLowFeeMode])

  return {
    feeOptions: resolvedFeeOptions,
    feeOptionsLoading: !hasLoadedFeeOptions,
    feeOptionIndex,
    setFeeOptionIndex,
    feeRateInputVal,
    adjustFeeRateInput,
    isCustomOption,
    fontSize,
    isSpecialLocale,
    toggleLowFeeRate,
    showCustomInput: resolvedShowCustomInput,
    toggleCustomInput,
    supportLowFeeMode,
    showLowFeeModeTipsPopover,
    setShowLowFeeModeTipsPopover,
    isSub1FeeOptionOn,
  }
}
