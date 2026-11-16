import { RESTORE_WALLETS, RestoreWalletType, WordsType } from '@unisat/wallet-shared';
import { AddressType } from '@unisat/wallet-types';

import { TabType, UpdateContextDataParams } from './types';

export function getRestoreWalletConfig(restoreWalletType: RestoreWalletType) {
  const config = RESTORE_WALLETS.find((item) => item.value === restoreWalletType);
  if (!config) {
    throw new Error(`Unsupported restore wallet type: ${restoreWalletType}`);
  }
  return config;
}

export function getRestoreWalletSwitchState(
  restoreWalletType: RestoreWalletType,
  currentWordsType: WordsType
): UpdateContextDataParams {
  const config = getRestoreWalletConfig(restoreWalletType);
  const wordsType = config.wordsTypes.includes(currentWordsType)
    ? currentWordsType
    : (config.wordsTypes[0] ?? WordsType.WORDS_12);

  return {
    tabType: TabType.IMPORT_WORDS,
    restoreWalletType,
    wordsType,
    mnemonics: '',
    mnemonicVerified: false,
    passphrase: '',
    hdPath: '',
    customHdPath: '',
    isCustom: false,
    addressTypeIndex: 0,
    addressType: config.addressTypes[0] ?? AddressType.P2WPKH
  };
}

export function constrainRestoreDerivationParams({
  restoreWalletType,
  defaultHdPath,
  customHdPath,
  passphrase
}: {
  restoreWalletType: RestoreWalletType;
  defaultHdPath: string;
  customHdPath: string;
  passphrase: string;
}) {
  const config = getRestoreWalletConfig(restoreWalletType);
  // Security invariant: hidden inputs must never influence preview, scanning,
  // or the persisted keyring for a wallet type that does not support them.
  return {
    hdPath: config.customPathSupport && customHdPath ? customHdPath : defaultHdPath,
    passphrase: config.phraseSupport ? passphrase : ''
  };
}
