import { useEffect, useMemo, useState } from 'react'
import {
  useFetchUtxosCallback,
  useI18n,
  useNavigation,
  useOrdinalsTx,
  usePrepareSendOrdinalsInscriptionCallback,
  useTools,
  useWallet,
} from '..'
import { Inscription, RawTxInfo } from '@unisat/wallet-shared'
import { getAddressUtxoDust, isValidAddress } from '../utils/bitcoin-utils'

export function useSendOrdinalsInscriptionScreenLogic() {
  const [disabled, setDisabled] = useState(true)
  const nav = useNavigation()

  const { inscription } = nav.getRouteState<{
    inscription: Inscription
  }>()
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

  const [feeRate, setFeeRate] = useState(5)
  const [enableRBF, setEnableRBF] = useState(false)
  const defaultOutputValue = inscription ? inscription.outputValue : 10000

  const [outputValue, setOutputValue] = useState(defaultOutputValue)
  const [inscriptions, setInscriptions] = useState<Inscription[]>([])

  const wallet = useWallet()
  useEffect(() => {
    wallet.getInscriptionUtxoDetail(inscription.inscriptionId).then(v => {
      setInscriptions(v.inscriptions)
    })
  }, [])

  const [rawTxInfo, setRawTxInfo] = useState<RawTxInfo>()

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

    if (
      toInfo.address == ordinalsTx.toAddress &&
      feeRate == ordinalsTx.feeRate &&
      outputValue == ordinalsTx.outputValue &&
      enableRBF == ordinalsTx.enableRBF
    ) {
      //Prevent repeated triggering caused by setAmount
      setDisabled(false)
      return
    }

    prepareSendOrdinalsInscription({
      toAddressInfo: toInfo,
      inscriptionId: inscription.inscriptionId,
      feeRate,
      outputValue,
      enableRBF,
    })
      .then(data => {
        setRawTxInfo(data)
        setDisabled(false)
      })
      .catch(e => {
        console.log(e)
        setError(e.message)
      })
  }, [toInfo, feeRate, outputValue, enableRBF, inscriptions])

  const onAddressInputChange = val => {
    setToInfo(val)
  }

  return {
    t,
    onAddressInputChange,
    toInfo,
    feeRate,
    setFeeRate,
    outputValue,
    minOutputValue,
    defaultOutputValue,
    setOutputValue,
    enableRBF,
    setEnableRBF,
    inscriptions,
    disabled,
    error,
    rawTxInfo,
  }
}
