import { describe, expect, it, vi } from 'vitest'

import { RgbService } from '../src/services/rgb'

describe('RgbService', () => {
  it('sends consumed funding outpoints in the authenticated broadcast sync', async () => {
    const httpClient = {
      post: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
    }
    const service = new RgbService(httpClient as any)
    service.setRequestAuthenticator(
      vi.fn().mockResolvedValue({
        fundingAddress: 'bc1p-funding',
        nonce: 'a'.repeat(32),
        expiresAt: 1,
        signature: 'signature',
      })
    )

    await service.syncRgbTransfer({
      wallet: { fundingAddress: 'bc1p-funding', network: 'mainnet' },
      lease: { deviceId: 'device_abcdefghijklmnop', leaseId: 'a'.repeat(24), fencingToken: 1 },
      transferId: 'transfer-1',
      txid: 'b'.repeat(64),
      amount: '60',
      createdAt: 1_786_688_361_585,
      to: 'bc1p-recipient',
      spentOutpoints: [{ txid: 'c'.repeat(64), vout: 1 }],
      consignments: [],
    })

    expect(httpClient.post).toHaveBeenCalledWith('/v5/rgb/transfers/sync', {
      wallet: { fundingAddress: 'bc1p-funding', network: 'mainnet' },
      lease: { deviceId: 'device_abcdefghijklmnop', leaseId: 'a'.repeat(24), fencingToken: 1 },
      transferId: 'transfer-1',
      txid: 'b'.repeat(64),
      amount: '60',
      createdAt: 1_786_688_361_585,
      to: 'bc1p-recipient',
      spentOutpoints: [{ txid: 'c'.repeat(64), vout: 1 }],
      consignments: [],
      auth: expect.objectContaining({ fundingAddress: 'bc1p-funding' }),
    })
  })

  it('attaches the current lease to an address-index UTXO replacement', async () => {
    const httpClient = { post: vi.fn().mockResolvedValue(undefined), get: vi.fn() }
    const service = new RgbService(httpClient as any)
    service.setRequestAuthenticator(vi.fn().mockResolvedValue({
      fundingAddress: 'bc1p-funding', nonce: 'a'.repeat(32), expiresAt: 1, signature: 'signature',
    }))
    const wallet = { fundingAddress: 'bc1p-funding', network: 'mainnet' as const }
    const lease = { deviceId: 'device_abcdefghijklmnop', leaseId: 'a'.repeat(24), fencingToken: 1 }

    await service.replaceRgbUtxos({
      address: wallet.fundingAddress,
      wallet,
      lease,
      txid: 'b'.repeat(64),
      outpoints: [],
    })

    expect(httpClient.post).toHaveBeenCalledWith('/v5/rgb/utxos/replace', {
      address: wallet.fundingAddress,
      wallet,
      lease,
      txid: 'b'.repeat(64),
      outpoints: [],
      auth: expect.objectContaining({ fundingAddress: wallet.fundingAddress }),
    })
  })

  it('authenticates RGB lease acquisition and outpoint verification', async () => {
    const httpClient = {
      post: vi
        .fn()
        .mockResolvedValueOnce({ leaseId: 'a'.repeat(24), fencingToken: 1, expiresAt: 2 })
        .mockResolvedValueOnce({
          outpoints: [{ txid: 'b'.repeat(64), vout: 0, status: 'confirmed', confirmations: 1 }],
        }),
      get: vi.fn(),
    }
    const service = new RgbService(httpClient as any)
    service.setRequestAuthenticator(
      vi.fn().mockResolvedValue({
        fundingAddress: 'bc1p-funding',
        nonce: 'a'.repeat(32),
        expiresAt: 1,
        signature: 'signature',
      })
    )
    const wallet = { fundingAddress: 'bc1p-funding', network: 'mainnet' }
    const deviceId = 'device_abcdefghijklmnop'

    await expect(service.acquireRgbWriteLease({ wallet, deviceId })).resolves.toMatchObject({
      leaseId: 'a'.repeat(24),
      fencingToken: 1,
    })
    await expect(
      service.verifyRgbUtxos({
        wallet,
        deviceId,
        leaseId: 'a'.repeat(24),
        fencingToken: 1,
        outpoints: [{ txid: 'b'.repeat(64), vout: 0, satoshis: 330, scriptPk: '5120' + '11'.repeat(32) }],
      })
    ).resolves.toMatchObject({ outpoints: [{ status: 'confirmed' }] })

    expect(httpClient.post).toHaveBeenNthCalledWith(
      1,
      '/v5/rgb/lease/acquire',
      expect.objectContaining({ wallet, deviceId, auth: expect.any(Object) })
    )
    expect(httpClient.post).toHaveBeenNthCalledWith(
      2,
      '/v5/rgb/utxos/verify',
      expect.objectContaining({ wallet, deviceId, fencingToken: 1, auth: expect.any(Object) })
    )
  })

  it('reads lease status without requesting another device identity', async () => {
    const httpClient = { post: vi.fn().mockResolvedValue({ available: false, heldByCaller: false, expiresAt: 2 }), get: vi.fn() }
    const service = new RgbService(httpClient as any)
    service.setRequestAuthenticator(vi.fn().mockResolvedValue({
      fundingAddress: 'bc1p-funding', nonce: 'a'.repeat(32), expiresAt: 1, signature: 'signature',
    }))
    const wallet = { fundingAddress: 'bc1p-funding', network: 'mainnet' as const }

    await expect(service.getRgbWriteLeaseStatus({ wallet })).resolves.toEqual({
      available: false, heldByCaller: false, expiresAt: 2,
    })
    expect(httpClient.post).toHaveBeenCalledWith('/v5/rgb/lease/status', {
      wallet,
      auth: expect.objectContaining({ fundingAddress: wallet.fundingAddress }),
    })
  })

  it('sends a confirmed receive activity through the authenticated API', async () => {
    const httpClient = {
      post: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
    }
    const service = new RgbService(httpClient as any)
    service.setRequestAuthenticator(
      vi.fn().mockResolvedValue({
        fundingAddress: 'bc1p-funding',
        nonce: 'a'.repeat(32),
        expiresAt: 1,
        signature: 'signature',
      })
    )

    await service.syncRgbReceiveTransfer({
      wallet: { fundingAddress: 'bc1p-funding' },
      transferId: 'receive:invoice-1',
      assetId: 'rgb:072cd658eb21c9683a226d0507ca2e9a995fe5bbfba2625380196c67f0a6719f',
      amount: '2',
      txid: 'b'.repeat(64),
      createdAt: 1_786_688_361_585,
      from: 'bc1p-sender',
    })

    expect(httpClient.post).toHaveBeenCalledWith('/v5/rgb/transfers/receive', {
      wallet: { fundingAddress: 'bc1p-funding' },
      transferId: 'receive:invoice-1',
      assetId: 'rgb:ByzWWOsh-yWg6Im0-FB8oump-lf5bv7o-mJTgBls-Z~CmcZ8',
      amount: '2',
      txid: 'b'.repeat(64),
      createdAt: 1_786_688_361_585,
      from: 'bc1p-sender',
      auth: expect.objectContaining({ fundingAddress: 'bc1p-funding' }),
    })
  })

  it('normalizes legacy RGB hex IDs on reads and in activity responses', async () => {
    const httpClient = {
      post: vi.fn(),
      get: vi
        .fn()
        .mockResolvedValueOnce({
          assetId: 'rgb:072cd658eb21c9683a226d0507ca2e9a995fe5bbfba2625380196c67f0a6719f',
          name: 'Example',
          ticker: 'EX',
          precision: 0,
          balance: '1',
        })
        .mockResolvedValueOnce([
          {
            id: 'activity-1',
            assetId: 'rgb:072cd658eb21c9683a226d0507ca2e9a995fe5bbfba2625380196c67f0a6719f',
            type: 'receive',
            status: 'settled',
            amount: '1',
            txid: 'a'.repeat(64),
            from: '',
            to: '',
            timestamp: 1,
          },
        ]),
    }
    const service = new RgbService(httpClient as any)

    await expect(
      service.getRgbAssetBalance(
        'bc1p-funding',
        'rgb:072cd658eb21c9683a226d0507ca2e9a995fe5bbfba2625380196c67f0a6719f'
      )
    ).resolves.toMatchObject({
      assetId: 'rgb:ByzWWOsh-yWg6Im0-FB8oump-lf5bv7o-mJTgBls-Z~CmcZ8',
    })
    expect(httpClient.get).toHaveBeenNthCalledWith(
      1,
      `/v5/rgb/address/bc1p-funding/assets/${encodeURIComponent(
        'rgb:ByzWWOsh-yWg6Im0-FB8oump-lf5bv7o-mJTgBls-Z~CmcZ8'
      )}`
    )

    await expect(
      service.getRgbAssetActivity(
        'rgb:072cd658eb21c9683a226d0507ca2e9a995fe5bbfba2625380196c67f0a6719f',
        { page: 1, pageSize: 20 }
      )
    ).resolves.toMatchObject({
      list: [
        { assetId: 'rgb:ByzWWOsh-yWg6Im0-FB8oump-lf5bv7o-mJTgBls-Z~CmcZ8' },
      ],
    })
  })

  it('hydrates incomplete list metadata from the asset detail endpoint', async () => {
    const assetId = 'rgb:ByzWWOsh-yWg6Im0-FB8oump-lf5bv7o-mJTgBls-Z~CmcZ8'
    const httpClient = {
      post: vi.fn(),
      get: vi
        .fn()
        .mockResolvedValueOnce({
          total: 1,
          list: [
            {
              assetId: 'rgb:072cd658eb21c9683a226d0507ca2e9a995fe5bbfba2625380196c67f0a6719f',
              name: 'RGB',
              ticker: 'RGB',
              precision: 0,
              balance: '60',
              spendable: '60',
            },
          ],
        })
        .mockResolvedValueOnce({
          assetId,
          name: 'Received Token',
          ticker: 'TOK',
          precision: 2,
          schema: 'NIA',
          issuedSupply: '1000',
        }),
    }
    const service = new RgbService(httpClient as any)

    await expect(service.getRgbAssetList('bc1p-funding', 1, 20)).resolves.toMatchObject({
      total: 1,
      list: [
        {
          assetId,
          name: 'Received Token',
          ticker: 'TOK',
          precision: 2,
          schema: 'NIA',
          issuedSupply: '1000',
          balance: '60',
          spendable: '60',
        },
      ],
    })
    expect(httpClient.get).toHaveBeenNthCalledWith(
      2,
      `/v5/rgb/assets/${encodeURIComponent(assetId)}`
    )
  })
})
