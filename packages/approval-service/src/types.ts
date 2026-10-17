export interface Approval {
  data: {
    lock?: boolean
    state: number
    params?: any
    origin?: string
    approvalComponent: string
    requestDefer?: Promise<any>
    approvalType: string
  }
  resolve(params?: any): void
  reject(err: any): void
}
