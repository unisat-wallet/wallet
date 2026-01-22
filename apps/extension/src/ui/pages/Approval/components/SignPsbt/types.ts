import {
  AlkanesBalance,
  ContractResult,
  DecodedPsbt,
  Inscription,
  RuneBalance,
  ToSignInput
} from '@unisat/wallet-shared';

export interface InputInfo {
  txid: string;
  vout: number;
  address: string;
  value: number;
  inscriptions: Inscription[];
  runes: RuneBalance[];
  alkanes: AlkanesBalance[];
}

export interface OutputInfo {
  address: string;
  value: number;
}

export enum TabState {
  DETAILS,
  DATA,
  HEX
}

export interface InscriptioinInfo {
  id: string;
  isSent: boolean;
}

export interface TxInfo {
  changedBalance: number;
  changedInscriptions: InscriptioinInfo[];
  rawtx: string;
  psbtHex: string;
  toSignInputs: ToSignInput[];
  txError: string;
  decodedPsbt: DecodedPsbt;
  contractResults: ContractResult[];
}
