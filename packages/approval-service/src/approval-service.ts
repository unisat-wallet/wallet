import { ErrorCodes, WalletError } from '@unisat/wallet-shared'
import { EventEmitter } from 'eventemitter3'
import { Approval } from './types'

// something need user approval in window
// should only open one window, unfocus will close the current notification
export class ApprovalService extends EventEmitter {
  approval: Approval | null = null
  public approvalWindowId = 0
  isLocked = false

  constructor() {
    super()
  }

  init() {
    // Initialize window event listeners if available
    // This will be implemented by the platform-specific adapter
  }

  getApproval = () => this.approval?.data

  resolveApproval = async (data?: any, forceReject = false) => {
    if (forceReject) {
      this.approval?.reject(new WalletError(ErrorCodes.UserCancel, 'User Cancel'))
    } else {
      this.approval?.resolve(data)
    }
    this.approval = null
    await this.clear()
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
    if (!this.approval) return
    if (isInternal) {
      this.approval?.reject(new WalletError(ErrorCodes.UserCancel, err))
    } else {
      this.approval?.reject(new WalletError(ErrorCodes.UserCancel, err))
    }

    await this.clear(stay)
    this.emit('reject', err)
  }

  // currently it only support one approval at the same time
  requestApproval = async (data: any, winProps?: any): Promise<any> => {
    if (this.approval) {
      if (this.approvalWindowId) {
        try {
          await this.platformFocusWindow(this.approvalWindowId)
        } catch (e) {
          // keep original behavior even if focusing existing window fails
        }
      }
      throw new WalletError(ErrorCodes.UNKNOWN, 'Another approval request is already pending')
    }

    return new Promise((resolve, reject) => {
      this.approval = {
        data,
        resolve,
        reject,
      }

      this.openNotification(winProps)
    })
  }

  clear = async (stay = false) => {
    this.approval = null
    if (this.approvalWindowId && !stay) {
      await this.platformCloseWindow(this.approvalWindowId)
      this.approvalWindowId = 0
    }
  }

  unLock = () => {
    this.isLocked = false
  }

  lock = () => {
    this.isLocked = true
  }

  openNotification = async (winProps?: any) => {
    if (this.approvalWindowId) {
      await this.platformCloseWindow(this.approvalWindowId)
      this.approvalWindowId = 0
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
}
