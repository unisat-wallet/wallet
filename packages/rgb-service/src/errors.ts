export class RgbServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RgbServiceError'
  }
}

/** A selected allocation points to an operation absent from its validated history DAG. */
export class RgbMissingAncestorError extends RgbServiceError {
  readonly code = 'RGB_MISSING_ANCESTOR'

  constructor() {
    super('RGB v1: selected allocation is missing an ancestor')
    this.name = 'RgbMissingAncestorError'
  }
}

/** Chain data needed for BFA validation is temporarily unavailable. Keep the invoice pending. */
export class RgbBfaValidationUnavailableError extends RgbServiceError {
  constructor(message: string) {
    super(message)
    this.name = 'RgbBfaValidationUnavailableError'
  }
}

/** The proxy v1 sender has no ACK operation, as with a donation transfer. */
export class RgbProxyOperationNotFoundError extends RgbServiceError {
  constructor() {
    super('RGB proxy ack.post failed: Operation not found')
    this.name = 'RgbProxyOperationNotFoundError'
  }
}

/** The receiver has already ACKed this Proxy v1 transfer, so ack.clean is unsafe. */
export class RgbProxyAlreadyAcknowledgedError extends RgbServiceError {
  constructor() {
    super('RGB proxy transfer is already acknowledged')
    this.name = 'RgbProxyAlreadyAcknowledgedError'
  }
}

export class RgbInsufficientBalanceError extends RgbServiceError {
  constructor(assetId: string, amount: string) {
    super(`Insufficient spendable RGB balance for ${assetId}: ${amount}`)
    this.name = 'RgbInsufficientBalanceError'
  }
}

/** A partial transfer needs a Bitcoin funding output to retain RGB asset change. */
export class RgbFundingOutputRequiredError extends RgbServiceError {
  constructor() {
    super('RGB transfer cannot preserve asset change without a funding output')
    this.name = 'RgbFundingOutputRequiredError'
  }
}

/** The signed consignment is durably posted and needs the receiver's ACK before broadcast. */
export class RgbTransferAwaitingAckError extends RgbServiceError {
  constructor(transferId: string) {
    super(`RGB transfer ${transferId} is awaiting recipient acknowledgement`)
  }
}

/** The receiver explicitly rejected a consignment, so the local send is no longer pending. */
export class RgbTransferRejectedError extends RgbServiceError {
  constructor(
    readonly transferId: string,
    readonly txid?: string
  ) {
    super(`RGB transfer ${transferId} was rejected by the recipient`)
  }
}

/** A signed transfer cannot be broadcast because its inputs were replaced or spent. */
export class RgbTransferCanceledError extends RgbServiceError {
  constructor(
    readonly transferId: string,
    readonly txid?: string
  ) {
    super(`RGB transfer ${transferId} was canceled because its inputs were spent`)
    this.name = 'RgbTransferCanceledError'
  }
}

/** The proxy has already bound this invoice recipient ID to another consignment. */
export class RgbInvoiceUnavailableError extends RgbServiceError {
  readonly code = 'RGB_INVOICE_UNAVAILABLE'

  constructor() {
    // This code survives extension RPC error serialization; the UI translates
    // it using the active locale before displaying it to the user.
    super('RGB_INVOICE_UNAVAILABLE')
    this.name = 'RgbInvoiceUnavailableError'
  }
}
