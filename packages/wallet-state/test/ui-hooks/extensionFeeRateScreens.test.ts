import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  feeRate: 3,
  t: (key: string) => key,
  prepare: vi.fn(),
  wallet: {
    getEnableRBF: vi.fn().mockResolvedValue(true),
    getRgbFundingAddress: vi.fn().mockResolvedValue({ address: 'bc1funding' }),
    getRgbAllocationSummary: vi.fn().mockResolvedValue({ availableAllocationCount: 0 }),
    getAddressBalanceV2: vi.fn().mockResolvedValue({ availableBalance: 100000 }),
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
  ...(await import('../../src/utils/rgb-utxo-utils')),
  useFeeRateBar: () => ({ feeRate: mocks.feeRate }),
  useCurrentAccount: () => mocks.account,
  useWallet: () => mocks.wallet,
  useTools: () => mocks.tools,
  useNavigation: () => mocks.nav,
  useI18n: () => ({ t: mocks.t }),
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
})
