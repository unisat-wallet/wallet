/**
 * RGB-related API methods
 */

import type { BaseHttpClient } from '../client/http-client'
import { normalizeRgbAssetId, normalizeRgbAssetRecord } from './rgb-contract-id'
import type {
  RgbActivityItem,
  RgbAddressActivityQuery,
  RgbAssetActivityQuery,
  RgbAssetDetail,
  RgbAssetMetadataSyncRequest,
  RgbBalance,
  RgbPageResponse,
  RgbConsignmentPublishRequest,
  RgbConsignmentClaimRequest,
  RgbConsignmentClaimResult,
  RgbClaimedConsignmentsRequest,
  RgbClaimedConsignmentsResult,
  RgbConsignmentHistoryRequest,
  RgbConsignmentHistoryResult,
  RgbTransferSyncRequest,
  RgbUtxoSyncRequest,
  RgbWalletUtxoSnapshotRequest,
  RgbWalletUtxoSnapshotResult,
  RgbRequestAuthenticator,
  RgbReceiveTransferSyncRequest,
  RgbRecoveryCheckpointReadRequest,
  RgbRecoveryCheckpointReadResult,
  RgbRecoveryCheckpointSaveRequest,
  RgbTransactionStatusRequest,
  RgbTransactionStatusResult,
} from '../types'

export class RgbService {
  private authenticator: RgbRequestAuthenticator | undefined
  private readonly rgbAssetDetailCache = new Map<string, Promise<RgbAssetDetail>>()

  constructor(private readonly httpClient: BaseHttpClient) {}

  setRequestAuthenticator(authenticator?: RgbRequestAuthenticator) {
    this.authenticator = authenticator
  }

  /**
   * Get address RGB asset list
   */
  async getRgbAssetList(
    address: string,
    page: number,
    pageSize: number
  ): Promise<RgbPageResponse<RgbBalance>> {
    const response = await this.httpClient.get(
      `/v5/rgb/address/${encodeURIComponent(address)}/assets`,
      {
        query: { page, pageSize },
      }
    )

    const result = this.normalizeListResponse<RgbBalance>(response)
    return {
      ...result,
      list: await Promise.all(result.list.map(item => this.enrichRgbAssetListItem(item))),
    }
  }

  /**
   * Get address RGB asset balance
   */
  async getRgbAssetBalance(address: string, assetId: string): Promise<RgbBalance> {
    const response = await this.httpClient.get(
      `/v5/rgb/address/${encodeURIComponent(address)}/assets/${encodeURIComponent(normalizeRgbAssetId(assetId))}`
    )
    return normalizeRgbAssetRecord(response)
  }

  /**
   * Index public metadata already known by the local RGB contract. This does
   * not transmit contract bytes, keys, descriptors, or wallet derivation data.
   */
  async syncRgbAssetMetadata(params: RgbAssetMetadataSyncRequest): Promise<void> {
    await this.privatePost('/v5/rgb/assets/sync', {
      ...params,
      asset: { ...params.asset, assetId: normalizeRgbAssetId(params.asset.assetId) },
    })
  }

  async saveRgbRecoveryCheckpoint(params: RgbRecoveryCheckpointSaveRequest): Promise<void> {
    await this.privatePost('/v5/rgb/recovery/checkpoint', params)
  }

  async getRgbRecoveryCheckpoint(
    params: RgbRecoveryCheckpointReadRequest
  ): Promise<RgbRecoveryCheckpointReadResult> {
    return this.privatePost('/v5/rgb/recovery/checkpoint/read', params)
  }

  /**
   * Get RGB asset detail
   */
  async getRgbAssetDetail(assetId: string): Promise<RgbAssetDetail> {
    const response = await this.httpClient.get(
      `/v5/rgb/assets/${encodeURIComponent(normalizeRgbAssetId(assetId))}`
    )
    return normalizeRgbAssetRecord(response)
  }

