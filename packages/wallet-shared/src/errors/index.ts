import { t } from '../utils/i18n'

export enum ErrorCodes {
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  UNKNOWN = INTERNAL_ERROR,
  // Stable wallet errors in JSON-RPC's implementation-defined server-error range.
  INSUFFICIENT_BTC_UTXO = -32010,
  INSUFFICIENT_ASSET_UTXO = -32011,
  NOT_SAFE_UTXOS = -32012,
  ASSET_MAYBE_LOST = -32013,
  INSUFFICIENT_FEE_UTXO = -32014,
  NO_ACCOUNT = -32015,
  // RGB-specific errors. Reserve -32020..-32039 for this feature family.
  RGB_NOT_ENABLED = -32020,
  RGB_ASSET_NOT_FOUND = -32021,
  UserCancel = 4001,
  UNAUTHORIZED = 4100,
  // Wallet's current Bitcoin network is not one of the canonical networks
  // accepted by deriveContextHash. EIP-1193 reserves 4901 for "Chain
  // Disconnected" — closest standard analog.
  UNSUPPORTED_NETWORK = 4901,
}

export const ErrorMessages: {
  [key in ErrorCodes]?: string
} = {
  [ErrorCodes.UNKNOWN]: 'code_unknown_error',
  [ErrorCodes.INSUFFICIENT_BTC_UTXO]: 'code_insufficient_balance',
  [ErrorCodes.INSUFFICIENT_ASSET_UTXO]: 'code_insufficient_asset_utxo',
  [ErrorCodes.NOT_SAFE_UTXOS]: 'code_not_safe_utxos',
  [ErrorCodes.ASSET_MAYBE_LOST]: 'code_asset_maybe_lost',
  [ErrorCodes.INSUFFICIENT_FEE_UTXO]: 'code_insufficient_fee_utxo',
  [ErrorCodes.NO_ACCOUNT]: 'wallet_must_has_at_least_one_account',
  [ErrorCodes.METHOD_NOT_FOUND]: 'code_method_not_found',
  [ErrorCodes.UserCancel]: 'user_rejected_the_request',
  [ErrorCodes.UNSUPPORTED_NETWORK]: 'code_unsupported_network',
}

export class WalletError extends Error {
  public code = ErrorCodes.UNKNOWN
  constructor(code: ErrorCodes, message?: string) {
    if (!message) {
      message = t(ErrorMessages[code] || 'Unknown error')
    }
    super(message)
    this.code = code
    Object.setPrototypeOf(this, WalletError.prototype)
  }
}
