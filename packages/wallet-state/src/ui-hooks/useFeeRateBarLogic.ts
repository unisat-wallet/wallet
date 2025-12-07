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

// Fee rate display rules:
// if (Fast = Avg = Slow) -> show Fast time (30s) for all
// if (Fast = Avg) -> show Fast time (30s) for both
// if (Avg = Slow) -> show Avg time (1.5m) for both

function getFractalFeeDesc(
  index: FeeRateType,
  fastRate: number,
  avgRate: number,
  slowRate: number,
  t: (key: string) => string
): string {
  const { FAST, AVG, SLOW } = FeeRateType

  // All rates are equal
  if (fastRate === avgRate && avgRate === slowRate) {
    return t('feerate_fast_desc_fb')
  }

  // Fast equals Avg
  if (fastRate === avgRate) {
    return index === SLOW ? t('feerate_slow_desc_fb') : t('feerate_fast_desc_fb')
  }

  // Avg equals Slow
  if (avgRate === slowRate && (index === AVG || index === SLOW)) {
    return t('feerate_avg_desc_fb')
  }

  // Default descriptions
  const descriptions = {
    [FAST]: 'feerate_fast_desc_fb',
    [AVG]: 'feerate_avg_desc_fb',
    [SLOW]: 'feerate_slow_desc_fb',
  }

  return t(descriptions[index] || '')
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

    if (isFractal) {
      desc = getFractalFeeDesc(index, fastRate, avgRate, slowRate, t)
    } else {
      if (fastRate === slowRate) {
        desc = t('feerate_fast_desc')
      }

      if (supportLowFeeMode) {
        if (index === SLOW) {
          title = t('feerate_sub1_title')
          desc = ''
        }
      }
    }

    return {
      ...option,
      title,
      desc,
    }
  })
}

export function useFeeRateBarLogic({ readonly }: { readonly?: boolean }) {
  const wallet = useWallet()
  const [feeOptions, setFeeOptions] = useState<FeeOption[]>([])
  const feeRateBarState = useFeeRateBar()
  const updateFeeRateBar = useUpdateFeeRateBar()
  const feeRateInputVal = feeRateBarState.feeRateInputVal
  const feeOptionIndex = feeRateBarState.feeOptionIndex
  const showCustomInput = feeRateBarState.showCustomInput
  const feeRate = feeRateBarState.feeRate
  const { t, isSpecialLocale } = useI18n()
  const chain = useChain()
  const isFractal = chain.isFractal
  const fontSize = useMemo(() => (isSpecialLocale ? 'xxxs' : 'xxs'), [isSpecialLocale])

  const [showLowFeeModeTipsPopover, setShowLowFeeModeTipsPopover] = useState(false)

  const supportLowFeeMode = chain.enableLowFeeMode ?? false

  useAsyncEffect(async () => {
    const feeSummary = await wallet.getFeeSummary()

    if (supportLowFeeMode) {
      const lowFeeSummary = await wallet.getLowFeeSummary()
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
    () => feeOptions[AVG_OPTION_INDEX]?.feeRate ?? DEFAULT_FEE_RATE,
    [feeOptions]
  )

  useEffect(() => {
    let val = defaultFeeRate
    if (feeOptionIndex === FeeRateType.CUSTOM) {
      val = parseFloat(feeRateInputVal) || 0
    } else if (feeOptions.length > 0) {
      val = feeOptions[feeOptionIndex]?.feeRate ?? defaultFeeRate
    }

    if (val.toString() == feeRate.toString()) {
      return
    }

    if (val === feeRate) {
      return
    }

    updateFeeRateBar({ feeRate: val })
  }, [feeOptions, feeOptionIndex, feeRateInputVal, defaultFeeRate, feeRate])

  const adjustFeeRateInput = useCallback(
    (inputVal: string) => {
      // When user manually changes the input, check if we need to switch to CUSTOM
      const shouldSwitchToCustom = feeOptionIndex !== FeeRateType.CUSTOM && feeOptions.length > 0
      const selectedOption = feeOptions[feeOptionIndex]

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

      // Allow intermediate input like "0" or "0." for typing "0.1"
      if (inputVal === '0' || inputVal.endsWith('.')) {
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
    [defaultFeeRate, updateFeeRateBar, feeOptionIndex, feeOptions, supportLowFeeMode]
  )

  const isCustomOption = useCallback((option: FeeOption) => option.type === FeeRateType.CUSTOM, [t])

  const toggleLowFeeRate = useCallback(async () => {
    const selectedOption = feeOptions[FeeRateType.SLOW]
    updateFeeRateBar({
      feeOptionIndex: FeeRateType.SLOW,
      showCustomInput: true,
      feeRateInputVal: selectedOption.feeRate.toString(),
    })
  }, [feeOptions, updateFeeRateBar, feeRateInputVal])

  const setFeeOptionIndex = useCallback(
    async (index: number) => {
      const selectedOption = feeOptions[index]
      if (supportLowFeeMode && index === FeeRateType.SLOW) {
        const acceptLowFeeMode = await wallet.getAcceptLowFeeMode()
        if (acceptLowFeeMode === false) {
          setShowLowFeeModeTipsPopover(true)
          return
        }
      }
      if (index !== FeeRateType.CUSTOM && selectedOption) {
        // When clicking on SLOW/AVG/FAST, show input and fill with the corresponding value
        updateFeeRateBar({
          feeOptionIndex: index,
          showCustomInput: true,
          feeRateInputVal: selectedOption.feeRate.toString(),
        })
      } else if (index === FeeRateType.CUSTOM) {
        // When clicking on CUSTOM, show input with current custom value or empty
        updateFeeRateBar({
          feeOptionIndex: index,
          showCustomInput: true,
        })
      }
    },
    [feeOptions, updateFeeRateBar]
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

  return {
    feeOptions,
    feeOptionIndex,
    setFeeOptionIndex,
    feeRateInputVal,
    adjustFeeRateInput,
    isCustomOption,
    fontSize,
    isSpecialLocale,
    toggleLowFeeRate,
    showCustomInput,
    toggleCustomInput,
    supportLowFeeMode,
    showLowFeeModeTipsPopover,
    setShowLowFeeModeTipsPopover,
    isSub1FeeOptionOn,
  }
}
