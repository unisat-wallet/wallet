export interface InscribeOrder {
  orderId: string
  payAddress: string
  totalFee: number
  minerFee: number
  originServiceFee: number
  serviceFee: number
  outputValue: number
}
