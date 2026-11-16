import { RestoreWalletType, WordsType } from '@unisat/wallet-shared'
import { AddressType } from '@unisat/wallet-types'
import { describe, expect, it } from 'vitest'

import {
  constrainRestoreDerivationParams,
  getRestoreWalletSwitchState,
} from '../../../../apps/extension/src/ui/pages/Account/createHDWalletComponents/restoreWalletPolicy'
import { TabType } from '../../../../apps/extension/src/ui/pages/Account/createHDWalletComponents/types'

describe('restore wallet derivation policy', () => {
  it.each([
    RestoreWalletType.MAGIC_EDEN,
    RestoreWalletType.XVERSE,
    RestoreWalletType.OW,
  ])(
    'clears hidden derivation state when switching to wallet type %s',
    restoreWalletType => {
      expect(
        getRestoreWalletSwitchState(restoreWalletType, WordsType.WORDS_24)
      ).toMatchObject({
        tabType: TabType.IMPORT_WORDS,
        restoreWalletType,
        mnemonics: '',
        mnemonicVerified: false,
        passphrase: '',
        hdPath: '',
        customHdPath: '',
        isCustom: false,
        addressTypeIndex: 0,
      })
    }
  )

  it.each([
    RestoreWalletType.MAGIC_EDEN,
    RestoreWalletType.XVERSE,
    RestoreWalletType.OW,
  ])(
    'ignores stale passphrase and custom path at the derivation sink for wallet type %s',
    restoreWalletType => {
      expect(
        constrainRestoreDerivationParams({
          restoreWalletType,
          defaultHdPath: "m/84'/0'/0'/0",
          customHdPath: "m/86'/0'/99'/0",
          passphrase: 'stale-secret',
        })
      ).toEqual({
        hdPath: "m/84'/0'/0'/0",
        passphrase: '',
      })
    }
  )

  it.each([
    RestoreWalletType.UNISAT,
    RestoreWalletType.SPARROW,
    RestoreWalletType.OTHERS,
  ])(
    'preserves supported derivation parameters for wallet type %s',
    restoreWalletType => {
      expect(
        constrainRestoreDerivationParams({
          restoreWalletType,
          defaultHdPath: "m/84'/0'/0'/0",
          customHdPath: "m/86'/0'/99'/0",
          passphrase: 'supported-secret',
        })
      ).toEqual({
        hdPath: "m/86'/0'/99'/0",
        passphrase: 'supported-secret',
      })
    }
  )

  it('resets the selected address type to the new wallet default', () => {
    expect(
      getRestoreWalletSwitchState(
        RestoreWalletType.MAGIC_EDEN,
        WordsType.WORDS_12
      ).addressType
    ).toBe(AddressType.P2WPKH)
  })
})
