import { renderHook } from '@testing-library/react'
import { DecodedPsbt, PsbtActionType, ToSignData } from '@unisat/wallet-shared'
import { describe, expect, it } from 'vitest'

import { useActionOverviewSectionLogic } from '../../src/ui-hooks/useActionOverviewSectionLogic'
import { createHookTestHarness } from './testHelpers'

describe('PSBT action overview', () => {
  it('does not claim a net receive from an output omitted by SINGLE|ANYONECANPAY', () => {
    const { store, wrapper } = createHookTestHarness()
    const address = store.getState().accounts.current?.address
    const decodedPsbt = {
      inputInfos: [
        { address, value: 1_000_000, sighashType: 0x83, inscriptions: [], runes: [], alkanes: [] },
        { address: 'attacker-input', value: 1_100_000, sighashType: 0x01, inscriptions: [], runes: [], alkanes: [] },
      ],
      outputInfos: [
        { address: 'attacker-output', value: 999_000, inscriptions: [], runes: [], alkanes: [] },
        { address, value: 1_050_000, inscriptions: [], runes: [], alkanes: [] },
      ],
      inscriptions: {},
    } as DecodedPsbt
    const toSignData = {
      psbtHex: '',
      toSignInputs: [{ index: 0, publicKey: '', sighashTypes: [0x83] }],
    } as ToSignData

    const { result } = renderHook(
      () =>
        useActionOverviewSectionLogic({
          action: { name: '', description: '', type: PsbtActionType.DEFAULT },
          decodedPsbt,
          toSignData,
        }),
      { wrapper }
    )

    expect(result.current.commonDetails.map(detail => detail.value)).toEqual(['1000000'])

    const allOutputsSigned = {
      ...decodedPsbt,
      inputInfos: [{ ...decodedPsbt.inputInfos[0], sighashType: 0x01 }, decodedPsbt.inputInfos[1]],
    }
    const { result: allResult } = renderHook(
      () =>
        useActionOverviewSectionLogic({
          action: { name: '', description: '', type: PsbtActionType.DEFAULT },
          decodedPsbt: allOutputsSigned,
          toSignData,
        }),
      { wrapper }
    )
    expect(allResult.current.commonDetails.map(detail => detail.value)).toEqual(['50000'])
  })
})
