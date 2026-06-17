/**
 * RGB-related API methods
 */

import type { BaseHttpClient } from '../client/http-client'
import type {
  RgbActivityItem,
  RgbAddressActivityQuery,
  RgbAbortVanillaTxRequest,
  RgbAbortVanillaTxResult,
  RgbAllocationSummaryRequest,
  RgbAllocationSummaryResult,
  RgbAssetActivityQuery,
  RgbAssetDetail,
  RgbBalance,
  RgbCancelReceiveInvoiceRequest,
  RgbCancelReceiveInvoiceResult,
  RgbCreateUtxosBeginRequest,
  RgbCreateUtxosEndRequest,
  RgbFundingAddressRequest,
  RgbFundingAddressResult,
  RgbIssueNiaRequest,
  RgbPageResponse,
  RgbPendingVanillaTxsRequest,
  RgbPendingVanillaTxsResult,
  RgbPendingReceiveInvoicesRequest,
  RgbPendingReceiveInvoicesResult,
  RgbReceiveInvoiceRequest,
  RgbSendBeginRequest,
  RgbSendEndRequest,
} from '../types'

export class RgbService {
  constructor(private readonly httpClient: BaseHttpClient) {}

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

    return this.normalizeListResponse<RgbBalance>(response)
  }

  async getRgbList(
    address: string,
    page: number,
    pageSize: number
  ): Promise<RgbPageResponse<RgbBalance>> {
    return this.getRgbAssetList(address, page, pageSize)
  }

  /**
   * Get address RGB asset balance
   */
  async getRgbAssetBalance(address: string, assetId: string): Promise<RgbBalance> {
    return this.httpClient.get(
      `/v5/rgb/address/${encodeURIComponent(address)}/assets/${encodeURIComponent(assetId)}`
    )
  }

  /**
   * Get RGB asset detail
   */
  async getRgbAssetDetail(assetId: string): Promise<RgbAssetDetail> {
    return this.httpClient.get(`/v5/rgb/assets/${encodeURIComponent(assetId)}`)
  }

  /**
   * Get RGB asset activity list
   */
  async getRgbAssetActivity(
    assetId: string,
    { page, pageSize, address, type }: RgbAssetActivityQuery
  ): Promise<RgbPageResponse<RgbActivityItem>> {
    const response = await this.httpClient.get(
      `/v5/rgb/assets/${encodeURIComponent(assetId)}/activity`,
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
    const response = await this.httpClient.get(
      `/v5/rgb/address/${encodeURIComponent(address)}/activity`,
      {
        query: { page, pageSize, assetId, type },
      }
    )

    return this.normalizeListResponse<RgbActivityItem>(response)
  }

  async createBlindReceiveInvoice(params: RgbReceiveInvoiceRequest): Promise<any> {
    return this.httpClient.post('/v5/rgb/receive/blind', params)
  }

  async createWitnessReceiveInvoice(params: RgbReceiveInvoiceRequest): Promise<any> {
    return this.httpClient.post('/v5/rgb/receive/witness', params)
  }

  async getPendingReceiveInvoices(
    params: RgbPendingReceiveInvoicesRequest
  ): Promise<RgbPendingReceiveInvoicesResult> {
    return this.httpClient.post('/v5/rgb/receive/pending', params)
  }

  async cancelReceiveInvoice(
    params: RgbCancelReceiveInvoiceRequest
  ): Promise<RgbCancelReceiveInvoiceResult> {
    return this.httpClient.post('/v5/rgb/receive/cancel', params)
  }

  async getRgbFundingAddress(params: RgbFundingAddressRequest): Promise<RgbFundingAddressResult> {
    return this.httpClient.post('/v5/rgb/funding-address', params)
  }

  async issueNiaAsset(params: RgbIssueNiaRequest): Promise<any> {
    return this.httpClient.post('/v5/rgb/assets/issue/nia', params)
  }

  async createRgbUtxosBegin(params: RgbCreateUtxosBeginRequest): Promise<any> {
    return this.httpClient.post('/v5/rgb/utxos/create-begin', params)
  }

  async createRgbUtxosEnd(params: RgbCreateUtxosEndRequest): Promise<any> {
    return this.httpClient.post('/v5/rgb/utxos/create-end', params)
  }

  async getPendingVanillaTxs(
    params: RgbPendingVanillaTxsRequest
  ): Promise<RgbPendingVanillaTxsResult> {
    return this.httpClient.post('/v5/rgb/utxos/pending-vanilla', params)
  }

  async abortVanillaTx(params: RgbAbortVanillaTxRequest): Promise<RgbAbortVanillaTxResult> {
    return this.httpClient.post('/v5/rgb/utxos/abort-vanilla', params)
  }

  async getRgbAllocationSummary(
    params: RgbAllocationSummaryRequest
  ): Promise<RgbAllocationSummaryResult> {
    return this.httpClient.post('/v5/rgb/utxos/allocation-summary', params)
  }

  async createSendRgbTx(params: RgbSendBeginRequest): Promise<any> {
    return this.httpClient.post('/v5/rgb/transfer/send-begin', params)
  }

  async acceptRgbTx(params: RgbSendEndRequest): Promise<any> {
    return this.httpClient.post('/v5/rgb/transfer/send-end', params)
  }

  private normalizeListResponse<T>(response: any): RgbPageResponse<T> {
    if (Array.isArray(response)) {
      return {
        total: response.length,
        list: response,
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
      list: Array.isArray(list) ? list : [],
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
