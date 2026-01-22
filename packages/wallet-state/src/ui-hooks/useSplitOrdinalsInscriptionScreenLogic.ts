import { Inscription } from '@unisat/wallet-shared'
import { useEffect, useState } from 'react'
import { useI18n, useNavigation, useWallet } from 'src/context'
import {
  useCreateSplitTxCallback,
  useCurrentAccount,
  useFeeRateBar,
  useOrdinalsTx,
} from 'src/hooks'
import { getAddressUtxoDust } from 'src/utils/bitcoin-utils'

export function useSplitOrdinalsInscriptionScreenLogic() {
  const nav = useNavigation()
  const props = nav.getRouteState<'SplitOrdinalsInscriptionScreen'>()

  const inscription = props.inscription

  const [disabled, setDisabled] = useState(true)

  const ordinalsTx = useOrdinalsTx()

  const [error, setError] = useState('')
  const createSplitTx = useCreateSplitTxCallback()

  const defaultOutputValue = props.inscription ? props.inscription.outputValue : 10000
  const { t } = useI18n()
  const account = useCurrentAccount()
  const minOutputValue = getAddressUtxoDust(account.address)
  const [outputValue, setOutputValue] = useState(defaultOutputValue)

  const { feeRate } = useFeeRateBar()

  const [inscriptions, setInscriptions] = useState<Inscription[]>([])

  const [splitedCount, setSplitedCount] = useState(0)
  const wallet = useWallet()
  useEffect(() => {
    wallet.getInscriptionUtxoDetail(props.inscription.inscriptionId).then(v => {
      setInscriptions(v.inscriptions)
    })
  }, [])

  useEffect(() => {
    setDisabled(true)
    setError('')
    setSplitedCount(0)

    if (feeRate <= 0) {
      setError(t('invalid_fee_rate'))
      return
    }

    if (!outputValue) {
      return
    }

    if (outputValue < minOutputValue) {
      setError(`${t('output_value_must_be_at_least')} ${minOutputValue}`)
      return
    }

    setDisabled(false)
  }, [feeRate, outputValue])

  const onClickBack = () => {
    nav.goBack()
  }

  const onOutputValueChange = (value: number) => {
    setOutputValue(value)
  }

  const onClickNext = () => {
    createSplitTx({ inscriptionId: inscription.inscriptionId, feeRate, outputValue })
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
    inscriptions,
    minOutputValue,
    splitedCount,
    error,
    disabled,
    onOutputValueChange,
    onClickBack,
    onClickNext,
  }
}
