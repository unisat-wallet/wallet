import { NetworkType } from '@unisat/wallet-types'
/**
 * Base enums and interface definitions
 */

// ========================================
// Base enum types
// ========================================

export enum TxType {
  SIGN_TX,
  SEND_BITCOIN,
  SEND_ORDINALS_INSCRIPTION,
  SEND_ATOMICALS_INSCRIPTION,
  SEND_RUNES,
  SEND_ALKANES,
}

// ========================================
// API response format
// ========================================

export interface ApiResponse<T = any> {
  code: number
  msg: string
  data: T
}

// ========================================
// Pagination parameters
// ========================================

export interface PaginationParams {
  cursor: number
  size: number
}

// ========================================
// User signature input
// ========================================

interface BaseUserToSignInput {
  index: number
  sighashTypes: number[] | undefined
  useTweakedSigner?: boolean
  disableTweakSigner?: boolean
  tapLeafHashToSign?: string
}

export interface AddressUserToSignInput extends BaseUserToSignInput {
  address: string
}

export interface PublicKeyUserToSignInput extends BaseUserToSignInput {
  publicKey: string
}

export type UserToSignInput = AddressUserToSignInput | PublicKeyUserToSignInput

export interface ToSignInput {
  index: number
  publicKey: string
  sighashTypes?: number[] | undefined
  tapLeafHashToSign?: Buffer
}

// ========================================
// Client configuration
// ========================================

export interface ClientConfig {
  endpoint?: string
  network?: NetworkType
  timeout?: number
  retries?: number
  headers?: Record<string, string>
  apiKey?: string
  userAgent?: string
}

export interface RequestConfig {
  timeout?: number
  retries?: number
  headers?: Record<string, string>
  signal?: AbortSignal
}
