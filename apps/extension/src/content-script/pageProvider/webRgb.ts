/** WebRGB v1 adapter over the wallet's existing, origin-bound RGB RPCs. */
import { ErrorCodes } from '@unisat/wallet-shared';

type WebRgbCode = 'USER_REJECTED' | 'NOT_ENABLED' | 'METHOD_NOT_SUPPORTED' | 'INVALID_PARAMS' | 'ASSET_NOT_FOUND' | 'INTERNAL_ERROR';
type RgbEvent = 'transferReceived' | 'transferSettled';
type RgbTransfer = Record<string, any>;
type RgbBurnRecipient = { chainId: string; address: string };
type RgbBurnAssetArgs = {
  network: string;
  assetId: string;
  amount: string;
  burnRecipient: RgbBurnRecipient;
  feeRate?: number;
  minConfirmations?: number;
};

export type WebRgbProxyProfile = {
  id: string;
  name: string;
  endpoint: string;
  protocolVersion?: string;
  serverVersion?: string;
  recommended: boolean;
};

export type WebRgbInfo = {
  ready: boolean;
  network: string;
  protocol: string | null;
  methods: string[];
  burnRecipientNamespaces?: string[];
  proxyProfiles?: WebRgbProxyProfile[];
  defaultProxyId?: string;
};

const MAX_U64_DECIMAL = '18446744073709551615';

function isPositiveU64Decimal(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value) &&
    (value.length < MAX_U64_DECIMAL.length ||
      (value.length === MAX_U64_DECIMAL.length && value <= MAX_U64_DECIMAL));
}

function providerError(code: WebRgbCode, message: string): Error & { code: WebRgbCode } {
  return Object.assign(new Error(message), { code });
}

function normalizeError(error: unknown): Error & { code: WebRgbCode } {
  const value = error as {
    code?: string | number;
    message?: string;
  } | null;
  const code = value?.code;
  const message = value?.message || String(error);
  if (code === 'NOT_ENABLED' || code === 'METHOD_NOT_SUPPORTED' || code === 'INVALID_PARAMS' ||
      code === 'ASSET_NOT_FOUND' || code === 'USER_REJECTED') return providerError(code, message);
  if (code === ErrorCodes.UNAUTHORIZED || code === ErrorCodes.RGB_NOT_ENABLED)
    return providerError('NOT_ENABLED', message);
  if (code === ErrorCodes.INVALID_PARAMS) return providerError('INVALID_PARAMS', message);
  if (code === ErrorCodes.RGB_ASSET_NOT_FOUND) return providerError('ASSET_NOT_FOUND', message);
  if (code === 4001 || code === '4001' ||
      /user (?:rejected|cancelled|canceled)|connection was not approved|approval.*(?:rejected|cancelled|canceled)/i.test(message))
    return providerError('USER_REJECTED', message);
  if (/not found|unknown asset/i.test(message)) return providerError('ASSET_NOT_FOUND', message);
  if (/invalid|must be|required|mismatch|does not match/i.test(message)) return providerError('INVALID_PARAMS', message);
  return providerError('INTERNAL_ERROR', message);
}

function unsupported(method: string): never {
  throw providerError('METHOD_NOT_SUPPORTED', `WebRGB ${method} is not supported by this wallet`);
}

function transferStatus(status: unknown): string {
  switch (status) {
    case 'settled': case 'confirmed': return 'Settled';
    case 'failed': case 'rejected': case 'canceled': case 'broadcast_failed': return 'Failed';
    case 'confirming': case 'broadcasted': case 'waiting_receive': return 'WaitingConfirmations';
    case 'waiting_batch_release': return 'WaitingCounterparty';
    default: return 'WaitingCounterparty';
  }
}

function transferKey(item: RgbTransfer): string {
  return String(item.transferId || item.recipientId || item.txid || item.id);
}

function transferAmount(value: unknown): number {
  if ((typeof value === 'string' && !/^\d+$/.test(value)) ||
      (typeof value !== 'string' && typeof value !== 'number'))
    throw providerError('INTERNAL_ERROR', 'RGB transfer amount is not a safe integer');
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw providerError('INTERNAL_ERROR', 'RGB transfer amount is not a safe integer');
  return amount;
}

