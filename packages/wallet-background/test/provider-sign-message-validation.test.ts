import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SignMessageType } from '@unisat/wallet-shared'

vi.mock('@unisat/babylon-service', () => ({
  arbitrarySignDocToBytesHex: vi.fn(),
  directSignDocToBytesHex: vi.fn(),
  encodeSignature: vi.fn(),
}))
vi.mock('../src/services', () => ({
  permissionService: { hasPermission: vi.fn() },
  sessionService: { broadcastEvent: vi.fn() },
  walletApiService: {},
}))
vi.mock('../src/controllers/wallet', () => ({
  default: {
    getCurrentAccount: vi.fn(),
    getNetworkType: vi.fn(),
  },
}))

import providerController from '../src/controllers/provider/controller'

const getApprovalHook = (method: 'signMessage' | 'multiSignMessage') =>
  Reflect.getMetadata('APPROVAL', providerController, method)[1]

describe('provider message signing validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([[104, 105], new Uint8Array([104, 105]), 123, { value: 'hi' }, null])(
    'rejects non-string single-sign text %#',
    async text => {
      const params = { text, type: SignMessageType.ECDSA }

      await expect(getApprovalHook('signMessage')({ data: { params } })).rejects.toThrow(
        'text is required and must be a string'
      )
      expect(params).not.toHaveProperty('toSignMessages')
    }
  )

  it('rejects non-string text within a multi-sign request', async () => {
    const params = {
      messages: [
        { text: 'first message', type: SignMessageType.ECDSA },
        { text: [104, 105], type: SignMessageType.BIP322_SIMPLE },
      ],
    }

    await expect(getApprovalHook('multiSignMessage')({ data: { params } })).rejects.toThrow(
      'text is required and must be a string'
    )
    expect(params).not.toHaveProperty('toSignMessages')
  })

  it('binds valid string text unchanged into the approval payload', async () => {
    const params: any = { text: 'hi', type: SignMessageType.ECDSA }

    await getApprovalHook('signMessage')({ data: { params } })

    expect(params.toSignMessages).toEqual([{ text: 'hi', type: SignMessageType.ECDSA }])
  })
})
