import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApprovalService } from '../src/approval-service'

function makeApprovalData(overrides?: object) {
  return {
    state: 1,
    approvalComponent: 'SignTx',
    approvalType: 'transaction',
    params: { txid: 'abc123' },
    origin: 'https://example.com',
    ...overrides,
  }
}

// flush all pending microtasks and one macrotask tick
function flushAsync() {
  return new Promise((r) => setTimeout(r, 0))
}

describe('ApprovalService', () => {
  let service: ApprovalService

  beforeEach(() => {
    service = new ApprovalService()
    service.platformOpenWindow = vi.fn().mockResolvedValue(42)
    service.platformCloseWindow = vi.fn().mockResolvedValue(undefined)
    service.platformFocusWindow = vi.fn().mockResolvedValue(undefined)
  })

  // ── initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts with no pending approval', () => {
      expect(service.approval).toBeNull()
    })

    it('starts unlocked', () => {
      expect(service.isLocked).toBe(false)
    })

    it('starts with approvalWindowId = 0', () => {
      expect(service.approvalWindowId).toBe(0)
    })
  })

  // ── lock / unlock ─────────────────────────────────────────────────────────

  describe('lock / unlock', () => {
    it('lock() sets isLocked to true', () => {
      service.lock()
      expect(service.isLocked).toBe(true)
    })

    it('unLock() sets isLocked to false', () => {
      service.lock()
      service.unLock()
      expect(service.isLocked).toBe(false)
    })
  })

  // ── getApproval ───────────────────────────────────────────────────────────

  describe('getApproval', () => {
    it('returns undefined when no approval is pending', () => {
      expect(service.getApproval()).toBeUndefined()
    })

    it('returns the approval data after requestApproval', () => {
      const data = makeApprovalData()
      service.requestApproval(data).catch(() => {})
      expect(service.getApproval()).toEqual(data)
    })
  })

  // ── requestApproval ───────────────────────────────────────────────────────

  describe('requestApproval', () => {
    it('opens a notification window', async () => {
      service.requestApproval(makeApprovalData()).catch(() => {})
      await flushAsync()
      expect(service.platformOpenWindow).toHaveBeenCalledTimes(1)
    })

    it('stores the pending approval', () => {
      const data = makeApprovalData()
      service.requestApproval(data).catch(() => {})
      expect(service.approval).not.toBeNull()
      expect(service.approval?.data).toEqual(data)
    })

    it('rejects a second approval request while one is pending', async () => {
      const first = makeApprovalData({ approvalType: 'first' })
      const second = makeApprovalData({ approvalType: 'second' })
      service.requestApproval(first).catch(() => {})
      await expect(service.requestApproval(second)).rejects.toMatchObject({
        message: 'Another approval request is already pending',
      })
      expect(service.getApproval()?.approvalType).toBe('first')
    })

    it('focuses existing approval window before rejecting a second request', async () => {
      const first = makeApprovalData({ approvalType: 'first' })
      const second = makeApprovalData({ approvalType: 'second' })
      service.requestApproval(first).catch(() => {})
      await flushAsync()

      await expect(service.requestApproval(second)).rejects.toMatchObject({
        message: 'Another approval request is already pending',
      })
      expect(service.platformFocusWindow).toHaveBeenCalledWith(42)
    })

    it('still rejects second request when focus fails', async () => {
      const first = makeApprovalData({ approvalType: 'first' })
      const second = makeApprovalData({ approvalType: 'second' })
      service.platformFocusWindow = vi.fn().mockRejectedValue(new Error('focus failed'))
      service.requestApproval(first).catch(() => {})
      await flushAsync()

      await expect(service.requestApproval(second)).rejects.toMatchObject({
        message: 'Another approval request is already pending',
      })
      expect(service.getApproval()?.approvalType).toBe('first')
    })

    it('does not try to focus when there is no window id', async () => {
      const first = makeApprovalData({ approvalType: 'first' })
      const second = makeApprovalData({ approvalType: 'second' })
      service.requestApproval(first).catch(() => {})
      service.approvalWindowId = 0

      await expect(service.requestApproval(second)).rejects.toMatchObject({
        message: 'Another approval request is already pending',
      })
      expect(service.platformFocusWindow).not.toHaveBeenCalled()
    })

    it('returns a Promise that resolves when resolveApproval is called', async () => {
      const promise = service.requestApproval(makeApprovalData())
      await service.resolveApproval({ result: 'ok' })
      await expect(promise).resolves.toEqual({ result: 'ok' })
    })

    it('returns a Promise that rejects when rejectApproval is called', async () => {
      const promise = service.requestApproval(makeApprovalData())
      await service.rejectApproval('User cancelled')
      await expect(promise).rejects.toMatchObject({ message: 'User cancelled' })
    })
  })

  // ── resolveApproval ───────────────────────────────────────────────────────

  describe('resolveApproval', () => {
    it('resolves with provided data', async () => {
      const promise = service.requestApproval(makeApprovalData())
      await service.resolveApproval({ sig: 'deadbeef' })
      await expect(promise).resolves.toEqual({ sig: 'deadbeef' })
    })

    it('clears the approval after resolving', async () => {
      service.requestApproval(makeApprovalData()).catch(() => {})
      await service.resolveApproval()
      expect(service.approval).toBeNull()
    })

    it('emits resolve event with the data', async () => {
      const listener = vi.fn()
      service.on('resolve', listener)
      service.requestApproval(makeApprovalData()).catch(() => {})
      await service.resolveApproval('result')
      expect(listener).toHaveBeenCalledWith('result')
    })

    it('force-rejects when forceReject = true', async () => {
      const promise = service.requestApproval(makeApprovalData())
      await service.resolveApproval(undefined, true)
      await expect(promise).rejects.toMatchObject({ message: 'User Cancel' })
    })

    it('closes the notification window', async () => {
      service.requestApproval(makeApprovalData()).catch(() => {})
      await flushAsync() // wait for openNotification to assign approvalWindowId
      await service.resolveApproval()
      expect(service.platformCloseWindow).toHaveBeenCalled()
    })

    it('settles only after the old notification is closed', async () => {
      let finishClose!: () => void
      service.platformCloseWindow = vi.fn(() => new Promise<void>(resolve => {
        finishClose = resolve
      }))
      const promise = service.requestApproval(makeApprovalData())
      await flushAsync()
      let settled = false
      void promise.finally(() => { settled = true })

      const resolving = service.resolveApproval('unlocked')
      await Promise.resolve()
      expect(settled).toBe(false)

      finishClose()
      await resolving
      await expect(promise).resolves.toBe('unlocked')
      expect(settled).toBe(true)
    })

    it('still settles when closing the notification fails', async () => {
      service.platformCloseWindow = vi.fn().mockRejectedValue(new Error('window already gone'))
      const promise = service.requestApproval(makeApprovalData())
      await flushAsync()

      await expect(service.resolveApproval('ok')).resolves.toBeUndefined()
      await expect(promise).resolves.toBe('ok')
    })
  })

  // ── rejectApproval ────────────────────────────────────────────────────────

  describe('rejectApproval', () => {
    it('rejects with provided error message', async () => {
      const promise = service.requestApproval(makeApprovalData())
      await service.rejectApproval('something went wrong')
      await expect(promise).rejects.toMatchObject({ message: 'something went wrong' })
    })

    it('clears the approval after rejecting', async () => {
      const promise = service.requestApproval(makeApprovalData())
      await service.rejectApproval('err')
      expect(service.approval).toBeNull()
      await expect(promise).rejects.toBeDefined()
    })

    it('emits reject event with the error message', async () => {
      const listener = vi.fn()
      service.on('reject', listener)
      const promise = service.requestApproval(makeApprovalData())
      await service.rejectApproval('cancelled')
      expect(listener).toHaveBeenCalledWith('cancelled')
      await expect(promise).rejects.toBeDefined()
    })

    it('does nothing when there is no pending approval', async () => {
      await expect(service.rejectApproval('no-op')).resolves.toBeUndefined()
    })

    it('keeps the window open when stay = true', async () => {
      const promise = service.requestApproval(makeApprovalData())
      await flushAsync()
      const closeCallsBefore = (service.platformCloseWindow as ReturnType<typeof vi.fn>).mock.calls.length
      await service.rejectApproval('err', true)
      await expect(promise).rejects.toBeDefined()
      expect((service.platformCloseWindow as ReturnType<typeof vi.fn>).mock.calls.length).toBe(closeCallsBefore)
    })

    it('still rejects when closing the notification fails', async () => {
      service.platformCloseWindow = vi.fn().mockRejectedValue(new Error('window already gone'))
      const promise = service.requestApproval(makeApprovalData())
      await flushAsync()

      await expect(service.rejectApproval('cancelled')).resolves.toBeUndefined()
      await expect(promise).rejects.toMatchObject({ code: 4001, message: 'cancelled' })
    })
  })

  // ── clear ─────────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('nullifies the approval', async () => {
      service.requestApproval(makeApprovalData()).catch(() => {})
      await service.clear()
      expect(service.approval).toBeNull()
    })

    it('closes the notification window and resets approvalWindowId', async () => {
      service.requestApproval(makeApprovalData()).catch(() => {})
      await flushAsync() // wait for openNotification to assign approvalWindowId
      await service.clear()
      expect(service.platformCloseWindow).toHaveBeenCalledWith(42)
      expect(service.approvalWindowId).toBe(0)
    })

    it('does not close window when stay = true', async () => {
      service.requestApproval(makeApprovalData()).catch(() => {})
      await flushAsync()
      const closeCallsBefore = (service.platformCloseWindow as ReturnType<typeof vi.fn>).mock.calls.length
      await service.clear(true)
      expect((service.platformCloseWindow as ReturnType<typeof vi.fn>).mock.calls.length).toBe(closeCallsBefore)
    })
  })

  // ── openNotification ──────────────────────────────────────────────────────

  describe('openNotification', () => {
    it('closes existing window before opening a new one', async () => {
      await service.openNotification()
      const firstId = service.approvalWindowId
      await service.openNotification()
      expect(service.platformCloseWindow).toHaveBeenCalledWith(firstId)
    })

    it('assigns the returned window id to approvalWindowId', async () => {
      await service.openNotification()
      expect(service.approvalWindowId).toBe(42)
    })

    it('passes winProps to platformOpenWindow', async () => {
      const props = { width: 400, height: 600 }
      await service.openNotification(props)
      expect(service.platformOpenWindow).toHaveBeenCalledWith(props)
    })
  })

  describe('handleWindowRemoved', () => {
    it('rejects the active approval when its window is closed', async () => {
      const promise = service.requestApproval(makeApprovalData())
      await flushAsync()

      await service.handleWindowRemoved(42)

      await expect(promise).rejects.toMatchObject({ code: 4001 })
      expect(service.approval).toBeNull()
      expect(service.approvalWindowId).toBe(0)
    })

    it('ignores unrelated window removals', async () => {
      service.requestApproval(makeApprovalData()).catch(() => {})
      await flushAsync()

      await service.handleWindowRemoved(99)

      expect(service.approval).not.toBeNull()
      expect(service.approvalWindowId).toBe(42)
    })

    it('ignores window removals when no approval is pending', async () => {
      await expect(service.handleWindowRemoved(42)).resolves.toBeUndefined()
    })
  })

  // ── EventEmitter integration ──────────────────────────────────────────────

  describe('EventEmitter', () => {
    it('supports multiple listeners on the same event', async () => {
      const a = vi.fn()
      const b = vi.fn()
      service.on('resolve', a)
      service.on('resolve', b)
      service.requestApproval(makeApprovalData()).catch(() => {})
      await service.resolveApproval('data')
      expect(a).toHaveBeenCalledWith('data')
      expect(b).toHaveBeenCalledWith('data')
    })

    it('once() listener fires only once', async () => {
      const listener = vi.fn()
      service.once('resolve', listener)
      service.requestApproval(makeApprovalData()).catch(() => {})
      await service.resolveApproval()
      service.requestApproval(makeApprovalData()).catch(() => {})
      await service.resolveApproval()
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })
})