  private async enrichRgbAssetListItem(item: RgbBalance): Promise<RgbBalance> {
    if (!needsRgbAssetMetadata(item) || !item.assetId) return item

    try {
      const detail = await this.getCachedRgbAssetDetail(item.assetId)
      return {
        ...item,
        ...(detail.name ? { name: detail.name } : {}),
        ...(detail.ticker ? { ticker: detail.ticker } : {}),
        ...(detail.precision === undefined ? {} : { precision: detail.precision }),
        ...(detail.schema === undefined ? {} : { schema: detail.schema }),
        ...(detail.issuedSupply === undefined ? {} : { issuedSupply: detail.issuedSupply }),
      }
    } catch {
      // The list remains usable when the optional metadata fallback is unavailable.
      return item
    }
  }

  private getCachedRgbAssetDetail(assetId: string): Promise<RgbAssetDetail> {
    const cached = this.rgbAssetDetailCache.get(assetId)
    if (cached) return cached

    const request = this.getRgbAssetDetail(assetId).catch(error => {
      this.rgbAssetDetailCache.delete(assetId)
      throw error
    })
    this.rgbAssetDetailCache.set(assetId, request)
    return request
  }

  /**
   * Get RGB asset activity list
   */
  async getRgbAssetActivity(
    assetId: string,
    { page, pageSize, address, type }: RgbAssetActivityQuery
  ): Promise<RgbPageResponse<RgbActivityItem>> {
    const response = await this.httpClient.get(
      `/v5/rgb/assets/${encodeURIComponent(normalizeRgbAssetId(assetId))}/activity`,
      {
        query: { page, pageSize, address, type },
      }
    )

    return this.normalizeListResponse<RgbActivityItem>(response)
  }

  /**
   * Get address RGB activity list
   */
  async getAddressRgbActivity(
    address: string,
    { page, pageSize, assetId, type }: RgbAddressActivityQuery
  ): Promise<RgbPageResponse<RgbActivityItem>> {
    const normalizedAssetId = assetId ? normalizeRgbAssetId(assetId) : undefined
    const response = await this.httpClient.get(
      `/v5/rgb/address/${encodeURIComponent(address)}/activity`,
      {
        query: { page, pageSize, assetId: normalizedAssetId, type },
      }
    )

    return this.normalizeListResponse<RgbActivityItem>(response)
  }

  /**
   * Index RGB funding outputs after the wallet has broadcast a locally built
   * Bitcoin transaction. This request intentionally contains no xpub.
   */
  async syncRgbUtxos(params: RgbUtxoSyncRequest): Promise<void> {
    await this.privatePost('/v5/rgb/utxos/sync', normalizeUtxoSyncRequest(params))
  }

  async replaceRgbUtxos(params: RgbUtxoSyncRequest): Promise<void> {
    await this.privatePost('/v5/rgb/utxos/replace', normalizeUtxoSyncRequest(params))
  }

  /**
   * Read colored UTXOs by funding address. The wallet locally chooses inputs
   * and builds the RGB transaction from this snapshot.
   */
  async getRgbWalletUtxoSnapshot(
    params: RgbWalletUtxoSnapshotRequest
  ): Promise<RgbWalletUtxoSnapshotResult> {
    const response = await this.privatePost<RgbWalletUtxoSnapshotResult>('/v5/rgb/utxos/snapshot', params)
    return {
      ...response,
      utxos: response.utxos.map(utxo => ({
        ...utxo,
        allocations: utxo.allocations.map(allocation => ({
          ...allocation,
          assetId: normalizeRgbAssetId(allocation.assetId),
        })),
      })),
    }
  }

  async getRgbTransactionStatus(
    txid: string,
    params: RgbTransactionStatusRequest
  ): Promise<RgbTransactionStatusResult> {
    return this.privatePost(`/v5/rgb/chain/transactions/${encodeURIComponent(txid)}`, params)
  }

