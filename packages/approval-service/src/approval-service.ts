import { ErrorCodes, WalletError } from '@unisat/wallet-shared'
import { EventEmitter } from 'eventemitter3'
import { Approval } from './types'

// something need user approval in window
// should only open one window, unfocus will close the current notification
export class ApprovalService extends EventEmitter {
  approval: Approval | null = null
  public approvalWindowId = 0
  isLocked = false
  private closingApproval: Approval | null = null
  private approvalPromise: Promise<any> | null = null
  private approvalWindowProps: any
  private notificationOpening: Promise<void> | null = null

  constructor() {
    super()
  }

  init() {
    // Initialize window event listeners if available
    // This will be implemented by the platform-specific adapter
  }

  getApproval = () => this.approval?.data

  resolveApproval = async (data?: any, forceReject = false) => {
    const approval = this.approval
    if (!approval || !this.beginClosing(approval)) return
    // Finish removing the current notification before settling its Promise.
    // The provider flow may synchronously request its next approval as soon as
    // this Promise settles; resolving first lets the old window-removal event
    // reject that newly-created approval.
    try {
      await this.closeNotificationWindow()
    } catch {
      // Window cleanup must never leave the dApp request pending forever.
    } finally {
      this.finishClosing(approval)
    }
    if (forceReject) {
      approval?.reject(new WalletError(ErrorCodes.UserCancel, 'User Cancel'))
    } else {
      approval?.resolve(data)
    }
    this.emit('resolve', data)
  }

  resolveUnlockApproval = async () => {
    if (!this.approval?.data?.lock) return false
    await this.resolveApproval()
    return true
  }

  resolveConnectApproval = async (origin: string) => {
    const approval = this.approval?.data
    if (approval?.approvalComponent !== 'Connect' || approval.params?.session?.origin !== origin) {
      return false
    }
    await this.resolveApproval({ approved: true, origin })
    return true
  }

  rejectApproval = async (err?: string, stay = false, isInternal = false) => {
    const approval = this.approval
    if (!approval || !this.beginClosing(approval)) return
    try {
      await this.closeNotificationWindow(stay)
    } catch {
      // Reject the dApp request even when the notification cannot be closed.
    } finally {
      this.finishClosing(approval)
    }
    if (isInternal) {
      approval.reject(new WalletError(ErrorCodes.UserCancel, err))
    } else {
      approval.reject(new WalletError(ErrorCodes.UserCancel, err))
    }
    this.emit('reject', err)
  }

  // currently it only support one approval at the same time
  requestApproval = async (data: any, winProps?: any): Promise<any> => {
    const existing = this.approval
    if (existing) {
      const existingPromise = this.approvalPromise
      const reusable = this.isReusableApproval(existing.data, data)
      await this.focusOrRestoreNotification(existing)
      if (this.approval !== existing) {
        if (reusable && existingPromise) return existingPromise
        // The old approval may have settled while its window was being
        // restored. Let this request claim the now-empty slot.
        return this.requestApproval(data, winProps)
      }
      if (reusable && existingPromise) return existingPromise
      throw new WalletError(ErrorCodes.UNKNOWN, 'Another approval request is already pending')
    }

    let approval!: Approval
    const promise = new Promise((resolve, reject) => {
      approval = {
        data,
        resolve,
        reject,
      }
      this.approval = approval
    })
    this.approvalPromise = promise
    this.approvalWindowProps = winProps
    void this.openNotification(winProps).catch(() => {
      this.failApprovalWithoutWindow(approval)
    })
    return promise
  }

  clear = async (stay = false) => {
    const approval = this.approval
    if (!approval) {
      await this.closeNotificationWindow(stay)
      return
    }
    if (!this.beginClosing(approval)) return
    try {
      await this.closeNotificationWindow(stay)
    } finally {
      this.finishClosing(approval)
    }
  }

  unLock = () => {
    this.isLocked = false
  }

