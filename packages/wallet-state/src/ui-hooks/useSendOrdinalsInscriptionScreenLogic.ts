import { Inscription } from '@unisat/wallet-shared'
import { useEffect, useMemo, useState } from 'react'
import {
  useFeeRateBar,
  useFetchUtxosCallback,
  useI18n,
  useNavigation,
  useOrdinalsTx,
  usePrepareSendOrdinalsInscriptionCallback,
  useTools,
  useWallet,
} from '..'
import { getAddressUtxoDust, isValidAddress } from '../utils/bitcoin-utils'

export function useSendOrdinalsInscriptionScreenLogic() {
  const [disabled, setDisabled] = useState(true)
  const nav = useNavigation()

  const { inscription } = nav.getRouteState<'SendOrdinalsInscriptionScreen'>()
  const ordinalsTx = useOrdinalsTx()
  const [toInfo, setToInfo] = useState({
    address: ordinalsTx.toAddress,
    domain: ordinalsTx.toDomain,
  })
  const { t } = useI18n()

  const fetchBtcUtxos = useFetchUtxosCallback()
  const tools = useTools()
  useEffect(() => {
    tools.showLoading(true)
    fetchBtcUtxos().finally(() => {
      tools.showLoading(false)
    })
  }, [])

  const [error, setError] = useState('')
  const prepareSendOrdinalsInscription = usePrepareSendOrdinalsInscriptionCallback()
  const { feeRate } = useFeeRateBar()
  const defaultOutputValue = inscription ? inscription.outputValue : 10000

  const [outputValue, setOutputValue] = useState(defaultOutputValue)
  const [inscriptions, setInscriptions] = useState<Inscription[]>([])

  const wallet = useWallet()
  useEffect(() => {
    wallet.getInscriptionUtxoDetail(inscription.inscriptionId).then(v => {
      setInscriptions(v.inscriptions)
    })
  }, [])

  const minOutputValue = useMemo(() => {
    if (toInfo.address) {
      return getAddressUtxoDust(toInfo.address)
    } else {
      return 0
    }
  }, [toInfo.address])

  useEffect(() => {
    setDisabled(true)
    setError('')

    if (feeRate <= 0) {
      setError(t('invalid_fee_rate'))
      return
    }

    let dustUtxo = inscription.outputValue
    try {
      if (toInfo.address) {
        dustUtxo = getAddressUtxoDust(toInfo.address)
      }
    } catch (e) {
      // console.log(e);
    }

    const maxOffset = inscriptions.reduce((pre, cur) => {
      return Math.max(pre, cur.offset)
    }, 0)

    const minOutputValue = Math.max(maxOffset + 1, dustUtxo)

    if (outputValue < minOutputValue) {
      setError(`${t('output_value_must_be_at_least')} ${minOutputValue}`)
      return
    }

    if (!outputValue) {
      return
    }

    if (!isValidAddress(toInfo.address)) {
      return
    }

    setDisabled(false)
  }, [toInfo, feeRate, outputValue, inscriptions])

  const onAddressInputChange = val => {
    setToInfo(val)
  }

  const onClickBack = () => {
    nav.goBack()
  }

  const onClickNext = () => {
    prepareSendOrdinalsInscription({
      toAddressInfo: toInfo,
      inscriptionId: inscription.inscriptionId,
      feeRate,
      outputValue,
    })
      .then(toSignData => {
        nav.navigate('TxConfirmScreen', { toSignData })
      })
      .catch(e => {
        console.log(e)
        setError(e.message)
      })
  }

  return {
    t,
    onAddressInputChange,
    toInfo,
    outputValue,
    minOutputValue,
    defaultOutputValue,
    setOutputValue,
    inscriptions,
    disabled,
    error,
    onClickBack,
    onClickNext,
  }
}