export class WebRgbProvider {
  #connected = false;
  #capabilities?: Set<string>;
  readonly #listeners = new Map<RgbEvent, Set<(transfer: RgbTransfer) => void>>();
  #polling?: ReturnType<typeof setInterval>;
  #knownTransfers?: Map<string, RgbTransfer>;
  readonly #rpc: (method: string, params?: Record<string, unknown>) => Promise<any>;

  constructor(rpc: (method: string, params?: Record<string, unknown>) => Promise<any>) {
    this.#rpc = rpc;
  }

  get enabled() { return this.#connected; }

  async #call(method: string, params?: Record<string, unknown>) {
    try { return await this.#rpc(method, params); }
    catch (error) { throw normalizeError(error); }
  }

  async #requireEnabled(): Promise<WebRgbInfo> {
    if (!this.#connected) throw providerError('NOT_ENABLED', 'Call enable() before using WebRGB');
    try {
      const info = await this.#call('webRgbGetInfo');
      this.#capabilities = new Set(info.methods || []);
      return info as WebRgbInfo;
    } catch (error) {
      if ((error as { code?: WebRgbCode }).code === 'NOT_ENABLED') {
        this.#connected = false;
        this.#stopPolling();
      }
      throw error;
    }
  }

  enable = async (): Promise<void> => {
    await this.#call('webRgbEnable');
    this.#connected = true;
    const info = await this.#call('webRgbGetInfo');
    this.#capabilities = new Set(info.methods || []);
  };

  getInfo = async (): Promise<WebRgbInfo> => {
    return this.#requireEnabled();
  };

  async #requireCapability(method: string) {
    const info = await this.#requireEnabled();
    if (!info.methods?.includes(method)) unsupported(method);
    return info;
  }

  getAddress = async () => {
    await this.#requireCapability('getAddress');
    return this.#call('webRgbGetAddress');
  };

