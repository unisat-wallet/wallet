import {
  DecodedPsbt,
  Inscription,
  PsbtActionDetailType,
  PsbtActionInfo,
  PsbtActionType,
} from '@unisat/wallet-shared'
import { useMemo } from 'react'
import { useI18n } from 'src/context'
import { useChain, useCurrentAddress } from 'src/hooks'

export interface ActionOverviewSectionProps {
  action: PsbtActionInfo
  decodedPsbt: DecodedPsbt
}

export function useActionOverviewSectionLogic({ action, decodedPsbt }: ActionOverviewSectionProps) {
  const { t } = useI18n()

  const chain = useChain()

  const currentAddress = useCurrentAddress()

  const spendSatoshis = useMemo(() => {
    const inValue = decodedPsbt.inputInfos
      .filter(v => v.address === currentAddress)
      .reduce((pre, cur) => cur.value + pre, 0)
    const outValue = decodedPsbt.outputInfos
      .filter(v => v.address === currentAddress)
      .reduce((pre, cur) => cur.value + pre, 0)
    const spend = inValue - outValue
    return spend
  }, [decodedPsbt, currentAddress])

  const spendingInscriptionCount = useMemo(() => {
    let count = 0
    decodedPsbt.inputInfos.forEach(inputInfo => {
      if (inputInfo.address === currentAddress) {
        inputInfo.inscriptions.forEach(inscription => {
          const inscriptionInfo: Inscription = decodedPsbt.inscriptions[inscription.inscriptionId]
          if (inscriptionInfo.brc20 && inscriptionInfo.brc20.op === 'transfer') {
            // skip brc20
          } else {
            count++
          }
        })
      }
    })
    return count
  }, [decodedPsbt, currentAddress])

  const spendingBrc20Count = useMemo(() => {
    let count = 0
    decodedPsbt.inputInfos.forEach(inputInfo => {
      if (inputInfo.address === currentAddress) {
        inputInfo.inscriptions.forEach(inscription => {
          const inscriptionInfo: Inscription = decodedPsbt.inscriptions[inscription.inscriptionId]
          if (inscriptionInfo.brc20 && inscriptionInfo.brc20.op === 'transfer') {
            count++
          }
        })
      }
    })
    return count
  }, [decodedPsbt, currentAddress])

  const spendingRunesCount = useMemo(() => {
    const runeMap: { [key: string]: string } = {}
    decodedPsbt.inputInfos.forEach(inputInfo => {
      if (inputInfo.address === currentAddress) {
        inputInfo.runes.forEach(rune => {
          runeMap[rune.runeid] = rune.runeid
        })
      }
    })
    return Object.keys(runeMap).length
  }, [decodedPsbt, currentAddress])

  const spendingAlkanesCount = useMemo(() => {
    const alkaneMap: { [key: string]: string } = {}
    decodedPsbt.inputInfos.forEach(inputInfo => {
      if (inputInfo.address === currentAddress) {
        inputInfo.alkanes.forEach(alkane => {
          alkaneMap[alkane.alkaneid] = alkane.alkaneid
        })
      }
    })
    return Object.keys(alkaneMap).length
  }, [decodedPsbt, currentAddress])

  if (!action) {
    action = {
      name: '',
      description: '',
      type: PsbtActionType.DEFAULT,
    }
  }

  if (action.details?.length === 0) {
    action.details = []
  }

  if (action.type === PsbtActionType.DEFAULT) {
    action.name = t('sign_transaction')
    action.description = ''
    action.details = []

    if (
      spendingInscriptionCount > 0 ||
      spendingBrc20Count > 0 ||
      spendingAlkanesCount > 0 ||
      spendingRunesCount > 0
    ) {
      action.details.push({
        type: PsbtActionDetailType.MULTIASSETS,
        label: t('spending_assets'),
        value: {
          inscriptionCount: spendingInscriptionCount,
          brc20Count: spendingBrc20Count,
          runesCount: spendingRunesCount,
          alkanesCount: spendingAlkanesCount,
        },
      })
    }
  }

  const commonDetails: any[] = []
  if (spendSatoshis > 0) {
    commonDetails.push({
      type: PsbtActionDetailType.SATOSHIS,
      label: t('spending_amount'),
      value: `${spendSatoshis}`,
    })
  }

  if (spendSatoshis < 0) {
    commonDetails.push({
      type: PsbtActionDetailType.SATOSHIS,
      label: t('receive'),
      value: `${-spendSatoshis}`,
    })
  }

  return {
    decodedPsbt,
    action,
    commonDetails,
    chain,
  }
}
