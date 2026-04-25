import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDelegationV2, getDelegationsV2 } from '../src/api/getDelegationsV2'
import { apiWrapper } from '../src/api/apiWrapper'

vi.mock('../src/api/apiWrapper', () => ({
  apiWrapper: vi.fn(),
}))

const mockedApiWrapper = vi.mocked(apiWrapper)

const apiDelegation = {
  finality_provider_btc_pks_hex: ['fp1', 'fp2'],
  params_version: 1,
  staker_btc_pk_hex: 'stakerpk',
  delegation_staking: {
    staking_tx_hex: 'stake-hex',
    staking_tx_hash_hex: 'stake-hash',
    staking_timelock: 100,
    staking_amount: 12345,
    start_height: 10,
    end_height: 20,
    bbn_inception_height: 30,
    bbn_inception_time: '2025-01-01T00:00:00Z',
    slashing: {
      slashing_tx_hex: 'slash-hex',
      spending_height: 999,
    },
  },
  delegation_unbonding: {
    unbonding_timelock: 50,
    unbonding_tx: 'unbond-hex',
    covenant_unbonding_signatures: [
      {
        covenant_btc_pk_hex: 'covpk',
        signature_hex: 'sighex',
      },
    ],
    slashing: {
      unbonding_slashing_tx_hex: 'unbond-slash-hex',
      spending_height: 888,
    },
  },
  state: 'ACTIVE',
}

describe('getDelegationsV2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps paginated delegations response into domain model', async () => {
    mockedApiWrapper.mockResolvedValue({
      data: {
        data: [apiDelegation],
        pagination: { next_key: 'next-page' },
      },
    } as any)

    const result = await getDelegationsV2('https://babylon.example', 'pubkey-no-coord', 'page-1')

    expect(apiWrapper).toHaveBeenCalledWith(
      'https://babylon.example',
      'GET',
      '/v2/delegations',
      'Error getting delegations v2',
      {
        query: {
          staker_pk_hex: 'pubkey-no-coord',
          pagination_key: 'page-1',
        },
      }
    )

    expect(result.pagination).toEqual({ next_key: 'next-page' })
    expect(result.delegations).toEqual([
      {
        finalityProviderBtcPksHex: ['fp1', 'fp2'],
        stakingTxHex: 'stake-hex',
        paramsVersion: 1,
        stakerBtcPkHex: 'stakerpk',
        stakingAmount: 12345,
        stakingTimelock: 100,
        stakingTxHashHex: 'stake-hash',
        startHeight: 10,
        endHeight: 20,
        bbnInceptionHeight: 30,
        bbnInceptionTime: '2025-01-01T00:00:00Z',
        state: 'ACTIVE',
        unbondingTimelock: 50,
        unbondingTxHex: 'unbond-hex',
        slashing: {
          stakingSlashingTxHex: 'slash-hex',
          unbondingSlashingTxHex: 'unbond-slash-hex',
          spendingHeight: 888,
        },
        covenantUnbondingSignatures: [
          {
            covenantBtcPkHex: 'covpk',
            signatureHex: 'sighex',
          },
        ],
      },
    ])
  })

  it('getDelegationV2 returns null when api call fails', async () => {
    mockedApiWrapper.mockRejectedValue(new Error('network failed'))

    const result = await getDelegationV2('https://babylon.example', 'staking-hash')

    expect(result).toBeNull()
  })

  it('maps single delegation response when getDelegationV2 succeeds', async () => {
    mockedApiWrapper.mockResolvedValue({
      data: {
        data: apiDelegation,
      },
    } as any)

    const result = await getDelegationV2('https://babylon.example', 'staking-hash')

    expect(apiWrapper).toHaveBeenCalledWith(
      'https://babylon.example',
      'GET',
      '/v2/delegation',
      'Error getting delegation v2',
      {
        query: {
          staking_tx_hash_hex: 'staking-hash',
        },
      }
    )

    expect(result?.state).toBe('ACTIVE')
    expect(result?.stakingTxHashHex).toBe('stake-hash')
  })
})
