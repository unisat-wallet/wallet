import { announceWebRgbProvider, WebRgbProvider } from './webRgb';
import { describe, expect, it, vi } from 'vitest';

const methods = ['enable', 'getInfo', 'getAddress', 'blindReceive', 'witnessReceive', 'listAssets',
  'getAssetBalance', 'sendAsset', 'listTransfers', 'getTransferStatus', 'decodeRgbInvoice', 'on', 'off'];

function createProvider(overrides: Record<string, any> = {}) {
  const rpc = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method in overrides) {
      const override = overrides[method];
      return typeof override === 'function' ? override(params) : override;
    }
    switch (method) {
      case 'webRgbEnable': return undefined;
      case 'getAccounts': return ['bc1qtest'];
      case 'webRgbGetInfo': return { ready: true, network: 'T0', protocol: 'RGB_L1', methods };
      case 'webRgbGetAssetBalance': return { assetId: params?.assetId, balance: 20, raw: {} };
      default: throw new Error(`Unexpected method: ${method}`);
    }
  });
  return { provider: new WebRgbProvider(rpc), rpc };
}

describe('WebRGB provider', () => {
  it('does not prompt or expose reads before enable', async () => {
    const { provider, rpc } = createProvider();
    expect((provider as any).rpc).toBeUndefined();
    expect((provider as any).call).toBeUndefined();
    (provider as any).connected = true;
    expect(provider.enabled).toBe(false);
    await expect(provider.getInfo()).rejects.toMatchObject({ code: 'NOT_ENABLED' });
    await expect(provider.listAssets()).rejects.toMatchObject({ code: 'NOT_ENABLED' });
    expect(rpc).not.toHaveBeenCalled();
    await provider.enable();
    expect(provider.enabled).toBe(true);
    expect((await provider.getInfo()).methods).toContain('sendAsset');
  });

  it('creates a receive invoice with the effective three-confirmation floor', async () => {
    const { provider, rpc } = createProvider({
      createRgbReceiveInvoice: { invoice: 'rgb:invoice', recipientId: 'recipient' }
    });
    await provider.enable();
    expect(await provider.blindReceive({ assetId: 'rgb:asset', amount: 5, minConfirmations: 1 }))
      .toMatchObject({ invoice: 'rgb:invoice', minConfirmations: 3 });
    expect(rpc).toHaveBeenCalledWith('createRgbReceiveInvoice', expect.objectContaining({
      assetId: 'rgb:asset', amount: '5', minConfirmations: 3, recipientType: 'blind'
    }));
  });

  it('does not sign an any-amount invoice without a supplied amount', async () => {
    const { provider, rpc } = createProvider({
      webRgbDecodeInvoice: { assetId: 'rgb:asset', amount: null, recipientId: 'recipient' }
    });
    await provider.enable();
    await expect(provider.sendAsset({ invoice: 'rgb:invoice' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(rpc).not.toHaveBeenCalledWith('prepareRgbPayment', expect.anything());
  });

  it('rejects a transfer amount that cannot be represented safely', async () => {
    const { provider } = createProvider({
      webRgbListTransfers: [{ id: 'transfer-1', amount: '9007199254740992', status: 'settled' }]
    });
    await provider.enable();

    await expect(provider.listTransfers()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'RGB transfer amount is not a safe integer'
    });
  });

  it('returns the largest safe transfer amount without losing precision', async () => {
    const { provider } = createProvider({
      webRgbListTransfers: [{ id: 'transfer-1', amount: String(Number.MAX_SAFE_INTEGER), status: 'settled' }]
    });
    await provider.enable();

    await expect(provider.listTransfers()).resolves.toMatchObject([
      { id: 'transfer-1', amount: Number.MAX_SAFE_INTEGER, status: 'Settled' }
    ]);
  });

  it('returns METHOD_NOT_SUPPORTED for capabilities absent from getInfo', async () => {
    const { provider, rpc } = createProvider({
      webRgbGetInfo: { ready: false, network: 'T0', protocol: null, methods: ['enable', 'getInfo'] }
    });
    await provider.enable();
    await expect(provider.listAssets()).rejects.toMatchObject({ code: 'METHOD_NOT_SUPPORTED' });
    expect(rpc).not.toHaveBeenCalledWith('webRgbListAssets', expect.anything());
  });

  it('releases an unsigned reservation when the signing approval is rejected', async () => {
    const { provider, rpc } = createProvider({
      webRgbDecodeInvoice: { assetId: 'rgb:asset', amount: 5, recipientId: 'recipient' },
      prepareRgbPayment: { id: 'transfer-1' },
      signRgbPayment: () => { throw Object.assign(new Error('User rejected'), { code: 4001 }); },
      webRgbReleasePreparedPayment: { changed: true }
    });
    await provider.enable();
    await expect(provider.sendAsset({ invoice: 'rgb:invoice' })).rejects.toMatchObject({ code: 'USER_REJECTED' });
    expect(rpc).toHaveBeenCalledWith('webRgbReleasePreparedPayment', { transferId: 'transfer-1' });
  });

  it('does not treat a counterparty rejection as a user-dismissed signing prompt', async () => {
    const { provider, rpc } = createProvider({
      webRgbDecodeInvoice: { assetId: 'rgb:asset', amount: 5, recipientId: 'recipient' },
      prepareRgbPayment: { id: 'transfer-1' },
      signRgbPayment: () => { throw new Error('RGB transfer rejected by counterparty'); },
      webRgbReleasePreparedPayment: { changed: true }
    });
    await provider.enable();
    await expect(provider.sendAsset({ invoice: 'rgb:invoice' })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(rpc).not.toHaveBeenCalledWith('webRgbReleasePreparedPayment', expect.anything());
  });

  it('announces the same provider on load and discovery requests', () => {
    const target = new EventTarget() as Window;
    vi.stubGlobal('window', target);
    const provider = createProvider().provider;
    const announcements: any[] = [];
    let ready = 0;
    window.addEventListener('rgb:announceProvider', event => announcements.push((event as CustomEvent).detail));
    window.addEventListener('rgb:ready', () => { ready += 1; });
    try {
      announceWebRgbProvider(provider);
      window.dispatchEvent(new Event('rgb:requestProvider'));
      expect(window.rgb).toBe(provider);
      expect(ready).toBe(1);
      expect(announcements).toHaveLength(2);
      expect(announcements[0].provider).toBe(provider);
      expect(announcements[1].info.uuid).toBe(announcements[0].info.uuid);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
