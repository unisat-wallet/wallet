import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  feeRate: 3,
  prepare: vi.fn(),
  wallet: {
    getEnableRBF: vi.fn().mockResolvedValue(true),
    getRgbFundingAddress: vi.fn().mockResolvedValue({ address: 'bc1funding' }),
    getRgbAllocationSummary: vi.fn().mockResolvedValue({ availableAllocationCount: 0 }),
    createRgbUtxosBegin: vi.fn().mockResolvedValue({ toSignData: { psbtHex: 'test' } }),
    createRgbIssueNia: vi.fn(),
  },
  account: { key: 'test', address: 'bc1test' },
  tools: { showLoading: vi.fn(), toastError: vi.fn() },
  nav: { navigate: vi.fn(), goBack: vi.fn() },
  fetchUtxos: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@unisat/wallet-state', async () => ({
  ...(await import('../../src/utils/rgb-amount-utils')),
  useFeeRateBar: () => ({ feeRate: mocks.feeRate }),
  useCurrentAccount: () => mocks.account,
  useWallet: () => mocks.wallet,
  useTools: () => mocks.tools,
  useNavigation: () => mocks.nav,
  useI18n: () => ({ t: (key: string) => key }),
  useChain: () => ({ unit: 'BTC' }),
  useFetchUtxosCallback: () => mocks.fetchUtxos,
  useSafeBalance: () => '0.001',
  useUtxos: () => [],
  usePrepareSendBTCCallback: () => mocks.prepare,
}))
vi.mock('@/ui/utils', () => ({
  amountToSatoshis: () => 100000,
  copyToClipboard: vi.fn(),
  shortAddress: (v: string) => v,
}))
vi.mock('@/ui/components', () => ({
  Column: ({ children }: any) => children,
  Content: ({ children }: any) => children,
  Layout: ({ children }: any) => children,
  Header: () => null,
  Icon: () => null,
  Text: () => null,
  Tooltip: ({ children }: any) => children,
}))
vi.mock('@/ui/components/FeeRateBar', () => ({ FeeRateBar: () => null }))
vi.mock('@/ui/components/LoadingPage', () => ({ default: () => null }))
vi.mock('../../../../apps/extension/src/ui/pages/Approval/components', () => ({
  SignPsbt: () => null,
}))
vi.mock('../../../../apps/extension/src/ui/pages/RGB/RGBIssueScreen.less', () => ({}))
vi.mock('../../../../apps/extension/src/ui/pages/RGB/components/useRgbWriteLeaseGuard', () => ({
  useRgbWriteLeaseGuard: () => ({
    requestWrite: (action: () => void) => action(),
    writeLeaseModal: null,
  }),
}))
vi.mock('../../../../apps/extension/src/ui/pages/RGB/components/IssueReviewModal', () => ({
  IssueReviewModal: ({ onConfirm }: any) =>
    React.createElement('button', { onClick: onConfirm }, 'review confirm'),
}))
vi.mock('../../../../apps/extension/src/ui/components/Button', () => ({
  Button: ({ text, disabled, onClick }: any) =>
    React.createElement('button', { disabled, onClick }, text),
}))
vi.mock('../../../../apps/extension/src/ui/components/Column', () => ({
  Column: ({ children }: any) => children,
}))
vi.mock('../../../../apps/extension/src/ui/components/Row', () => ({
  Row: ({ children }: any) => children,
}))
vi.mock('../../../../apps/extension/src/ui/components/Text', () => ({ Text: () => null }))
vi.mock('../../../../apps/extension/src/ui/components/Popover', () => ({
  Popover: ({ children }: any) => children,
}))
vi.mock('../../../../apps/extension/src/ui/components/FeeRateBar', () => ({
  FeeRateBar: () => null,
}))
vi.mock('../../../../apps/extension/src/ui/components/RBFBar', () => ({ RBFBar: () => null }))

import { MergeBTCPopover } from '../../../../apps/extension/src/ui/components/MergeBTCPopover'
import RGBIssueScreen from '../../../../apps/extension/src/ui/pages/RGB/RGBIssueScreen'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.feeRate = 3
})

describe('extension fee submission controls', () => {
  it('disables merge confirmation for an empty fee and recovers with the entered fee', async () => {
    const view = render(React.createElement(MergeBTCPopover, { onClose: () => {} }))
    await act(async () => {})
    expect((view.getByText('confirm') as HTMLButtonElement).disabled).toBe(false)
    mocks.feeRate = 0
    view.rerender(React.createElement(MergeBTCPopover, { onClose: () => {} }))
    expect((view.getByText('confirm') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(view.getByText('confirm'))
    expect(mocks.prepare).not.toHaveBeenCalled()
    mocks.feeRate = 2.5
    view.rerender(React.createElement(MergeBTCPopover, { onClose: () => {} }))
    await act(async () => {
      fireEvent.click(view.getByText('confirm'))
    })
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ feeRate: 2.5 }))
  })

  it('blocks RGB issuance for an empty fee instead of using the backend default', async () => {
    const view = render(React.createElement(RGBIssueScreen))
    await waitFor(() => expect(mocks.wallet.getRgbFundingAddress).toHaveBeenCalled())
    fireEvent.change(view.getByPlaceholderText('asset_display_name'), {
      target: { value: 'Test Asset' },
    })
    fireEvent.change(view.getByPlaceholderText('ticker_placeholder'), { target: { value: 'TEST' } })
    fireEvent.change(view.getByPlaceholderText('enter_total_supply'), { target: { value: '10' } })
    await waitFor(() =>
      expect((view.getByText('issue_asset') as HTMLButtonElement).disabled).toBe(false)
    )
    mocks.feeRate = 0
    view.rerender(React.createElement(RGBIssueScreen))
    expect((view.getByText('issue_asset') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(view.getByText('issue_asset'))
    expect(view.queryByText('review confirm')).toBeNull()
    expect(mocks.wallet.createRgbUtxosBegin).not.toHaveBeenCalled()
    expect(mocks.wallet.createRgbIssueNia).not.toHaveBeenCalled()
    mocks.feeRate = 2.5
    view.rerender(React.createElement(RGBIssueScreen))
    fireEvent.click(view.getByText('issue_asset'))
    await act(async () => {
      fireEvent.click(view.getByText('review confirm'))
    })
    await waitFor(() =>
      expect(mocks.wallet.createRgbUtxosBegin).toHaveBeenCalledWith({ num: 5, feeRate: 2.5 })
    )
  })
})
