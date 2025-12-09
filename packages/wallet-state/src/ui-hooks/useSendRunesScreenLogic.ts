import { bnUtils } from '@unisat/base-utils'
import { Inscription, RawTxInfo, RuneBalance, RuneInfo } from '@unisat/wallet-shared'
import BigNumber from 'bignumber.js'
import { useEffect, useMemo, useState } from 'react'
import { useI18n, useNavigation, useTools } from 'src/context'
import {
  useCurrentAccount,
  useFeeRateBar,
  useFetchAssetUtxosRunesCallback,
  useFetchUtxosCallback,
  usePrepareSendRunesCallback,
  useRunesTx,
} from 'src/hooks'
import { getAddressUtxoDust, isValidAddress } from 'src/utils/bitcoin-utils'

export function useSendRunesScreenLogic() {
  const nav = useNavigation()
  const props = nav.getRouteState<{
    runeBalance: RuneBalance
    runeInfo: RuneInfo
  }>()
  const { t } = useI18n()

  const runeBalance = props.runeBalance

  const runeInfo = props.runeInfo

  const runesTx = useRunesTx()
  const [inputAmount, setInputAmount] = useState('')
  const [disabled, setDisabled] = useState(true)
  const [toInfo, setToInfo] = useState<{
    address: string
    domain: string
    inscription?: Inscription
  }>({
    address: runesTx.toAddress,
    domain: runesTx.toDomain,
    inscription: undefined,
  })

  const [availableBalance, setAvailableBalance] = useState('0')
  const [error, setError] = useState('')

  const defaultOutputValue = 546

  const currentAccount = useCurrentAccount()
  const [outputValue, setOutputValue] = useState(defaultOutputValue)
  const minOutputValue = useMemo(() => {
    if (toInfo.address) {
      const dust1 = getAddressUtxoDust(currentAccount.address)
      const dust2 = getAddressUtxoDust(toInfo.address)
      return Math.max(dust1, dust2)
    } else {
      return 0
    }
  }, [toInfo.address, currentAccount.address])

  const fetchUtxos = useFetchUtxosCallback()

  const fetchAssetUtxosRunes = useFetchAssetUtxosRunesCallback()
  const tools = useTools()
  useEffect(() => {
    fetchUtxos()
    tools.showLoading(true)
    fetchAssetUtxosRunes(runeInfo.runeid)
      .then(utxos => {
        let balance = new BigNumber(0)
        for (let i = 0; i < utxos.length; i++) {
          const utxo = utxos[i]
          if (utxo.runes) {
            utxo.runes.forEach(rune => {
              if (rune.runeid === runeInfo.runeid) {
                balance = balance.plus(new BigNumber(rune.amount))
              }
            })
          }
        }
        setAvailableBalance(balance.toString())
      })
      .finally(() => {
        tools.showLoading(false)
      })
  }, [])

  const prepareSendRunes = usePrepareSendRunesCallback()

  const { feeRate } = useFeeRateBar()

  const [rawTxInfo, setRawTxInfo] = useState<RawTxInfo>()
  useEffect(() => {
    setError('')
    setDisabled(true)

    if (!isValidAddress(toInfo.address)) {
      return
    }
    if (!inputAmount) {
      return
    }

    const runeAmount = bnUtils.fromDecimalAmount(inputAmount, runeInfo.divisibility)
    if (feeRate <= 0) {
      return
    }

    if (inputAmount === '0') {
      return
    }

    if (outputValue < minOutputValue) {
      setError(`${t('output_value_must_be_at_least')} ${minOutputValue}`)
      return
    }

    if (!outputValue) {
      return
    }

    if (
      toInfo.address == runesTx.toAddress &&
      runeAmount == runesTx.runeAmount &&
      outputValue == runesTx.outputValue
    ) {
      //Prevent repeated triggering caused by setAmount
      setDisabled(false)
      return
    }

    prepareSendRunes({
      toAddressInfo: toInfo,
      runeid: runeInfo.runeid,
      runeAmount: runeAmount,
      outputValue: outputValue,
      feeRate,
    })
      .then(data => {
        // if (data.fee < data.estimateFee) {
        //   setError(`Network fee must be at leat ${data.estimateFee}`);
        //   return;
        // }
        setRawTxInfo(data)
        setDisabled(false)
      })
      .catch(e => {
        console.log(e)
        setError(e.message)
      })
  }, [toInfo, inputAmount, feeRate, outputValue, minOutputValue])

  const onClickNext = () => {
    if (rawTxInfo) {
      nav.navigate('TxConfirmScreen', { rawTxInfo })
    }
  }

  return {
    runeBalance,
    runeInfo,
    inputAmount,
    setInputAmount,
    disabled,
    toInfo,
    setToInfo,
    availableBalance,
    error,
    defaultOutputValue,
    minOutputValue,
    setOutputValue,
    t,
    onClickNext,
  }
}
