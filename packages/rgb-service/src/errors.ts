export class RgbServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RgbServiceError'
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
