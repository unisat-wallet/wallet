import { describe, expect, it, vi } from 'vitest'
import * as bitcoin from 'bitcoinjs-lib'

import {
  proxyV1Hash,
  proxyV1PublicKey,
  proxyV1Sign,
} from '../src/adapters/rgb-proxy-v1'
import { RgbSendOperations } from '../src/rgb/RgbSendOperations'

function sellerSwapFixture() {
  const psbt = new bitcoin.Psbt()
    .addInput({
      hash: '01'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from('5120' + '02'.repeat(32), 'hex'), value: 10_000 },
    })
    .addOutput({ script: Buffer.from('6a', 'hex'), value: 0 })
  const transferId = 'transfer-1'
  const txid = 'ab'.repeat(32)
  const privateKey = '11'.repeat(32)
  const backendPublicKey = proxyV1PublicKey(privateKey)
  const makerSignedPsbt = psbt.toBase64()
  const makerSignedPsbtHash = proxyV1Hash(psbt.toBuffer())
  const transactionCommitment = proxyV1Sign(
    privateKey,
    `rgb-sell-swap/commit/v1:${transferId}:${txid}:${makerSignedPsbtHash}`
  )
  const completed = { txid, rawTx: '', consignments: [] }
  const service = {
    getPendingTransfers: vi.fn().mockReturnValue([{
      id: transferId,
      providerBackendPublicKey: backendPublicKey,
      delivery: {
        requiresCounterpartySignature: true,
        makerSignedPsbt,
        completed,
      },
    }]),
    acceptPublishedSwap: vi.fn().mockResolvedValue(completed),
  }
  const operations = new RgbSendOperations({
    getContext: vi.fn().mockResolvedValue({ service, wallet: { fundingAddress: 'wallet' } }),
    ensureWriteLease: vi.fn(),
  } as any)
  return { operations, service, transferId, txid, transactionCommitment }
}

describe('RgbSendOperations backend-controlled seller swap', () => {
  it('accepts a bound backend commitment without returning a PSBT', async () => {
    const fixture = sellerSwapFixture()

    await expect(fixture.operations.acceptExternalSwapBroadcast({
      transferId: fixture.transferId,
      txid: fixture.txid,
      transactionCommitment: fixture.transactionCommitment,
    })).resolves.toEqual({
      transferId: fixture.transferId,
      txid: fixture.txid,
      status: 'ready_for_external_broadcast',
    })
    expect(fixture.service.acceptPublishedSwap).toHaveBeenCalledWith(
      fixture.transferId,
      fixture.txid,
      fixture.transactionCommitment
    )
  })

  it('rejects a commitment not signed by the backend bound at preparation', async () => {
    const fixture = sellerSwapFixture()

    await expect(fixture.operations.acceptExternalSwapBroadcast({
      transferId: fixture.transferId,
      txid: fixture.txid,
      transactionCommitment: '00'.repeat(64),
    })).rejects.toThrow('RGB seller swap backend commitment is invalid')
    expect(fixture.service.acceptPublishedSwap).not.toHaveBeenCalled()
  })
})
