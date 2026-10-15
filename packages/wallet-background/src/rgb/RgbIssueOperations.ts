import {
  encodeNiaContract,
  encodeNiaGenesis,
  encodeRgbContractId,
  type RgbNetwork,
} from '@unisat/rgb-service'

import type { LocalRgbServiceContext } from './RgbWalletCoordinator'

const MAX_RGB_ISSUED_SUPPLY = 0xffff_ffff_ffff_ffffn

type RgbIssueOperationsDependencies = {
  getContext: () => Promise<LocalRgbServiceContext>
  /** Re-read the recovery checkpoint before constructing a new issuance. */
  refreshRecovery?: (context: LocalRgbServiceContext) => Promise<void>
  ensureWriteLease?: (context: LocalRgbServiceContext) => Promise<void>
  syncIndexerOutbox: (context: LocalRgbServiceContext) => Promise<boolean>
  now: () => number
  assertContext?: (context: LocalRgbServiceContext) => Promise<void>
}

export type RgbIssueNiaParams = {
  orderId?: string
  ticker: string
  name: string
  precision: number
  amounts: Array<number | string>
}

/** Builds and durably queues NIA issuance before attempting remote indexing. */
export class RgbIssueOperations {
  constructor(private readonly dependencies: RgbIssueOperationsDependencies) {}

  async issueNia(params: RgbIssueNiaParams): Promise<{
    assetId: string
    genesis: string
    contract: string
    pendingConfirmation: boolean
    syncPending: boolean
  }> {
    const context = await this.dependencies.getContext()
    const { service, wallet } = context
    await this.dependencies.refreshRecovery?.(context)
    await this.dependencies.ensureWriteLease?.(context)
    await this.dependencies.assertContext?.(context)
    await service.sync()
    await this.dependencies.assertContext?.(context)
    const snapshot = service.getSnapshot()
    if (params.orderId) {
      const previous = service.getIssueHistory().find(issue => issue.orderId === params.orderId)
      if (previous) {
        return {
          assetId: previous.assetId,
          genesis: '',
          contract: '',
          pendingConfirmation: previous.chainStatus !== 'confirmed',
          syncPending: service.getPendingIssues().some(issue => issue.assetId === previous.assetId),
        }
      }
    }
    const amounts = params.amounts.map(value => toPositiveAtomicAmount(value))
    if (!amounts.length) throw new Error('RGB issuance requires at least one allocation')
    if (amounts.reduce((total, amount) => total + amount, 0n) > MAX_RGB_ISSUED_SUPPLY) {
      throw new Error('RGB issuance total supply exceeds the maximum u64 value')
    }
    const funding = service.getAvailableIssueUtxos()
    if (funding.length < amounts.length) throw new Error('Not enough unallocated RGB funding UTXOs')

    const selectedFunding = funding.slice(0, amounts.length)
    const firstFunding = selectedFunding[0]
    if (!firstFunding) throw new Error('Not enough unallocated RGB funding UTXOs')
    const issuedAt = Math.floor(this.dependencies.now() / 1000)
    const genesis = encodeNiaGenesis({
      ticker: params.ticker,
      name: params.name,
      precision: params.precision,
      timestamp: issuedAt,
      network: wallet.network as RgbNetwork,
      allocations: amounts.map((amount, index) => {
        const fundingUtxo = selectedFunding[index]
        if (!fundingUtxo) throw new Error('Not enough unallocated RGB funding UTXOs')
        return {
          txid: fundingUtxo.outpoint.txid,
          vout: fundingUtxo.outpoint.vout,
          blinding: randomU64(),
          amount,
        }
      }),
    })
    const assetId = encodeRgbContractId(genesis.assetId)
    const contract = encodeNiaContract(genesis)
    const issued = new Map(
      selectedFunding.map((utxo, index) => {
        const amount = amounts[index]
        if (amount === undefined) throw new Error('RGB issuance allocation is incomplete')
        return [
          `${utxo.outpoint.txid}:${utxo.outpoint.vout}`,
          {
            assetId,
            amount: amount.toString(),
            // A locally issued NIA is valid as soon as its genesis outpoint
            // is in the mempool. Mark it spendable so the issuer can create
            // a child RGB transfer without waiting for the funding parent to
            // confirm.
            settled: true,
            spendable: true,
            opId: Buffer.from(genesis.assetId).toString('hex'),
            assignmentIndex: genesis.allocationIndexes.indexOf(index),
            assignmentType: 4000,
          },
        ]
      })
    )
    const outpoints = snapshot.utxos.map(utxo => {
      const allocation = issued.get(`${utxo.outpoint.txid}:${utxo.outpoint.vout}`)
      return {
        ...utxo,
        allocations: [...utxo.allocations, ...(allocation ? [allocation] : [])],
      }
    })
    await service.queueIssue({
      assetId,
      ...(params.orderId ? { orderId: params.orderId } : {}),
      contract: contract.strict,
      genesis: genesis.strict,
      asset: {
        ticker: params.ticker,
        name: params.name,
        precision: params.precision,
        schema: 'NIA',
        issuedSupply: amounts.reduce((total, amount) => total + amount, 0n).toString(),
        timestamp: issuedAt,
      },
      utxoSync: { txid: firstFunding.outpoint.txid, outpoints },
    })
    const syncPending = !(await this.dependencies.syncIndexerOutbox(context))
    const pendingConfirmation = selectedFunding.some(utxo => utxo.chainStatus !== 'confirmed')
    return {
      assetId,
      genesis: Buffer.from(genesis.strict).toString('base64'),
      contract: Buffer.from(contract.strict).toString('base64'),
      // An unconfirmed genesis is still usable for RGB transitions, but the
      // UI must not label the issuance confirmed until Bitcoin confirms it.
      pendingConfirmation,
      syncPending,
    }
  }
}

function toPositiveAtomicAmount(value: number | string): bigint {
  try {
    const amount = BigInt(value)
    if (amount <= 0n) throw new Error('not positive')
    return amount
  } catch {
    throw new Error('RGB issuance amounts must be positive unsigned integers')
  }
}

function randomU64(): bigint {
  const bytes = new Uint8Array(8)
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure RGB random generation is unavailable')
  }
  globalThis.crypto.getRandomValues(bytes)
  return bytes.reduce((value, byte, index) => value | (BigInt(byte) << BigInt(index * 8)), 0n)
}
