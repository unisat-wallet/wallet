import { ErrorCodes, WalletError } from '@unisat/wallet-shared'
import { EventEmitter } from 'eventemitter3'
import { Approval } from './types'

// something need user approval in window
// should only open one window, unfocus will close the current notification
export class NotificationService extends EventEmitter {
  approval: Approval | null = null
  public notifiWindowId = 0
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
    // if (preferenceService.getPopupOpen()) {
    //   this.approval = null;
    //   throw ethErrors.provider.userRejectedRequest('please request after user close current popup');
    // }

    // We will just override the existing open approval with the new one coming in
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
    if (this.notifiWindowId && !stay) {
      // Platform-specific window management will be handled by adapters
      await this.platformCloseWindow(this.notifiWindowId)
      this.notifiWindowId = 0
    }
  }

  unLock = () => {
    this.isLocked = false
  }

  lock = () => {
    this.isLocked = true
  }

  openNotification = async (winProps?: any) => {
    if (this.notifiWindowId) {
      await this.platformCloseWindow(this.notifiWindowId)
      this.notifiWindowId = 0
    }
    this.notifiWindowId = await this.platformOpenWindow(winProps)
  }

  platformOpenWindow = async (winProps?: any): Promise<number> => {
    return 1 // Placeholder implementation
  }

  platformCloseWindow = async (windowId: number) => {
    // todo
  }
}
