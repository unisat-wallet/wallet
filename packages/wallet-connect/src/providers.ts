import type { BtcBalance } from './types';

/**
 * UniSat wallet provider interface
 */
export interface UnisatWalletProvider {
  isApp?: boolean;
  isTokenPocket?: boolean;
  getAccounts(): Promise<string[]>;
  requestAccounts(): Promise<string[]>;
  getNetwork(): Promise<string>;
  switchNetwork(network: string): Promise<void>;
  getChain(): Promise<{ enum: string }>;
  switchChain(chain: string): Promise<void>;
  sendBitcoin(address: string, amount: number, options?: unknown): Promise<string>;
  on(event: string, listener: () => void): void;
  removeListener(event: string, listener: () => void): void;
  signMessage(message: string, type?: string): Promise<string>;
  signPsbt(psbt: string, opt: { autoFinalized: boolean; toSignInputs?: unknown[] }): Promise<string>;
  signPsbts(psbt: string[], opt: { autoFinalized: boolean; toSignInputs?: unknown[] }[]): Promise<string[]>;
  getPublicKey(): Promise<string>;
  getBalance(): Promise<BtcBalance>;
  inscribeTransfer(tick: string, amount?: number | string): Promise<{
    amount: string;
    inscriptionId: string;
    inscriptionNumber: number;
    ticker: string;
  }>;
  getInscriptions(num: number): Promise<void>;
  getVersion(): Promise<string>;
  pushPsbt(psbt: string): Promise<string>;
  /**
   * @experimental
   * Derive a deterministic 32-byte value bound to the connected leaf's public
   * key, using HKDF-SHA-256. Output rotates per-connected-leaf (different
   * receive address, account, or address type → different output). Requires
   * user approval. May change in future versions; integrators should
   * feature-detect.
   */
  deriveContextHash(appName: string, context: string): Promise<string>;
}

/**
 * OKX wallet provider interface
 */
export interface OkxWalletProvider {
  selectedAccount?: {
    address: string;
    publicKey: string;
    compressedPublicKey: string;
  };
  connect(): Promise<{ address: string; publicKey: string; compressedPublicKey: string }>;
  signMessage(message: string, opt: { from: string; type?: string }): Promise<string>;
  send(params: {
    from: string;
    to: string;
    value: string;
    satBytes?: string;
  }): Promise<string>;
  inscribe(params: { tick: string; from: string; type: 51 }): Promise<string>;
  signPsbt(hex: string, params: { autoFinalized?: boolean; toSignInputs?: unknown[] }): Promise<string>;
  on(event: string, listener: () => void): void;
  removeListener(event: string, listener: () => void): void;
  getPublicKey(): Promise<string>;
  getBalance(): Promise<BtcBalance>;
}

/**
 * Global window extensions for wallet providers
 */
declare global {
  interface Window {
    unisat?: UnisatWalletProvider;
    okxwallet?: {
      bitcoin: OkxWalletProvider;
      bitcoinTestnet: OkxWalletProvider;
      fractalBitcoin: OkxWalletProvider;
    };
    BitcoinProvider?: unknown;
  }
}

export {};
