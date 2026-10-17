import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@unisat/babylon-service', async () => import('../../babylon-service/src/cosmos/utils'))
vi.mock('../src/services', () => ({
  keyringService: { memStore: { getState: () => ({ isUnlocked: true }) } },
  permissionService: { hasPermission: () => true, touchConnectedSite: vi.fn() },
  sessionService: {},
  walletApiService: {},
}))
vi.mock('../src/controllers/wallet', () => ({ default: {} }))
vi.mock('src/services/approval', () => ({
  default: { requestApproval: vi.fn(), unLock: vi.fn() },
}))
vi.mock('src/utils/eventBus', () => ({ bgEventBus: { emit: vi.fn() } }))

import rpcFlow from '../src/controllers/provider/rpcFlow'
import approvalService from 'src/services/approval'
import {
  directSignDocToBytesHex,
  arbitrarySignDocToBytesHex,
} from '../../babylon-service/src/cosmos/utils'

const signDoc = () => ({
  bodyBytes: { 0: 10, 1: 0 },
  authInfoBytes: { 0: 18, 1: 0 },
  chainId: 'bbn-1',
  accountNumber: '0',
})
const signerAddress = 'bbn1test'
const request = (method: string, params: any) => ({
  data: { method, params },
  session: { origin: 'https://dapp.example', name: 'Test', icon: '' },
})

describe('Cosmos approval payload binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(approvalService.requestApproval).mockResolvedValue({
      publicKey: `02${'11'.repeat(32)}`,
      signature: '22'.repeat(64),
    })
  })

  it('strips injected display text and bytes before requesting Direct approval', async () => {
    const original = {
      signerAddress,
      signDoc: { ...signDoc(), data: 'Hidden transaction' },
      data: 'Sign in for free',
      signBytesHex: 'deadbeef',
      method: 'cosmos_signArbitrary',
    }
    const result = await rpcFlow(request('cosmos_signDirect', original))
    const approval = vi.mocked(approvalService.requestApproval).mock.calls[0][0] as any
    expect(approval.params.method).toBe('cosmos_signDirect')
    expect(approval.params.data).toEqual({
      signerAddress,
      signDoc: {
        ...signDoc(),
        bodyBytes: new Uint8Array([10, 0]),
        authInfoBytes: new Uint8Array([18, 0]),
      },
      signBytesHex: directSignDocToBytesHex(signDoc()),
    })
    expect(approval.params.data).not.toBe(original)
    expect(result.signed).toEqual(approval.params.data.signDoc)
  })

  it('preserves normal Direct requests', async () => {
    await rpcFlow(request('cosmos_signDirect', { signerAddress, signDoc: signDoc() }))
    const approval = vi.mocked(approvalService.requestApproval).mock.calls[0][0] as any
    expect(approval.params.data.signBytesHex).toBe(directSignDocToBytesHex(signDoc()))
    expect(approval.params.data).not.toHaveProperty('data')
  })

  it('preserves Arbitrary text while removing injected Direct fields', async () => {
    const data = 'Verify wallet ownership'
    await rpcFlow(
      request('cosmos_signArbitrary', {
        signerAddress,
        data,
        signDoc: signDoc(),
        signBytesHex: 'deadbeef',
        chainId: 'bbn-1',
      })
    )
    const approval = vi.mocked(approvalService.requestApproval).mock.calls[0][0] as any
    expect(approval.params.method).toBe('cosmos_signArbitrary')
    expect(approval.params.data).toEqual({
      signerAddress,
      data,
      signBytesHex: arbitrarySignDocToBytesHex(signerAddress, data),
    })
  })

  it.each([null, undefined, [], 'Sign in'])(
    'rejects invalid Direct signDoc %s before approval',
    async signDoc => {
      await expect(
        rpcFlow(request('cosmos_signDirect', { signerAddress, signDoc }))
      ).rejects.toThrow('Invalid Cosmos signDoc')
      expect(approvalService.requestApproval).not.toHaveBeenCalled()
    }
  )

  it.each(['bodyBytes', 'authInfoBytes'] as const)(
    'rejects a sparse Direct %s object before approval',
    async field => {
      await expect(
        rpcFlow(
          request('cosmos_signDirect', {
            signerAddress,
            signDoc: { ...signDoc(), [field]: { 1000000000: 1 } },
          })
        )
      ).rejects.toThrow('Invalid byte array index')
      expect(approvalService.requestApproval).not.toHaveBeenCalled()
    }
  )

  it.each(['constructor', 'toString', 'valueOf', '__proto__'])(
    'rejects inherited provider method %s',
    async method => {
      await expect(rpcFlow(request(method, {}))).rejects.toThrow('not found')
      expect(approvalService.requestApproval).not.toHaveBeenCalled()
    }
  )
})
