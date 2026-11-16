import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { bitcoin } from '@unisat/wallet-bitcoin'
import { ErrorCodes, KeyringType } from '@unisat/wallet-shared'

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
    getCurrentAccount: vi.fn(),
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

function createExternalSigningRequest() {
  const signerPubkey = Buffer.from(
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    'hex'
  )
  const sourcePsbt = new bitcoin.Psbt()
    .addInput({
      hash: '11'.repeat(32),
      index: 0,
      sequence: 0xfffffffd,
      sighashType: bitcoin.Transaction.SIGHASH_ALL,
      witnessUtxo: {
        script: bitcoin.payments.p2wpkh({ pubkey: signerPubkey }).output!,
        value: 10_000,
      },
    })
    .addOutput({ script: Buffer.from('6a', 'hex'), value: 0 })
  return {
    sourcePsbt,
    params: {
      toSignDatas: [{ psbtHex: sourcePsbt.toHex(), toSignInputs: [], autoFinalized: false }],
    },
  }
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

describe('external PSBT signing result validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const externalKeyringTypes = [
    KeyringType.ReadonlyKeyring,
    KeyringType.KeystoneKeyring,
    KeyringType.ColdWalletKeyring,
  ]

  it.each(externalKeyringTypes)('accepts an unchanged PSBT from %s', async type => {
    const { sourcePsbt, params } = createExternalSigningRequest()
    vi.mocked(wallet.getCurrentAccount).mockResolvedValue({ type } as any)

    await expect(
      providerController.signPsbt({
        data: { params },
        approvalRes: [{ psbtHex: sourcePsbt.toHex() }],
      } as any)
    ).resolves.toBe(sourcePsbt.toHex())
  })

  it.each(externalKeyringTypes)(
    'rejects transaction header and sighash changes from %s',
    async type => {
      vi.mocked(wallet.getCurrentAccount).mockResolvedValue({ type } as any)
      const mutations = [
        (psbt: bitcoin.Psbt) => psbt.setVersion(1),
        (psbt: bitcoin.Psbt) => psbt.setLocktime(500),
        (psbt: bitcoin.Psbt) => {
          psbt.data.inputs[0]!.sighashType = bitcoin.Transaction.SIGHASH_NONE
        },
      ]

      for (const mutate of mutations) {
        const { sourcePsbt, params } = createExternalSigningRequest()
        const candidate = bitcoin.Psbt.fromHex(sourcePsbt.toHex())
        mutate(candidate)

        await expect(
          providerController.signPsbt({
            data: { params },
            approvalRes: [{ psbtHex: candidate.toHex() }],
          } as any)
        ).rejects.toThrow('invalid psbt')
      }
    }
  )

})
