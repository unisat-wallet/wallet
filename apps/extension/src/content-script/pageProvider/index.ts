// this script is injected into webpage's context
import { EventEmitter } from 'events';

import { BitcoinAPIMethods } from './bitcoinAPI';
import { CosmosAPIMethods } from './cosmosAPI';
import { initializeProvider, requestMethod } from './providerCore';
import { createProviderProxy, injectProviderToWindow } from './providerInjection';
import { _unisatProviderPrivate, requestMethodKey } from './providerState';
import PushEventHandlers from './pushEventHandlers';
import { Interceptor } from './types';
import { announceWebRgbProvider, WebRgbProvider } from './webRgb';

export { Interceptor };

export class UnisatProvider extends EventEmitter {
  private bitcoinAPI: BitcoinAPIMethods;
  public keplr: CosmosAPIMethods;
  /** Experimental, versioned-in-practice RGB dApp surface. */
  public rgb: {
    getAssets: (page?: number, pageSize?: number) => Promise<any>;
    getFundingUtxos: (assetId: string) => Promise<any>;
    getFeeUtxos: () => Promise<any>;
    getIssueAvailability: () => Promise<any>;
    issueNia: (params: { orderId: string; ticker: string; name: string; precision: number; amount: string; paymentTxid?: string }) => Promise<any>;
    createReceiveInvoice: (params: { assetId?: string; amount?: string; durationSeconds?: number; recipientType?: 'blind' | 'witness'; minConfirmations?: number }) => Promise<any>;
    getPendingReceives: () => Promise<any>;
    acceptReceive: (recipientId: string) => Promise<any>;
    rejectReceive: (recipientId: string) => Promise<any>;
    preparePayment: (params: { invoice: string; assetId: string; amount?: string | number; feeRate?: number }) => Promise<any>;
    signPayment: (transferId: string) => Promise<any>;
    cancelPayment: (transferId: string) => Promise<any>;
    getPaymentStatus: (transferId: string) => Promise<any>;
    signBuySwapAndAcceptConsignment: (params: { recipientId: string; assetId: string; amount: string; maxBtcSpend: string; makerSignedPsbt: string }) => Promise<any>;
    prepareSwap: (params: { invoice: string; assetId: string; amount: string; btcReceiveAmount: string; feeRate?: number; psbt: string }) => Promise<any>;
    signSellSwapAndPublishConsignment: (transferId: string, makerSignedPsbt: string) => Promise<any>;
    confirmSellSwap: (transferId: string, signedPsbt: string) => Promise<any>;
    applySellSwapAbort: (transferId: string) => Promise<any>;
    applyBuySwapAbort: (recipientId: string) => Promise<any>;
    cancelSwap: (transferId: string) => Promise<any>;
    getOperationStatus: (transferId: string) => Promise<any>;
  };

  constructor({ maxListeners = 100 } = {}) {
    super();
    this.setMaxListeners(maxListeners);

    // Initialize API modules
    this.bitcoinAPI = new BitcoinAPIMethods(this);
    this.keplr = new CosmosAPIMethods(this);
    this.rgb = {
      getAssets: (page, pageSize) => this.bitcoinAPI.getRgbAssets(page, pageSize),
      getFundingUtxos: assetId => this.bitcoinAPI.getRgbFundingUtxos(assetId),
      getFeeUtxos: () => this.bitcoinAPI.getRgbFeeUtxos(),
      getIssueAvailability: () => this.bitcoinAPI.getRgbIssueAvailability(),
      issueNia: params => this.bitcoinAPI.issueRgbNia(params),
      createReceiveInvoice: params => this.bitcoinAPI.createRgbReceiveInvoice(params),
      getPendingReceives: () => this.bitcoinAPI.getRgbPendingReceives(),
      acceptReceive: recipientId => this.bitcoinAPI.acceptRgbReceive(recipientId),
      rejectReceive: recipientId => this.bitcoinAPI.rejectRgbReceive(recipientId),
      preparePayment: params => this.bitcoinAPI.prepareRgbPayment(params),
      signPayment: transferId => this.bitcoinAPI.signRgbPayment(transferId),
      cancelPayment: transferId => this.bitcoinAPI.cancelRgbPayment(transferId),
      getPaymentStatus: transferId => this.bitcoinAPI.getRgbPaymentStatus(transferId),
      signBuySwapAndAcceptConsignment: params => this.bitcoinAPI.signRgbBuySwapAndAcceptConsignment(params),
      prepareSwap: params => this.bitcoinAPI.prepareRgbSwap(params),
      signSellSwapAndPublishConsignment: (transferId, makerSignedPsbt) => this.bitcoinAPI.signRgbSellSwapAndPublishConsignment(transferId, makerSignedPsbt),
      confirmSellSwap: (transferId, signedPsbt) => this.bitcoinAPI.confirmRgbSellSwap(transferId, signedPsbt),
      applySellSwapAbort: transferId => this.bitcoinAPI.applyRgbSellSwapAbort(transferId),
      applyBuySwapAbort: recipientId => this.bitcoinAPI.applyRgbBuySwapAbort(recipientId),
      cancelSwap: transferId => this.bitcoinAPI.cancelRgbSwap(transferId),
      getOperationStatus: transferId => this.bitcoinAPI.getRgbSwapStatus(transferId),
    };

    // Setup push event handlers
    _unisatProviderPrivate._pushEventHandlers = new PushEventHandlers(this, _unisatProviderPrivate);

    // Initialize provider
    this.initialize();
  }

