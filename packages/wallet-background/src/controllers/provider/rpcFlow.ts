import 'reflect-metadata'

import { BUS_EVENTS, BUS_METHODS, ErrorCodes, WalletError } from '@unisat/wallet-shared'
import { keyringService, permissionService } from '../../services'
import { PromiseFlow, underline2Camelcase } from '../../utils'

import providerController from './controller'

import { ChainType } from '@unisat/wallet-types'
import approvalService from 'src/services/approval'
import { bgEventBus } from 'src/utils/eventBus'

class UnlockManager {
  private unlockPromise: Promise<any> | null = null
  private isUnlocking = false

  async getUnlockPromise(): Promise<any> {
    if (keyringService.memStore.getState().isUnlocked) {
      return Promise.resolve()
    }

    if (this.isUnlocking && this.unlockPromise) {
      return this.unlockPromise
    }

    this.isUnlocking = true
    this.unlockPromise = approvalService.requestApproval({ lock: true }).finally(() => {
      this.isUnlocking = false
      this.unlockPromise = null
    })

    return this.unlockPromise
  }
}

const unlockManager = new UnlockManager()

const isSignApproval = (type: string) => {
  const SIGN_APPROVALS = ['SignText', 'SignPsbt', 'SignTx', 'SignData', 'SignLamport']
  return SIGN_APPROVALS.includes(type)
}
const windowHeight = 600
const flow = new PromiseFlow()
const flowContext = flow
  .use(async (ctx, next) => {
    // check method
    const {
      data: { method },
    } = ctx.request
    ctx.mapMethod = underline2Camelcase(method)

    if (!providerController[ctx.mapMethod]) {
      throw new WalletError(ErrorCodes.METHOD_NOT_FOUND, `Method [${method}] not found`)
    }

    return next()
  })
  .use(async (ctx, next) => {
    const { mapMethod } = ctx
    if (!Reflect.getMetadata('SAFE', providerController, mapMethod)) {
      // check lock
      const isUnlock = keyringService.memStore.getState().isUnlocked

      if (!isUnlock) {
        ctx.request.requestedApproval = true
        await unlockManager.getUnlockPromise()
      }
    }

    return next()
  })
  .use(async (ctx, next) => {
    // check connect
    const {
      request: {
        session: { origin, name, icon },
      },
      mapMethod,
    } = ctx
    // if (!Reflect.getMetadata('SAFE', providerController, mapMethod)) {
    if (!['getNetwork', 'switchNetwork', 'getChain', 'switchChain'].includes(mapMethod)) {
      if (!permissionService.hasPermission(origin)) {
        if (['getAccounts'].includes(mapMethod)) {
          return []
        }
        ctx.request.requestedApproval = true
        await approvalService.requestApproval(
          {
            params: {
              method: 'connect',
              data: {},
              session: { origin, name, icon },
            },
            approvalComponent: 'Connect',
          },
          { height: windowHeight }
        )
        permissionService.addConnectedSite(origin, name, icon, ChainType.BITCOIN_MAINNET)
      }
    }

    return next()
  })
  .use(async (ctx, next) => {
    // check need approval
    const {
      request: {
        data: { params, method },
        session: { origin, name, icon },
      },
      mapMethod,
    } = ctx
    const [approvalType, condition, options = {}] =
      Reflect.getMetadata('APPROVAL', providerController, mapMethod) || []

    let skipApproval = false
    if (condition) {
      skipApproval = await condition(ctx.request)
    }

    if (approvalType && skipApproval != true) {
      ctx.request.requestedApproval = true
      ctx.approvalRes = await approvalService.requestApproval(
        {
          approvalComponent: approvalType,
          params: {
            method,
            data: params,
            session: { origin, name, icon },
          },
          origin,
        },
        { height: windowHeight }
      )
      if (isSignApproval(approvalType)) {
        permissionService.updateConnectSite(origin, { isSigned: true }, true)
      } else {
        permissionService.touchConnectedSite(origin)
      }
    }

    return next()
  })
  .use(async ctx => {
    const { approvalRes, mapMethod, request } = ctx
    // process request
    const [approvalType] = Reflect.getMetadata('APPROVAL', providerController, mapMethod) || []

    const { uiRequestComponent, ...rest } = approvalRes || {}
    const {
      session: { origin },
    } = request
    const requestDefer = Promise.resolve(
      providerController[mapMethod]({
        ...request,
        approvalRes,
      })
    )

    requestDefer
      .then(result => {
        if (isSignApproval(approvalType)) {
          bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
            method: BUS_METHODS.SIGN_FINISHED,
            params: {
              success: true,
              data: result,
            },
          })
        }
        return result
      })
      .catch((e: any) => {
        if (isSignApproval(approvalType)) {
          bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
            method: BUS_METHODS.SIGN_FINISHED,
            params: {
              success: false,
              errorMsg: JSON.stringify(e),
            },
          })
        }
      })

    async function requestApprovalLoop({ uiRequestComponent, ...rest }) {
      ctx.request.requestedApproval = true
      const res = await approvalService.requestApproval({
        approvalComponent: uiRequestComponent,
        params: rest,
        origin,
        approvalType,
      })
      if (res.uiRequestComponent) {
        return await requestApprovalLoop(res)
      } else {
        return res
      }
    }

    if (uiRequestComponent) {
      ctx.request.requestedApproval = true
      return await requestApprovalLoop({ uiRequestComponent, ...rest })
    }

    return requestDefer
  })
  .callback()

export default request => {
  const ctx: any = { request: { ...request, requestedApproval: false } }
  return flowContext(ctx).finally(() => {
    if (ctx.request.requestedApproval) {
      flow.requestedApproval = false
      // only unlock notification if current flow is an approval flow
      approvalService.unLock()
    }
  })
}
