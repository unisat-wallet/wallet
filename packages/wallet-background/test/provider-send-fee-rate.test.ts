import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_FEE_RATE } from '@unisat/base-utils'

vi.mock('@unisat/babylon-service', () => ({
  arbitrarySignDocToBytesHex: vi.fn(),
  directSignDocToBytesHex: vi.fn(),
  encodeSignature: vi.fn(),
}))

vi.mock('../src/services', () => ({
  permissionService: {},
  sessionService: {},
  walletApiService: {},
}))

vi.mock('../src/controllers/wallet', () => ({
  default: {
    createSendBTCPsbt: vi.fn(),
    createSendInscriptionPsbt: vi.fn(),
    createSendRunesPsbt: vi.fn(),
  },
}))

import providerController from '../src/controllers/provider/controller'
import wallet from '../src/controllers/wallet'

const sends = [
  {
    method: 'sendBitcoin',
    params: { sendBitcoinParams: { toAddress: 'recipient', satoshis: 1000 } },
    create: wallet.createSendBTCPsbt,
    field: 'sendBitcoinParams',
  },
  {
    method: 'sendInscription',
    params: { sendInscriptionParams: { toAddress: 'recipient', inscriptionId: 'inscription' } },
    create: wallet.createSendInscriptionPsbt,
    field: 'sendInscriptionParams',
  },
  {
    method: 'sendRunes',
    params: { sendRunesParams: { toAddress: 'recipient', runeid: 'rune', amount: '1' } },
    create: wallet.createSendRunesPsbt,
    field: 'sendRunesParams',
  },
] as const

describe('provider send fee rates', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(sends)('rejects invalid $method fee rates before constructing a PSBT', async ({ method, params, create, field }) => {
    const approval = Reflect.getMetadata('APPROVAL', providerController, method)

    for (const feeRate of [-1, 0, MAX_FEE_RATE + 1, '2', {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      const request = { data: { params: { [field]: { ...params[field], feeRate } } } }
      await expect(approval[1](request)).rejects.toThrow('fee rate must be between')
    }

    expect(create).not.toHaveBeenCalled()
  })
})