  lock = () => {
    this.isLocked = true
  }

  openNotification = async (winProps?: any) => {
    if (this.notificationOpening) return this.notificationOpening
    const opening = this.openNotificationOnce(winProps)
    this.notificationOpening = opening
    try {
      await opening
    } finally {
      if (this.notificationOpening === opening) this.notificationOpening = null
    }
  }

  private async openNotificationOnce(winProps?: any): Promise<void> {
    if (this.approvalWindowId) {
      const windowId = this.approvalWindowId
      this.approvalWindowId = 0
      await this.platformCloseWindow(windowId)
    }
    this.approvalWindowId = await this.platformOpenWindow(winProps)
  }

  handleWindowRemoved = async (windowId: number) => {
    if (!this.approval || windowId !== this.approvalWindowId) {
      return
    }

    this.approvalWindowId = 0
    await this.rejectApproval()
  }

  platformOpenWindow = async (winProps?: any): Promise<number> => {
    return 1 // Placeholder implementation
  }

  platformCloseWindow = async (windowId: number) => {
    // todo
  }

  platformFocusWindow = async (windowId: number) => {
    // todo
  }

  private beginClosing(approval: Approval): boolean {
    if (this.closingApproval) return false
    this.closingApproval = approval
    return true
  }

  private finishClosing(approval: Approval): void {
    if (this.approval === approval) {
      this.approval = null
      this.approvalPromise = null
      this.approvalWindowProps = undefined
    }
    if (this.closingApproval === approval) this.closingApproval = null
  }

  private async closeNotificationWindow(stay = false): Promise<void> {
    if (stay) return
    if (this.notificationOpening) {
      try {
        await this.notificationOpening
      } catch {
        // The caller still owns settlement of the active approval.
      }
    }
    if (!this.approvalWindowId) return
    const windowId = this.approvalWindowId
    // Disarm the old removal event before yielding to the platform. The
    // approval itself remains installed as a closing sentinel until this
    // method settles, so a concurrent request cannot occupy the old slot.
    this.approvalWindowId = 0
    await this.platformCloseWindow(windowId)
  }

  private async focusOrRestoreNotification(approval: Approval): Promise<void> {
    if (this.notificationOpening) {
      try {
        await this.notificationOpening
      } catch {
        // The initial request's failure handler clears the occupied slot.
      }
    }
    if (this.approval !== approval || this.closingApproval === approval) return
    if (this.approvalWindowId) {
      const windowId = this.approvalWindowId
      try {
        await this.platformFocusWindow(windowId)
        return
      } catch {
        // A stale browser window ID must not strand an invisible approval.
        if (this.approvalWindowId === windowId) this.approvalWindowId = 0
        try {
          await this.platformCloseWindow(windowId)
        } catch {
          // The stale window is already gone.
        }
      }
    }
    try {
      await this.openNotification(this.approvalWindowProps)
    } catch {
      this.failApprovalWithoutWindow(approval)
    }
  }

  private failApprovalWithoutWindow(approval: Approval): void {
    if (this.approval !== approval || !this.beginClosing(approval)) return
    this.approvalWindowId = 0
    this.finishClosing(approval)
    const message = 'Unable to open approval window'
    approval.reject(new WalletError(ErrorCodes.UNKNOWN, message))
    this.emit('reject', message)
  }

  private isReusableApproval(existing: any, incoming: any): boolean {
    if (existing?.lock === true || incoming?.lock === true) {
      return existing?.lock === true && incoming?.lock === true
    }
    if (existing?.approvalComponent !== 'Connect' || incoming?.approvalComponent !== 'Connect')
      return false
    const existingOrigin = existing.params?.session?.origin ?? existing.origin
    const incomingOrigin = incoming.params?.session?.origin ?? incoming.origin
    return typeof existingOrigin === 'string' && existingOrigin === incomingOrigin
  }
}
