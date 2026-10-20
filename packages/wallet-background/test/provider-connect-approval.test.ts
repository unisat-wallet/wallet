import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services', () => ({
  keyringService: { memStore: { getState: () => ({ isUnlocked: true }) } },
  permissionService: { hasPermission: () => false, addConnectedSite: vi.fn() },
}))
vi.mock('../src/controllers/provider/controller', () => ({
  default: {
    getPublicKey: vi.fn().mockResolvedValue('public-key'),
    webRgbGetInfo: vi.fn().mockResolvedValue({ ready: true }),
  },
}))
vi.mock('src/services/approval', () => ({
  default: { requestApproval: vi.fn(), unLock: vi.fn() },
}))
vi.mock('src/utils/eventBus', () => ({ bgEventBus: { emit: vi.fn() } }))

import rpcFlow from '../src/controllers/provider/rpcFlow'
import { permissionService } from '../src/services'
import approvalService from 'src/services/approval'

const request = () => ({
  data: { method: 'getPublicKey', params: {} },
  session: { origin: 'https://dapp.example', name: 'dApp', icon: '' },
})

describe('provider connection approval', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([undefined, { approved: true, origin: 'https://other.example' }, { approved: false, origin: 'https://dapp.example' }])(
    'does not connect without an explicit matching approval: %s',
    async result => {
      vi.mocked(approvalService.requestApproval).mockResolvedValue(result)
      await expect(rpcFlow(request())).rejects.toThrow('Connection was not approved')
      expect(permissionService.addConnectedSite).not.toHaveBeenCalled()
    }
  )

  it('connects after an explicit matching approval', async () => {
    vi.mocked(approvalService.requestApproval).mockResolvedValue({
      approved: true,
      origin: 'https://dapp.example',
    })

    await expect(rpcFlow(request())).resolves.toBe('public-key')
    expect(permissionService.addConnectedSite).toHaveBeenCalledWith(
      'https://dapp.example',
      'dApp',
      '',
      expect.anything()
    )
  })

  it('rejects WebRGB reads before enable without raising a connection prompt', async () => {
    await expect(rpcFlow({
      ...request(),
      data: { method: 'webRgbGetInfo', params: {} },
    })).rejects.toMatchObject({ code: 'NOT_ENABLED' })
    expect(approvalService.requestApproval).not.toHaveBeenCalled()
  })
})
