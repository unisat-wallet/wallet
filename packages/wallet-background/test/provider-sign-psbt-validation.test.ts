import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { bitcoin } from '@unisat/wallet-bitcoin'
import { ErrorCodes } from '@unisat/wallet-shared'

vi.mock('@unisat/babylon-service', () => ({
  encodeSignature: vi.fn(),
}))
vi.mock('../src/services', () => ({
  permissionService: { hasPermission: vi.fn() },
  sessionService: { broadcastEvent: vi.fn() },
  walletApiService: {},
}))
vi.mock('../src/controllers/wallet', () => ({
  default: {
    getToSignData: vi.fn(),
  },
}))

import providerController from '../src/controllers/provider/controller'
import wallet from '../src/controllers/wallet'

const getApprovalHook = () =>
  Reflect.getMetadata('APPROVAL', providerController, 'multiSignPsbt')[1]

function createPsbtWithInputs(count: number, seed: number) {
  const psbt = new bitcoin.Psbt()
  for (let index = 0; index < count; index++) {
    psbt.addInput({
      hash: (seed * 10_000 + index).toString(16).padStart(64, '0'),
      index: 0,
    })
  }
  return psbt.toHex()
}

describe('provider batch PSBT signing validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(wallet.getToSignData).mockImplementation(async ({ psbtHex }) => ({
      psbtHex,
      toSignInputs: [],
      autoFinalized: false,
    }))
  })

  it('allows batches containing exactly 50 transactions', async () => {
    const psbtHex = new bitcoin.Psbt().toHex()
    const params: any = { psbtHexs: Array.from({ length: 50 }, () => psbtHex) }

    await getApprovalHook()({ data: { params } })

    expect(wallet.getToSignData).toHaveBeenCalledTimes(50)
    expect(params.toSignDatas).toHaveLength(50)
  })

  it('rejects batches containing more than 50 transactions before parsing', async () => {
    const params = { psbtHexs: Array.from({ length: 51 }, () => 'not-a-psbt') }

    await expect(getApprovalHook()({ data: { params } })).rejects.toMatchObject({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Cannot sign more than 50 transactions at once',
    })
    expect(wallet.getToSignData).not.toHaveBeenCalled()
    expect(params).not.toHaveProperty('toSignDatas')
  })

  it('allows batches containing exactly 1000 UTXO inputs', async () => {
    const params: any = {
      psbtHexs: [createPsbtWithInputs(500, 1), createPsbtWithInputs(500, 2)],
    }

    await getApprovalHook()({ data: { params } })

    expect(wallet.getToSignData).toHaveBeenCalledTimes(2)
    expect(params.toSignDatas).toHaveLength(2)
  })

  it('rejects batches containing more than 1000 UTXO inputs before preparing signing data', async () => {
    const params = {
      psbtHexs: [createPsbtWithInputs(500, 1), createPsbtWithInputs(501, 2)],
    }

    await expect(getApprovalHook()({ data: { params } })).rejects.toMatchObject({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Cannot sign more than 1000 UTXOs at once',
    })
    expect(wallet.getToSignData).not.toHaveBeenCalled()
    expect(params).not.toHaveProperty('toSignDatas')
  })
})
