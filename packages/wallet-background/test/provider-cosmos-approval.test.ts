import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePubkey, makeAuthInfoBytes } from '@cosmjs/proto-signing'
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx.js'
import { TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js'

vi.mock('@unisat/babylon-service', async () => import('../../babylon-service/src/cosmos/utils'))
vi.mock('../src/services', () => ({
  keyringService: { memStore: { getState: vi.fn(() => ({ isUnlocked: true })) } },
  permissionService: {
    hasPermission: vi.fn(() => true),
    touchConnectedSite: vi.fn(),
    addConnectedSite: vi.fn(),
  },
  sessionService: {},
  walletApiService: {},
}))
vi.mock('../src/controllers/wallet', async () => {
  const {
    arbitrarySignDocToBytesHex,
    validateCosmosDirectSignDoc,
  } = await import('../../babylon-service/src/cosmos/utils')
  return {
    default: {
      cosmosChainInfoMap: { 'bbn-1': {} },
      prepareCosmosDirectSignRequest: vi.fn(async ({ chainId, signDoc }) =>
        validateCosmosDirectSignDoc(signDoc, { chainId })
      ),
      prepareCosmosArbitrarySignRequest: vi.fn(
        async ({ signerAddress, data }: { signerAddress: string; data: string }) => ({
          normalizedData: data,
          signBytesHex: arbitrarySignDocToBytesHex(signerAddress, data),
        })
      ),
      getCosmosKeyring: vi.fn(async () => ({
        getKey: () => ({
          name: 'Test',
          algo: 'secp256k1',
          bech32Address: signerAddress,
          address: new Uint8Array([1, 2, 3]),
          pubKey: new Uint8Array([2, 4, 6]),
          isNanoLedger: false,
        }),
      })),
    },
  }
})
vi.mock('src/services/approval', () => ({
  default: { requestApproval: vi.fn(), unLock: vi.fn() },
}))
vi.mock('src/utils/eventBus', () => ({ bgEventBus: { emit: vi.fn() } }))

import rpcFlow from '../src/controllers/provider/rpcFlow'
import approvalService from 'src/services/approval'
import { keyringService, permissionService } from '../src/services'
import {
  directSignDocToBytesHex,
  arbitrarySignDocToBytesHex,
} from '../../babylon-service/src/cosmos/utils'

const signerAddress = 'bbn1test'
const publicKey = new Uint8Array([0x02, ...new Uint8Array(32).fill(0x11)])
const signDoc = () => {
  const message = MsgSend.fromPartial({
    fromAddress: signerAddress,
    toAddress: 'bbn1recipient',
    amount: [{ denom: 'ubbn', amount: '12' }],
  })
  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({
      messages: [
        {
          typeUrl: '/cosmos.bank.v1beta1.MsgSend',
          value: MsgSend.encode(message).finish(),
        },
      ],
    })
  ).finish()
  const pubkey = encodePubkey({
    type: 'tendermint/PubKeySecp256k1',
    value: Buffer.from(publicKey).toString('base64'),
  })
  const authInfoBytes = makeAuthInfoBytes([{ pubkey, sequence: 0 }], [], 200000)
  return { bodyBytes, authInfoBytes, chainId: 'bbn-1', accountNumber: '0' }
}
const request = (method: string, params: any) => ({
  data: { method, params: { chainId: 'bbn-1', ...params } },
  session: { origin: 'https://dapp.example', name: 'Test', icon: '' },
})

describe('Cosmos approval payload binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(keyringService.memStore.getState).mockReturnValue({ isUnlocked: true } as any)
    vi.mocked(permissionService.hasPermission).mockReturnValue(true)
    vi.mocked(approvalService.requestApproval).mockResolvedValue({
      publicKey: `02${'11'.repeat(32)}`,
      signature: '22'.repeat(64),
    })
  })

  it('requests wallet unlock before returning the Cosmos key', async () => {
    vi.mocked(keyringService.memStore.getState).mockReturnValue({ isUnlocked: false } as any)
    vi.mocked(approvalService.requestApproval).mockResolvedValue(undefined)

    await expect(rpcFlow(request('cosmos_getKey', {}))).resolves.toMatchObject({
      bech32Address: signerAddress,
      address: '1,2,3',
      pubKey: '2,4,6',
    })

    expect(approvalService.requestApproval).toHaveBeenCalledTimes(1)
    expect(approvalService.requestApproval).toHaveBeenCalledWith({ lock: true })
  })

  it('rejects an unsupported Cosmos network before any connection approval', async () => {
    vi.mocked(permissionService.hasPermission).mockReturnValue(false)

    await expect(rpcFlow(request('cosmos_enable', { chainId: 'cosmoshub-4' }))).rejects.toThrow(
      'Unsupported Cosmos network: cosmoshub-4'
    )

    expect(approvalService.requestApproval).not.toHaveBeenCalled()
    expect(permissionService.addConnectedSite).not.toHaveBeenCalled()
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
    expect(approval.params.data).toEqual(expect.objectContaining({
      chainId: 'bbn-1',
      signerAddress,
      signDoc: {
        ...signDoc(),
      },
      signBytesHex: directSignDocToBytesHex(signDoc()),
    }))
    expect(approval.params.data.summary.messages[0]).toMatchObject({
      type: '/cosmos.bank.v1beta1.MsgSend',
      signer: signerAddress,
      recipient: 'bbn1recipient',
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
        type: 'string',
        signDoc: signDoc(),
        signBytesHex: 'deadbeef',
        chainId: 'bbn-1',
      })
    )
    const approval = vi.mocked(approvalService.requestApproval).mock.calls[0][0] as any
    expect(approval.params.method).toBe('cosmos_signArbitrary')
    expect(approval.params.data).toEqual({
      chainId: 'bbn-1',
      signerAddress,
      dataType: 'string',
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
