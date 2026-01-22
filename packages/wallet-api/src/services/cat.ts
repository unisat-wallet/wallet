/**
 * CAT20/CAT721-related API methods - Fully compatible with openapi.ts
 */

import { CAT_VERSION, UserToSignInput } from '@unisat/wallet-shared'
import type { BaseHttpClient } from '../client/http-client'
import type { CAT20Balance, CAT721CollectionInfo } from '../types'
export class CATService {
  constructor(private readonly httpClient: BaseHttpClient) {}

  async getCAT20List(
    version: CAT_VERSION,
    address: string,
    cursor: number,
    size: number
  ): Promise<{ list: CAT20Balance[]; total: number }> {
    return this.httpClient.get('/v5/cat20/list', { query: { address, cursor, size, version } })
  }

  async getAddressCAT20TokenSummary(version: CAT_VERSION, address: string, tokenId: string) {
    return this.httpClient.get(
      `/v5/cat20/token-summary?address=${address}&tokenId=${tokenId}&version=${version}`,
      {}
    )
  }

  async getAddressCAT20UtxoSummary(version: CAT_VERSION, address: string, tokenId: string) {
    return this.httpClient.get(
      `/v5/cat20/utxo-summary?address=${address}&tokenId=${tokenId}&version=${version}`,
      {}
    )
  }

  async transferCAT20Step1(
    version: CAT_VERSION,
    address: string,
    pubkey: string,
    to: string,
    tokenId: string,
    amount: string,
    feeRate: number
  ) {
    return this.httpClient.post<{
      id: string
      // base64 psbt
      commitTx: string
      toSignInputs: UserToSignInput[]
      feeRate: number
    }>('/v5/cat20/transfer-token-step1', {
      version,
      address,
      pubkey,
      to,
      tokenId,
      amount,
      feeRate,
    })
  }

  async transferCAT20Step2(version: CAT_VERSION, transferId: string, signedPsbt: string) {
    return this.httpClient.post<{
      revealTx: string
      toSignInputs: UserToSignInput[]
    }>('/v5/cat20/transfer-token-step2', {
      id: transferId,
      psbt: signedPsbt,
      version,
    })
  }

  async transferCAT20Step3(version: CAT_VERSION, transferId: string, signedPsbt: string) {
    return this.httpClient.post<{
      txid: string
    }>('/v5/cat20/transfer-token-step3', {
      id: transferId,
      psbt: signedPsbt,
      version,
    })
  }

  async transferCAT20Step1ByMerge(version: CAT_VERSION, mergeId: string) {
    return this.httpClient.post<{
      id: string
      // base64 psbt
      commitTx: string
      toSignInputs: UserToSignInput[]
      feeRate: number
    }>('/v5/cat20/transfer-token-step1-by-merge', {
      mergeId,
      version,
    })
  }

  async mergeCAT20Prepare(
    version: CAT_VERSION,
    address: string,
    pubkey: string,
    tokenId: string,
    utxoCount: number,
    feeRate: number
  ) {
    return this.httpClient.post<{
      id: string
      senderAddress: string
      senderPubkey: string
      tokenId: string
      feeRate: number
      batchIndex: number
      batchCount: number
      ct: number
      version?: string
    }>('/v5/cat20/merge-token-prepare', {
      version,
      address,
      pubkey,
      tokenId,
      utxoCount,
      feeRate,
    })
  }

  async getMergeCAT20Status(version: CAT_VERSION, mergeId: string) {
    return this.httpClient.post<{
      id: string
      senderAddress: string
      senderPubkey: string
      tokenId: string
      feeRate: number
      batchIndex: number
      batchCount: number
      ct: number
      version?: string
    }>('/v5/cat20/merge-token-status', {
      id: mergeId,
      version,
    })
  }

  async getCAT721CollectionList(
    version: CAT_VERSION,
    address: string,
    cursor: number,
    size: number
  ): Promise<{ list: CAT721CollectionInfo[]; total: number }> {
    return this.httpClient.get('/v5/cat721/collection/list', {
      query: { address, cursor, size, version },
    })
  }

  async getAddressCAT721CollectionSummary(
    version: CAT_VERSION,
    address: string,
    collectionId: string
  ) {
    return this.httpClient.get(
      `/v5/cat721/collection-summary?address=${address}&collectionId=${collectionId}&version=${version}`,
      {}
    )
  }

  async transferCAT721Step1(
    version: CAT_VERSION,
    address: string,
    pubkey: string,
    to: string,
    collectionId: string,
    localId: string,
    feeRate: number
  ) {
    return this.httpClient.post<{
      id: string
      // base64 psbt
      commitTx: string
      toSignInputs: UserToSignInput[]
      feeRate: number
    }>('/v5/cat721/transfer-nft-step1', {
      version,
      address,
      pubkey,
      to,
      collectionId,
      localId,
      feeRate,
    })
  }

  async transferCAT721Step2(version: CAT_VERSION, transferId: string, signedPsbt: string) {
    return this.httpClient.post<{
      revealTx: string
      toSignInputs: UserToSignInput[]
    }>('/v5/cat721/transfer-nft-step2', {
      id: transferId,
      psbt: signedPsbt,
      version,
    })
  }

  async transferCAT721Step3(version: CAT_VERSION, transferId: string, signedPsbt: string) {
    return this.httpClient.post<{
      txid: string
    }>('/v5/cat721/transfer-nft-step3', {
      id: transferId,
      psbt: signedPsbt,
      version,
    })
  }
}
