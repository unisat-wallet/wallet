import type {
  Account,
  BtcBalance,
  ToSignInput,
  WalletConfig,
  WalletTranslator,
  WalletNotifier,
  WalletListenerParams,
  ChainType,
} from '../types';
import { ALL_CHAIN_TYPES, getChainFlags } from '../types';
import { getBitcoinAddressNetwork } from '../utils';

/**
 * Abstract base class for wallet implementations
 * Extend this class to add support for new wallet types
 */
export abstract class BaseWallet {
  /** Whether the wallet extension is installed */
  installed = false;

  /** Optional translator for i18n */
  protected translator?: WalletTranslator;

  /** Optional notifier for UI feedback */
  protected notifier?: WalletNotifier;

  /** Current chain type */
  protected chainType?: ChainType;

  /** Wallet configuration */
  abstract readonly config: WalletConfig;

  /**
   * Initialize the wallet - check if extension is installed
   */
  abstract init(): Promise<void>;

  /**
   * Set translator for i18n support
   */
  setTranslator(translator: WalletTranslator): void {
    this.translator = translator;
  }

  /**
   * Set notifier for UI feedback
   */
  setNotifier(notifier: WalletNotifier): void {
    this.notifier = notifier;
  }

  /**
   * Set current chain type
   */
  setChainType(chainType: ChainType): void {
    if (!(ALL_CHAIN_TYPES as readonly unknown[]).includes(chainType)) {
      throw new Error(this.t('networkNotSupported', `${String(chainType)} not supported`, {
        chain: chainType,
      }));
    }
    if (!this.config.supportChain.includes(chainType)) {
      throw new Error(this.t('networkNotSupported', `${chainType} not supported`, {
        chain: chainType,
      }));
    }
    this.chainType = chainType;
  }

  /** Reject provider accounts whose address encoding belongs to another network. */
  protected assertAccountNetwork(account: Account): Account {
    if (!this.chainType) {
      throw new Error(this.t('chainTypeNotSet', 'Chain type not set'));
    }

    const flags = getChainFlags(this.chainType);
    const network = flags.isBitcoinMainnet || flags.isFractalMainnet ? 'mainnet' : 'testnet';
    const addresses = [account.address, account.paymentAccount?.address].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );

    if (!addresses.length || addresses.some(value => getBitcoinAddressNetwork(value) !== network)) {
      throw new Error(
        this.t('accountNetworkMismatch', `Account does not belong to ${this.chainType}`, {
          chain: this.chainType,
        })
      );
    }

    return account;
  }

  /**
   * Translate a message with optional fallback
   */
  protected t(key: string, fallback: string, values?: Record<string, unknown>): string {
    if (this.translator) {
      return this.translator(key, values);
    }
    return fallback;
  }

  /**
   * Show a warning notification
   */
  protected showNotInstalledWarning(): void {
    if (!this.notifier) return;

    const key = `open${Date.now()}`;
    this.notifier.warning({
      message: this.t('notInstalled', `${this.config.name} not installed`, {
        wallet: this.config.name,
      }),
      description: this.t(
        'visitProductPage',
        'Please click here to visit the product page. After installing the extension, please refresh the page.'
      ),
      key,
      onClick: () => {
        this.notifier?.destroy(key);
        if (this.config.downloadUrl) {
          window.open(this.config.downloadUrl, '_blank');
        }
      },
    });
  }

  /**
   * Request account connection from wallet
   */
  abstract requestAccount(): Promise<Account | undefined>;

  /**
   * Get currently connected account
   */
  abstract getAccount(): Promise<Account | undefined>;

  /**
   * Add event listeners for account/network changes
   */
  abstract addListener(params: WalletListenerParams): void;

  /**
   * Remove event listeners
   */
  abstract removeListener(params: WalletListenerParams): void;

  /**
   * Get wallet balance
   */
  abstract getBalance(): Promise<BtcBalance>;

  /**
   * Sign a single PSBT
   */
  abstract signPsbt(psbt: string, opt?: { toSignInputs?: ToSignInput[] }): Promise<string>;

  /**
   * Sign multiple PSBTs
   */
  abstract signPsbts(params: { psbt: string; toSignInputs?: ToSignInput[] }[]): Promise<string[]>;

  /**
   * Sign a message
   * @param message Message to sign
   * @param type Signature type ('ecdsa' | 'bip322-simple')
   */
  abstract signMessage(message: string, type?: string): Promise<string>;

  /**
   * Disconnect from wallet
   */
  abstract disconnect(): void;
}
