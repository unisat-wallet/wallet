/**
 * Bitcoin-related API methods - Fully compatible with openapi.ts
 */

import type { BaseHttpClient, HttpClient } from '../client/http-client'
import type { AddressHistorySummaryPage } from '@unisat/wallet-shared'
import type {
  AddressSummary,
  BitcoinBalance,
  BitcoinBalanceV2,
  UTXO,
  DecodedPsbt,
  UtxoAssets,
  WalletConfig,
  FeeSummary,
} from '../types'

export class BitcoinService {
  constructor(private readonly httpClient: BaseHttpClient) {}

  // ========================================
  // Basic configuration and information
  // ========================================

  /**
   * Get wallet configuration
   */
  async getWalletConfig(): Promise<WalletConfig> {
    return this.httpClient.get('/v5/default/config')
  }

  /**
   * Get address summary
   */
  async getAddressSummary(address: string): Promise<AddressSummary> {
    return this.httpClient.get('/v5/address/summary', { query: { address } })
  }

  // ========================================
  // Address balance related
  // ========================================

  /**
   * Get address balance
   */
  async getAddressBalance(address: string): Promise<BitcoinBalance> {
    return this.httpClient.get('/v5/address/balance', { query: { address } })
  }

  /**
   * Get address balance V2
   */
  async getAddressBalanceV2(address: string): Promise<BitcoinBalanceV2> {
    return this.httpClient.get('/v5/address/balance2', { query: { address } })
  }

  /**
   * Get multi-address assets
   */
  async getMultiAddressAssets(addresses: string): Promise<AddressSummary[]> {
    return this.httpClient.get('/v5/address/multi-assets', { query: { addresses } })
  }

  /**
   * Get fee summary
   */
  async getFeeSummary(): Promise<FeeSummary> {
    return this.httpClient.get('/v5/default/fee-summary')
  }

  async getLowFeeSummary(): Promise<FeeSummary> {
    return this.httpClient.get('/v5/default/fee-summary?lowFee=true')
  }

  // ========================================
  // UTXO related
  // ========================================

  /**
   * Get BTC UTXOs
   */
  async getBTCUtxos(address: string): Promise<UTXO[]> {
    return this.httpClient.get('/v5/address/btc-utxo', { query: { address } })
  }

  // ========================================
  // Transaction related
  // ========================================

  /**
   * Broadcast transaction
   */
  async pushTx(rawtx: string): Promise<string> {
    return this.httpClient.post('/v5/tx/broadcast', { rawtx })
  }

  /**
   * Decode PSBT
   */
  async decodePsbt(psbtHex: string, website: string): Promise<DecodedPsbt> {
    return this.httpClient.post('/v5/tx/decode2', { psbtHex, website })
  }

  // ========================================
  // Transaction history
  // ========================================

  /**
   * Get address recent history
   */
  async getAddressRecentHistory(params: { address: string; start: number; limit: number }): Promise<AddressHistorySummaryPage> {
    return this.httpClient.get('/v5/address/history', { query: params })
  }

  // ========================================
  // Version information
  // ========================================

  // ========================================
  // Create send BTC transaction (bypass head offsets)
  // ========================================

  /**
   * Create send BTC transaction, bypassing head offsets
   */
  async createSendCoinBypassHeadOffsets(
    address: string,
    pubkey: string,
    tos: { address: string; satoshis: number }[],
    feeRate: number,
    enableRBF = true
  ) {
    return this.httpClient.post('/v5/tx/create-send-btc', {
      fromAddress: address,
      fromPubkey: pubkey,
      tos,
      feeRate,
      enableRBF,
      bypassHeadOffsets: true,
    })
  }

  /**
   * Find group assets
   */
  async findGroupAssets(
    groups: { type: number; address_arr: string[] }[]
  ): Promise<{ type: number; address_arr: string[]; satoshis_arr: number[] }[]> {
    return this.httpClient.post('/v5/address/find-group-assets', { groups })
  }

  /**
   * Decode contracts
   */
  async decodeContracts(contracts: any[], account: any): Promise<any> {
    return this.httpClient.post('/v5/contracts/decode', { contracts, account })
  }

  /**
   * Batch fetch inscription/rune/alkane assets for a list of outpoints (txid:vout).
   * Much smaller payload than sending full PSBT hex.
   */
  async getUtxoAssetsByOutpoints(outpoints: string[]): Promise<UtxoAssets[]> {
    return this.httpClient.post('/v5/utxo/assets-by-outpoints', { outpoints })
  }
}