  /**
   * Fetch opaque history required for local consignment construction. This is
   * a transport read: no wallet key material or transaction parameters leave
   * the extension.
   */
  async getRgbConsignmentHistory(
    params: RgbConsignmentHistoryRequest
  ): Promise<RgbConsignmentHistoryResult> {
    const response = await this.privatePost<RgbConsignmentHistoryResult>(
      '/v5/rgb/consignments/history',
      { ...params, assetId: normalizeRgbAssetId(params.assetId) }
    )
    return { ...response, assetId: normalizeRgbAssetId(response.assetId) }
  }

  async publishRgbConsignment(params: RgbConsignmentPublishRequest): Promise<void> {
    await this.privatePost('/v5/rgb/consignments/publish', {
      ...params,
      assetId: normalizeRgbAssetId(params.assetId),
    })
  }

  /** Associate an opaque transport payload with a local RGB funding address. */
  async claimRgbConsignments(params: RgbConsignmentClaimRequest): Promise<RgbConsignmentClaimResult> {
    return this.privatePost('/v5/rgb/consignments/claim', params)
  }

  async getClaimedRgbConsignments(params: RgbClaimedConsignmentsRequest): Promise<RgbClaimedConsignmentsResult> {
    return this.privatePost('/v5/rgb/consignments/received', params)
  }

  async syncRgbTransfer(params: RgbTransferSyncRequest): Promise<void> {
    await this.privatePost('/v5/rgb/transfers/sync', {
      ...params,
      consignments: params.consignments.map(consignment => ({
        ...consignment,
        assetId: normalizeRgbAssetId(consignment.assetId),
      })),
    })
  }

  async syncRgbReceiveTransfer(params: RgbReceiveTransferSyncRequest): Promise<void> {
    await this.privatePost('/v5/rgb/transfers/receive', {
      ...params,
      assetId: normalizeRgbAssetId(params.assetId),
    })
  }

  private async privatePost<T>(path: string, body: unknown): Promise<T> {
    if (!this.authenticator) {
      throw new Error('RGB request authentication is not configured')
    }
    const auth = await this.authenticator({ method: 'POST', path, body })
    return this.httpClient.post<T>(path, { ...(body as Record<string, unknown>), auth })
  }

  private normalizeListResponse<T>(response: any): RgbPageResponse<T> {
    if (Array.isArray(response)) {
      return {
        total: response.length,
        list: response.map(item => normalizeRgbAssetRecord(item)),
      }
    }

    const payload = this.getListPayload(response)
    const list = payload?.list ?? payload?.items ?? payload?.data ?? []
    const total =
      payload?.total ??
      payload?.totalCount ??
      payload?.count ??
      (Array.isArray(list) ? list.length : 0)

    return {
      total,
      list: Array.isArray(list) ? list.map(item => normalizeRgbAssetRecord(item)) : [],
    }
  }

  private getListPayload(response: any) {
    if (
      response?.data &&
      !Array.isArray(response.data) &&
      typeof response.data === 'object' &&
      (response.data.list || response.data.items || response.data.data || 'total' in response.data)
    ) {
      return response.data
    }

    return response
  }
}

function normalizeUtxoSyncRequest(params: RgbUtxoSyncRequest): RgbUtxoSyncRequest {
  return {
    ...params,
    outpoints: params.outpoints.map(outpoint => ({
      ...outpoint,
      allocations: outpoint.allocations.map(allocation => ({
        ...allocation,
        assetId: normalizeRgbAssetId(allocation.assetId),
      })),
    })),
  }
}

function needsRgbAssetMetadata(item: RgbBalance): boolean {
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  const ticker = typeof item.ticker === 'string' ? item.ticker.trim() : ''
  return (
    !name ||
    !ticker ||
    (name === 'RGB' && ticker === 'RGB') ||
    item.precision === undefined
  )
}
