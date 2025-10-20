import { EventEmitter } from 'eventemitter3'
import type { NotificationAdapter } from '../adapters'
import { IS_CHROME, IS_LINUX } from '../shared/constants'
import { ErrorCodes, WalletError } from '../utils/error'

interface Approval {
  data: {
    state: number
    params?: any
    origin?: string
    approvalComponent: string
    requestDefer?: Promise<any>
    approvalType: string
  }
  resolve(params?: any): void
  reject(err: any): void
}

// something need user approval in window
// should only open one window, unfocus will close the current notification
class NotificationService extends EventEmitter {
  approval: Approval | null = null
  notifiWindowId = 0
  isLocked = false
  private adapter?: NotificationAdapter

  constructor() {
    super()
  }

  setAdapter(adapter: NotificationAdapter) {
    this.adapter = adapter
  }

  init() {
    // Initialize window event listeners if available
    // This will be implemented by the platform-specific adapter
  }

  getApproval = () => this.approval?.data

  resolveApproval = (data?: any, forceReject = false) => {
    if (forceReject) {
      this.approval?.reject(new WalletError(ErrorCodes.UserCancel, 'User Cancel'))
    } else {
      this.approval?.resolve(data)
    }
    this.approval = null
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
  requestApproval = async (data, winProps?): Promise<any> => {
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
      // Close existing notification
      this.notifiWindowId = 0
    }
    
    // Platform-specific implementation will be handled by adapters
    if (this.adapter) {
      await this.adapter.create('approval-notification', {
        title: 'UniSat Wallet',
        message: 'Approval required',
        type: 'basic'
      })
    }
  }

  // Create a platform notification
  async createNotification(id: string, title: string, message: string) {
    if (this.adapter) {
      await this.adapter.create(id, { title, message })
    }
  }

  async clearNotification(id: string) {
    if (this.adapter) {
      await this.adapter.clear(id)
    }
  }
}

export default new NotificationService()
