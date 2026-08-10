import { RestoreWalletType, WordsType } from '@unisat/wallet-shared';
import { AddressType } from '@unisat/wallet-types';

export enum TabType {
  SET_PASSWORD = 'SET_PASSWORD',
  CREATE_WORDS = 'CREATE_WORDS',
  CONFIRM_WORDS = 'CONFIRM_WORDS',
  VERIFY_WORDS = 'VERIFY_WORDS',
  IMPORT_WORDS = 'IMPORT_WORDS',
  CHOOSE_ADDRESS_TYPE = 'CHOOSE_ADDRESS_TYPE',
  CHOOSE_RESTORE_WALLET = 'CHOOSE_RESTORE_WALLET',
  KEYSTONE_WALLET = 'KEYSTONE_WALLET',
  KEYSTONE_ADDRESS_TYPE = 'KEYSTONE_ADDRESS_TYPE'
}

export interface ContextData {
  mnemonics: string;
  hdPath: string;
  passphrase: string;
  walletName: string;
  addressType: AddressType;
  step1CreateWordsCompleted: boolean;
  mnemonicVerified: boolean;
  tabType: TabType;
  restoreWalletType: RestoreWalletType;
  isRestore: boolean;
  isCustom: boolean;
  customHdPath: string;
  addressTypeIndex: number;
  wordsType: WordsType;
}

export interface UpdateContextDataParams {
  mnemonics?: string;
  hdPath?: string;
  passphrase?: string;
  walletName?: string;
  addressType?: AddressType;
  step1CreateWordsCompleted?: boolean;
  mnemonicVerified?: boolean;
  tabType?: TabType;
  restoreWalletType?: RestoreWalletType;
  isCustom?: boolean;
  customHdPath?: string;
  addressTypeIndex?: number;
  wordsType?: WordsType;
}