  private initialize = async () => {
    await initializeProvider(this);
  };

  // Implement truly private request method using Symbol
  private [requestMethodKey] = async (data) => {
    return requestMethod(data);
  };

  // Bitcoin API methods - delegate to BitcoinAPIMethods
  requestAccounts = async () => this.bitcoinAPI.requestAccounts();
  disconnect = async () => this.bitcoinAPI.disconnect();
  getNetwork = async () => this.bitcoinAPI.getNetwork();
  switchNetwork = async (network: string) => this.bitcoinAPI.switchNetwork(network);
  getChain = async () => this.bitcoinAPI.getChain();
  switchChain = async (chain: string) => this.bitcoinAPI.switchChain(chain);
  getAccounts = async () => this.bitcoinAPI.getAccounts();
  getPublicKey = async () => this.bitcoinAPI.getPublicKey();
  getBalance = async () => this.bitcoinAPI.getBalance();
  getBalanceV2 = async () => this.bitcoinAPI.getBalanceV2();
  getInscriptions = async (cursor = 0, size = 20) => this.bitcoinAPI.getInscriptions(cursor, size);
  signMessage = async (text: string, type: string) => this.bitcoinAPI.signMessage(text, type);
  multiSignMessage = async (messages: { text: string; type: string }[]) => this.bitcoinAPI.multiSignMessage(messages);
  verifyMessageOfBIP322Simple = async (address: string, message: string, signature: string, network?: number) =>
    this.bitcoinAPI.verifyMessageOfBIP322Simple(address, message, signature, network);
  sendBitcoin = async (
    toAddress: string,
    satoshis: number,
    options?: { feeRate: number; memo?: string; memos?: string[] }
  ) => this.bitcoinAPI.sendBitcoin(toAddress, satoshis, options);
  sendInscription = async (toAddress: string, inscriptionId: string, options?: { feeRate: number }) =>
    this.bitcoinAPI.sendInscription(toAddress, inscriptionId, options);
  sendRunes = async (toAddress: string, runeid: string, amount: string, options?: { feeRate: number }) =>
    this.bitcoinAPI.sendRunes(toAddress, runeid, amount, options);
  pushTx = async (rawtx: string) => this.bitcoinAPI.pushTx(rawtx);
  signPsbt = async (psbtHex: string, options?: any) => this.bitcoinAPI.signPsbt(psbtHex, options);
  signPsbts = async (psbtHexs: string[], options?: any[]) => this.bitcoinAPI.signPsbts(psbtHexs, options);
  pushPsbt = async (psbtHex: string) => this.bitcoinAPI.pushPsbt(psbtHex);
  inscribeTransfer = async (ticker: string, amount: string) => this.bitcoinAPI.inscribeTransfer(ticker, amount);
  getVersion = async () => this.bitcoinAPI.getVersion();
  deriveContextHash = async (appName: string, context: string) => this.bitcoinAPI.deriveContextHash(appName, context);
  getBitcoinUtxos = async (cursor = 0, size = 20) => this.bitcoinAPI.getBitcoinUtxos(cursor, size);
}

declare global {
  interface Window {
    unisat: UnisatProvider;
  }
}

// Create and inject provider
const provider = new UnisatProvider();
const providerProxy = createProviderProxy(provider, requestMethodKey);
injectProviderToWindow(providerProxy);
announceWebRgbProvider(new WebRgbProvider((method, params) => provider[requestMethodKey]({ method, params })));