  #receive = async (kind: 'blind' | 'witness', args: {
    assetId?: string; amount?: number; durationSeconds?: number; minConfirmations?: number;
    proxyId?: string;
  } = {}) => {
    await this.#requireCapability(kind === 'blind' ? 'blindReceive' : 'witnessReceive');
    if (!args || typeof args !== 'object' || Array.isArray(args))
      throw providerError('INVALID_PARAMS', 'receive arguments must be an object');
    if (args.assetId !== undefined) {
      if (typeof args.assetId !== 'string' || !args.assetId) throw providerError('INVALID_PARAMS', 'assetId must be a nonempty string');
      await this.getAssetBalance(args.assetId);
    }
    if (args.amount !== undefined && (!Number.isSafeInteger(args.amount) || args.amount <= 0 || !args.assetId))
      throw providerError('INVALID_PARAMS', 'amount requires a known assetId and a positive safe integer');
    if (args.durationSeconds !== undefined && (!Number.isSafeInteger(args.durationSeconds) || args.durationSeconds <= 0))
      throw providerError('INVALID_PARAMS', 'durationSeconds must be a positive integer');
    if (args.minConfirmations !== undefined && (!Number.isSafeInteger(args.minConfirmations) || args.minConfirmations < 0))
      throw providerError('INVALID_PARAMS', 'minConfirmations must be a nonnegative integer');
    if (args.proxyId !== undefined &&
        (typeof args.proxyId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(args.proxyId)))
      throw providerError('INVALID_PARAMS', 'proxyId is invalid');
    const result = await this.#call('createRgbReceiveInvoice', {
      ...(args.assetId ? { assetId: args.assetId } : {}),
      ...(args.amount === undefined ? {} : { amount: String(args.amount) }),
      ...(args.durationSeconds === undefined ? {} : { durationSeconds: args.durationSeconds }),
      ...(args.proxyId === undefined ? {} : { proxyId: args.proxyId }),
      recipientType: kind,
      minConfirmations: Math.max(3, args.minConfirmations || 0)
    });
    return {
      invoice: result.invoice,
      recipientId: result.recipientId,
      expirationTimestamp: result.expirationTimestamp,
      minConfirmations: result.minConfirmations || Math.max(3, args.minConfirmations || 0)
    };
  };

  blindReceive = (args?: { assetId?: string; amount?: number; durationSeconds?: number; minConfirmations?: number; proxyId?: string }) =>
    this.#receive('blind', args);

  witnessReceive = (args?: { assetId?: string; amount?: number; durationSeconds?: number; minConfirmations?: number; proxyId?: string }) =>
    this.#receive('witness', args);

  listAssets = async () => {
    await this.#requireCapability('listAssets');
    return this.#call('webRgbListAssets');
  };

  getAssetBalance = async (assetId: string) => {
    await this.#requireCapability('getAssetBalance');
    if (typeof assetId !== 'string' || !assetId) throw providerError('INVALID_PARAMS', 'assetId is required');
    return this.#call('webRgbGetAssetBalance', { assetId });
  };

  decodeRgbInvoice = async (args: { invoice: string } | string) => {
    await this.#requireCapability('decodeRgbInvoice');
    const invoice = typeof args === 'string' ? args : args?.invoice;
    if (typeof invoice !== 'string' || !invoice.trim()) throw providerError('INVALID_PARAMS', 'invoice is required');
    return this.#call('webRgbDecodeInvoice', { invoice });
  };

  sendAsset = async (args: {
    invoice?: string; assetId?: string; amount?: number; recipientId?: string;
    feeRate?: number; transportEndpoints?: string[];
  }) => {
    await this.#requireCapability('sendAsset');
    if (!args || typeof args !== 'object') throw providerError('INVALID_PARAMS', 'sendAsset arguments are required');
    let invoice = args.invoice;
    if (!invoice) {
      if (typeof args.assetId !== 'string' || !args.assetId ||
          typeof args.recipientId !== 'string' || !args.recipientId ||
          !Number.isSafeInteger(args.amount) || Number(args.amount) <= 0)
        throw providerError('INVALID_PARAMS', 'assetId, amount and recipientId are required');
      ({ invoice } = await this.#call('webRgbBuildInvoice', {
        assetId: args.assetId, amount: args.amount, recipientId: args.recipientId,
        ...(args.transportEndpoints ? { transportEndpoints: args.transportEndpoints } : {})
      }));
    }
    const decoded = await this.decodeRgbInvoice(invoice!);
    if (decoded.amount === null && args.amount === undefined)
      throw providerError('INVALID_PARAMS', 'An any-amount invoice requires an explicit amount');
    let assetId = decoded.assetId || args.assetId;
    if (!assetId) {
      const assets = await this.listAssets();
      if (assets.length === 1) assetId = assets[0].assetId || assets[0].id;
    }
    if (!assetId) throw providerError('INVALID_PARAMS', 'An any-asset invoice requires an assetId');
    if (args.assetId && decoded.assetId && args.assetId !== decoded.assetId)
      throw providerError('INVALID_PARAMS', 'assetId does not match invoice');
    const amount = args.amount === undefined ? decoded.amount : args.amount;
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw providerError('INVALID_PARAMS', 'amount must be a positive safe integer');
    if (decoded.amount !== null && decoded.amount !== amount)
      throw providerError('INVALID_PARAMS', 'amount does not match invoice');
    const prepared = await this.#call('prepareRgbPayment', {
      invoice, assetId, amount: String(amount),
      ...(args.feeRate === undefined ? {} : { feeRate: args.feeRate })
    });
    const transferId = prepared.id || prepared.transferId;
    if (!transferId) throw providerError('INTERNAL_ERROR', 'RGB transfer ID is missing');
    let result: any;
    try {
      result = await this.#call('signRgbPayment', { transferId });
    } catch (error) {
      if ((error as { code?: string }).code === 'USER_REJECTED') {
        try { await this.#call('webRgbReleasePreparedPayment', { transferId }); } catch { /* Preserve the approval result. */ }
      }
      throw error;
    }
    return {
      ...result,
      transferId,
      assetId,
      amount,
      recipientId: decoded.recipientId,
      status: transferStatus(result.status),
    };
  };

  listTransfers = async (assetId?: string): Promise<RgbTransfer[]> => {
    await this.#requireCapability('listTransfers');
    if (assetId !== undefined && (typeof assetId !== 'string' || !assetId))
      throw providerError('INVALID_PARAMS', 'assetId must be a nonempty string');
    const transfers: RgbTransfer[] = await this.#call('webRgbListTransfers', assetId ? { assetId } : {});
    return transfers.map(item => ({ ...item, status: transferStatus(item.status),
      ...(item.amount === undefined || item.amount === null ? {} : { amount: transferAmount(item.amount) }) }));
  };

  getTransferStatus = async (transferId: string | number, assetId?: string) => {
    await this.#requireCapability('getTransferStatus');
    if ((typeof transferId !== 'string' && typeof transferId !== 'number') || !String(transferId))
      throw providerError('INVALID_PARAMS', 'transferId is required');
    const result = await this.#call('webRgbGetTransferStatus', { transferId: String(transferId), ...(assetId ? { assetId } : {}) });
    if (!result.found) return { found: false, status: null, transfer: null };
    const transfer = { ...result.transfer, status: transferStatus(result.transfer.status) };
    return { found: true, status: transfer.status, transfer };
  };

  issueAsset = async () => { await this.#requireEnabled(); unsupported('issueAsset'); };

  burnAsset = async (args: RgbBurnAssetArgs) => {
    const info = await this.#requireCapability('burnAsset');
    if (!args || typeof args !== 'object' || Array.isArray(args))
      throw providerError('INVALID_PARAMS', 'burnAsset arguments are required');
    if (typeof args.network !== 'string' || !args.network)
      throw providerError('INVALID_PARAMS', 'network is required');
    if (args.network !== info.network)
      throw providerError('INVALID_PARAMS', 'network does not match the current RGB wallet');
    if (typeof args.assetId !== 'string' || !args.assetId)
      throw providerError('INVALID_PARAMS', 'assetId is required');
    if (!isPositiveU64Decimal(args.amount))
      throw providerError('INVALID_PARAMS', 'amount must be a positive u64 decimal string');
    if (!args.burnRecipient || typeof args.burnRecipient !== 'object' || Array.isArray(args.burnRecipient) ||
        typeof args.burnRecipient.chainId !== 'string' || !args.burnRecipient.chainId ||
        typeof args.burnRecipient.address !== 'string' || !args.burnRecipient.address.trim())
      throw providerError('INVALID_PARAMS', 'burnRecipient.chainId and burnRecipient.address are required');
    const namespace = args.burnRecipient.chainId.split(':', 1)[0];
    const supportedNamespaces = info.burnRecipientNamespaces || ['eip155'];
    if (!supportedNamespaces.includes(namespace))
      throw providerError('INVALID_PARAMS', 'burnRecipient namespace is not supported');
    if (args.minConfirmations !== undefined &&
        (!Number.isSafeInteger(args.minConfirmations) || args.minConfirmations < 0))
      throw providerError('INVALID_PARAMS', 'minConfirmations must be a nonnegative integer');

    let prepared = await this.#call('webRgbPrepareBurn', args as unknown as Record<string, unknown>);
    let transferId = prepared.id || prepared.transferId;
    if (!transferId) throw providerError('INTERNAL_ERROR', 'RGB burn transfer ID is missing');
    let result: any;
    try {
      result = await this.#call('signRgbPayment', { transferId });
      if (result?.status === 'burn_split_complete') {
        prepared = await this.#call('webRgbPrepareBurn', args as unknown as Record<string, unknown>);
        transferId = prepared.id || prepared.transferId;
        if (!transferId) throw providerError('INTERNAL_ERROR', 'RGB burn transfer ID is missing after allocation split');
        result = await this.#call('signRgbPayment', { transferId });
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'USER_REJECTED') {
        try { await this.#call('webRgbReleasePreparedPayment', { transferId }); } catch { /* Preserve the approval result. */ }
      }
      throw error;
    }
    return {
      ...result,
      transferId,
      txid: result.txid,
      assetId: args.assetId,
      amount: args.amount,
      burnRecipient: args.burnRecipient,
      status: result.status ? transferStatus(result.status) : 'WaitingConfirmations',
      minConfirmations: prepared.minConfirmations || Math.max(3, args.minConfirmations || 0),
    };
  };

  getConsignment = async (args: { assetId: string; txid: string }) => {
    await this.#requireCapability('getConsignment');
    if (!args || typeof args !== 'object' || Array.isArray(args))
      throw providerError('INVALID_PARAMS', 'getConsignment arguments are required');
    if (typeof args.assetId !== 'string' || !args.assetId)
      throw providerError('INVALID_PARAMS', 'assetId is required');
    if (typeof args.txid !== 'string' || !/^[0-9a-f]{64}$/i.test(args.txid))
      throw providerError('INVALID_PARAMS', 'txid must be 64 hexadecimal characters');
    return this.#call('webRgbGetConsignment', { assetId: args.assetId, txid: args.txid.toLowerCase() });
  };
  signMessage = async () => { await this.#requireEnabled(); unsupported('signMessage'); };
  makeLnInvoice = async () => { await this.#requireEnabled(); unsupported('makeLnInvoice'); };
  payLnInvoice = async () => { await this.#requireEnabled(); unsupported('payLnInvoice'); };

  on = (event: RgbEvent, listener: (transfer: RgbTransfer) => void) => {
    if (!this.#connected) throw providerError('NOT_ENABLED', 'Call enable() before subscribing to WebRGB events');
    if (!this.#capabilities?.has('on')) unsupported('on');
    if (event !== 'transferReceived' && event !== 'transferSettled')
      throw providerError('INVALID_PARAMS', 'Unknown WebRGB event');
    if (typeof listener !== 'function') throw providerError('INVALID_PARAMS', 'listener must be a function');
    const group = this.#listeners.get(event) || new Set();
    group.add(listener);
    this.#listeners.set(event, group);
    if (!this.#polling) {
      void this.#pollTransfers();
      this.#polling = setInterval(() => { void this.#pollTransfers(); }, 15000);
    }
  };

  off = (event: RgbEvent, listener: (transfer: RgbTransfer) => void) => {
    if (!this.#connected) throw providerError('NOT_ENABLED', 'Call enable() before using WebRGB events');
    if (!this.#capabilities?.has('off')) unsupported('off');
    this.#listeners.get(event)?.delete(listener);
    if (![...this.#listeners.values()].some(group => group.size)) this.#stopPolling();
  };

  #stopPolling() {
    if (this.#polling) clearInterval(this.#polling);
    this.#polling = undefined;
    this.#knownTransfers = undefined;
  }

  async #pollTransfers() {
    try {
      const transfers = await this.listTransfers();
      const current = new Map(transfers.map(item => [transferKey(item), item]));
      if (this.#knownTransfers) {
        for (const [key, item] of current) {
          const previous = this.#knownTransfers.get(key);
          if (!previous && item.type === 'receive')
            this.#listeners.get('transferReceived')?.forEach(listener => listener(item));
          if (item.status === 'Settled' && previous?.status !== 'Settled')
            this.#listeners.get('transferSettled')?.forEach(listener => listener(item));
        }
      }
      this.#knownTransfers = current;
    } catch { /* A later poll will retry; read calls surface their own errors. */ }
  }
}

export function announceWebRgbProvider(provider: WebRgbProvider) {
  const info = {
    uuid: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
        const value = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
        return (char === 'x' ? value : (value & 3) | 8).toString(16);
      }),
    name: 'UniSat Wallet',
    rdns: 'io.unisat.wallet'
  };
  const announce = () => window.dispatchEvent(new CustomEvent('rgb:announceProvider', { detail: { info, provider } }));
  window.addEventListener('rgb:requestProvider', announce);
  let installed = false;
  try {
    if (!window.rgb) {
      Object.defineProperty(window, 'rgb', { value: provider, configurable: false, writable: false });
      installed = true;
    }
  } catch { /* A page or another wallet owns the slot; discovery still works. */ }
  if (installed) {
    window.dispatchEvent(new CustomEvent('rgb:ready', { detail: { version: '1.0.0' } }));
  }
  announce();
}

declare global { interface Window { rgb?: WebRgbProvider } }
