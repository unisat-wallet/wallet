import { describe, expect, it, vi } from 'vitest'
import { ApprovalService } from '../src/approval-service'

function createService() {
  const service = new ApprovalService()
  service.platformOpenWindow = vi.fn().mockResolvedValue(1)
  service.platformCloseWindow = vi.fn().mockResolvedValue(undefined)
  return service
}

describe('approval type guards', () => {
  it('unlocks only a pending lock approval', async () => {
    const service = createService()
    const connect = service.requestApproval({
      approvalComponent: 'Connect',
      params: { session: { origin: 'https://dapp.example' } },
    })

    expect(await service.resolveUnlockApproval()).toBe(false)
    expect(service.getApproval()?.approvalComponent).toBe('Connect')
    await service.rejectApproval()
    await expect(connect).rejects.toThrow()

    const unlock = service.requestApproval({ lock: true })
    expect(await service.resolveUnlockApproval()).toBe(true)
    await expect(unlock).resolves.toBeUndefined()
  })

  it('connects only when the pending approval origin matches', async () => {
    const service = createService()
    const connect = service.requestApproval({
      approvalComponent: 'Connect',
      params: { session: { origin: 'https://dapp.example' } },
    })

    expect(await service.resolveConnectApproval('https://other.example')).toBe(false)
    expect(service.getApproval()?.approvalComponent).toBe('Connect')
    expect(await service.resolveConnectApproval('https://dapp.example')).toBe(true)
    await expect(connect).resolves.toEqual({ approved: true, origin: 'https://dapp.example' })
  })
})
