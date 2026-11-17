import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it, vi } from 'vitest'

import { RgbSendOperations } from '../src/rgb/RgbSendOperations'

describe('RgbSendOperations backend-controlled seller swap', () => {
  it('preflights the fully witnessed swap while returning the relayed PSBT', async () => {
    const psbt = new Psbt()
    psbt.addInput({
      hash: '11'.repeat(32),
      index: 0,
      witnessUtxo: { value: 1_000, script: Buffer.from(`5120${'22'.repeat(32)}`, 'hex') },
    })
    psbt.addOutput({ script: Buffer.from([0x6a]), value: 0 })
    const relayedPsbt = psbt.toHex()
    const makerSignedPsbt = psbt.clone()
    makerSignedPsbt.updateInput(0, { tapKeySig: Buffer.alloc(64, 3) })
    const completed = { txid: 'ab'.repeat(32) }
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([{
        id: 'transfer-1',
        delivery: { makerSignedPsbt: makerSignedPsbt.toHex() },
      }]),
      completePublishedSwap: vi.fn().mockResolvedValue(completed),
    }
    const operations = new RgbSendOperations({
      getContext: vi.fn().mockResolvedValue({ service, wallet: { fundingAddress: 'wallet' } }),
      ensureWriteLease: vi.fn(),
    } as any)

    const returned = await operations.prepareExternalSwapBroadcast({
      transferId: 'transfer-1',
      signedPsbt: relayedPsbt,
    })
    expect(returned).toEqual({
      transferId: 'transfer-1',
      txid: completed.txid,
      signedPsbt: expect.any(String),
      status: 'ready_for_dapp_finalize',
    })

    expect(Psbt.fromHex(returned.signedPsbt).data.inputs[0]?.tapKeySig).toBeDefined()
    const validationPsbt = Psbt.fromBase64(
      service.completePublishedSwap.mock.calls[0]![1]
    )
    expect(validationPsbt.data.inputs[0]?.finalScriptWitness).toBeDefined()
    expect(validationPsbt.extractTransaction().hasWitnesses()).toBe(true)
  })

  it('delegates ACK synchronization without accepting or returning transaction bytes', async () => {
    const result = {
      transferId: 'transfer-1',
      txid: 'ab'.repeat(32),
      status: 'receiver_acked' as const,
    }
    const service = {
      syncPublishedSwapAcknowledgement: vi.fn().mockResolvedValue(result),
    }
    const ensureWriteLease = vi.fn()
    const operations = new RgbSendOperations({
      getContext: vi.fn().mockResolvedValue({ service, wallet: { fundingAddress: 'wallet' } }),
      ensureWriteLease,
    } as any)

    await expect(operations.syncSellSwapAcknowledgement('transfer-1')).resolves.toEqual(result)
    expect(ensureWriteLease).toHaveBeenCalledWith(
      expect.objectContaining({ service }),
      { forceRenew: true }
    )
    expect(service.syncPublishedSwapAcknowledgement).toHaveBeenCalledWith('transfer-1')
  })

  it('delegates P2P buyer commitment signing under a renewed write lease', async () => {
    const result = {
      proxyTransferId: 'ab'.repeat(32),
      txid: 'cd'.repeat(32),
      buyerSignedPsbtHash: 'ef'.repeat(32),
      commitment: '12'.repeat(64),
      signedAt: 1,
    }
    const service = {
      signPublishedSwapBuyerCommitment: vi.fn().mockResolvedValue(result),
    }
    const ensureWriteLease = vi.fn()
    const operations = new RgbSendOperations({
      getContext: vi.fn().mockResolvedValue({ service, wallet: { fundingAddress: 'wallet' } }),
      ensureWriteLease,
    } as any)

    await expect(operations.signBuySwapCommit({
      transferId: 'transfer-1',
      txid: result.txid,
      buyerSignedPsbtHash: result.buyerSignedPsbtHash,
    })).resolves.toEqual(result)
    expect(ensureWriteLease).toHaveBeenCalledWith(
      expect.objectContaining({ service }),
      { forceRenew: true }
    )
  })
})
