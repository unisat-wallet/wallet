/**
 * BRC20-related API methods - Fully compatible with openapi.ts
 */

import type { BaseHttpClient } from '../client/http-client'
import { Brc20TickFilter } from '@unisat/wallet-shared'
import type {
  AddressTokenSummary,
  BRC20HistoryItem,
  InscribeOrder,
  TickPriceItem,
  TokenBalance,
  TokenTransfer,
  UserToSignInput,
} from '../types'

export class BRC20Service {
  constructor(private readonly httpClient: BaseHttpClient) {}

  private resolveTicker(ticker: string, tickerHex?: string): string {
    if (!tickerHex) {
      return ticker
    }
    if (!/^[0-9a-fA-F]+$/.test(tickerHex) || tickerHex.length % 2 !== 0) {
      return ticker
    }
    return Buffer.from(tickerHex, 'hex').toString('utf-8')
  }

  // ========================================
  // BRC20 token list and balance
  // ========================================

  /**
   * Get address BRC20 token list
   */
  async getBRC20List({
    address,
    cursor,
    size,
    tickFilter,
  }: {
    address: string
    cursor: number
    size: number
    tickFilter?: Brc20TickFilter.TICK_BYTES_4_5_6
  }): Promise<{ list: TokenBalance[]; total: number }> {
    return this.httpClient.get('/v5/brc20/list', {
      query: {
        address,
        cursor,
        size,
        ...(tickFilter === undefined ? {} : { tick_filter: tickFilter }),
      },
    })
  }

  /**
   * Get address specific token summary
   */
  async getAddressTokenSummary({
    address,
    ticker,
    tickerHex,
  }: {
    address: string
    ticker: string
    tickerHex?: string
  }): Promise<AddressTokenSummary> {
    const originTicker = this.resolveTicker(ticker, tickerHex)
    const response: AddressTokenSummary = await this.httpClient.get('/v5/brc20/token-summary', {
      query: {
        address,
        ticker: originTicker,
      },
    })
    if (response && response.tokenBalance && !response.tokenBalance.tickerHex) {
      response.tokenBalance.tickerHex = Buffer.from(response.tokenBalance.ticker, 'utf-8').toString(
        'hex'
      )
    }
    return response
  }

  // ========================================
  // BRC20 token history
  // ========================================

  /**
   * Get address token history list
   */
  async getAddressTokenHistoryList({
    address,
    ticker,
    tickerHex,
    cursor,
    size,
  }: {
    address: string
    ticker: string
    tickerHex?: string
    cursor: number
    size: number
  }): Promise<{ list: TokenTransfer[]; total: number }> {
    const originTicker = this.resolveTicker(ticker, tickerHex)
    return this.httpClient.get('/v5/address/brc20-history', {
      query: {
        address,
        ticker: originTicker,
        cursor,
        size,
      },
    })
  }

  /**
   * Get BRC20 recent history
   */
  async getBRC20RecentHistory(address: string, ticker: string): Promise<BRC20HistoryItem[]> {
    return this.httpClient.get('/v5/brc20/recent-history', {
      query: { address, ticker },
    })
  }

  // ========================================
  // BRC20 price related
  // ========================================

  /**
   * Get token price
   */
  async getTickPrice(ticker: string): Promise<TickPriceItem> {
    return this.httpClient.get('/v5/tick/price', {
      query: { tick: ticker },
    })
  }

  // ========================================
  // BRC20 transfer related
  // ========================================

  /**
   * Inscribe BRC20 transfer
   */
  async inscribeBRC20Transfer(
    address: string,
    tick: string,
    amount: string,
    feeRate: number,
    outputValue?: number
  ): Promise<InscribeOrder> {
    return this.httpClient.post('/v5/brc20/inscribe-transfer', {
      address,
      tick,
      amount,
      feeRate,
      outputValue,
    })
  }

  /**
   * Get inscription result
   */
  async getInscribeResult(orderId: string): Promise<TokenTransfer> {
    return this.httpClient.get('/v5/brc20/order-result', {
      query: { orderId },
    })
  }

  async getTokenTransferableList({
    address,
    ticker,
    tickerHex,
    cursor,
    size,
  }: {
    address: string
    ticker: string
    tickerHex?: string
    cursor: number
    size: number
  }): Promise<{ list: TokenTransfer[]; total: number }> {
    const originTicker = this.resolveTicker(ticker, tickerHex)
    return this.httpClient.get('/v5/brc20/transferable-list', {
      query: {
        address,
        ticker: originTicker,
        cursor,
        size,
      },
    })
  }
  // ========================================
  // Single step transfer related
  // ========================================

  /**
   * Single step transfer BRC20 - Step 1
   */
  async singleStepTransferBRC20Step1({
    userAddress,
    userPubkey,
    receiver,
    ticker,
    amount,
    feeRate,
  }: {
    userAddress: string
    userPubkey: string
    receiver: string
    ticker: string
    amount: string
    feeRate: number
  }): Promise<{
    orderId: string
    psbtHex: string
    toSignInputs: UserToSignInput[]
  }> {
    return this.httpClient.post('/v5/brc20/single-step-transfer/request-commit', {
      userAddress,
      userPubkey,
      receiver,
      ticker,
      amount,
      feeRate,
    })
  }

  async singleStepTransferBRC20Step2({
    orderId,
    psbt,
  }: {
    orderId: string
    psbt: string
  }): Promise<{
    psbtHex: string
    toSignInputs: UserToSignInput[]
  }> {
    return this.httpClient.post('/v5/brc20/single-step-transfer/sign-commit', {
      orderId,
      psbt,
    })
  }
  /**
   * Single step transfer BRC20 - Step 3
   */
  async singleStepTransferBRC20Step3(params: { orderId: string; psbt: string }): Promise<{
    txid: string
  }> {
    return this.httpClient.post('/v5/brc20/single-step-transfer/sign-reveal', params)
  }

  async getBRC20ProgList({
    address,
    cursor,
    size,
  }: {
    address: string
    cursor: number
    size: number
  }): Promise<{ list: TokenBalance[]; total: number }> {
    return this.httpClient.get('/v5/brc20-prog/list', { query: { address, cursor, size, type: 5 } })
  }
}
