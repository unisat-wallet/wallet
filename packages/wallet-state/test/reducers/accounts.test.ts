import { describe, it, expect } from 'vitest'
import accountsReducer, { accountActions, initialState } from '../../src/reducers/accounts'

describe('accounts reducer', () => {
  describe('initial state', () => {
    it('should return initial state when passed undefined', () => {
      const result = accountsReducer(undefined, { type: 'unknown' })
      expect(result).toEqual(initialState)
    })

    it('should have correct initial values', () => {
      expect(initialState.accounts).toEqual([])
      expect(initialState.loading).toBe(false)
      expect(initialState.balanceMap).toEqual({})
      expect(initialState.current.address).toBe('')
    })
  })

  describe('setCurrent', () => {
    it('should set current account', () => {
      const account = {
        type: 'hd',
        address: 'bc1qtest123',
        brandName: 'UniSat',
        alianName: 'Account 1',
        displayBrandName: 'UniSat',
        index: 0,
        balance: 0,
        pubkey: '02abc123',
        key: 'key1',
        flag: 0,
      }

      const state = accountsReducer(initialState, accountActions.setCurrent(account))
      expect(state.current).toEqual(account)
    })

    it('should reset to initial account when payload is falsy', () => {
      const state = accountsReducer(initialState, accountActions.setCurrent(null as any))
      expect(state.current.address).toBe('')
      expect(state.current.type).toBe('')
    })
  })

  describe('setAccounts', () => {
    it('should set accounts array', () => {
      const accounts = [
        {
          type: 'hd',
          address: 'bc1qtest1',
          brandName: 'UniSat',
          alianName: 'Account 1',
          displayBrandName: 'UniSat',
          index: 0,
          balance: 100000,
          pubkey: '02abc1',
          key: 'key1',
          flag: 0,
        },
        {
          type: 'hd',
          address: 'bc1qtest2',
          brandName: 'UniSat',
          alianName: 'Account 2',
          displayBrandName: 'UniSat',
          index: 1,
          balance: 200000,
          pubkey: '02abc2',
          key: 'key2',
          flag: 0,
        },
      ]

      const state = accountsReducer(initialState, accountActions.setAccounts(accounts))
      expect(state.accounts).toHaveLength(2)
      expect(state.accounts[0].address).toBe('bc1qtest1')
      expect(state.accounts[1].address).toBe('bc1qtest2')
    })
  })

  describe('setBalance', () => {
    it('should set balance for an address', () => {
      const payload = {
        address: 'bc1qtest123',
        amount: '100000',
        btc_amount: '100000',
        inscription_amount: '5000',
        confirm_btc_amount: '95000',
        pending_btc_amount: '5000',
      }

      const state = accountsReducer(initialState, accountActions.setBalance(payload))

      expect(state.balanceMap['bc1qtest123']).toBeDefined()
      expect(state.balanceMap['bc1qtest123'].amount).toBe('100000')
      expect(state.balanceMap['bc1qtest123'].btc_amount).toBe('100000')
      expect(state.balanceMap['bc1qtest123'].inscription_amount).toBe('5000')
      expect(state.balanceMap['bc1qtest123'].expired).toBe(false)
    })

    it('should update existing balance', () => {
      const initialPayload = {
        address: 'bc1qtest123',
        amount: '100000',
        btc_amount: '100000',
        inscription_amount: '0',
        confirm_btc_amount: '100000',
        pending_btc_amount: '0',
      }

      let state = accountsReducer(initialState, accountActions.setBalance(initialPayload))

      const updatedPayload = {
        address: 'bc1qtest123',
        amount: '200000',
        btc_amount: '200000',
        inscription_amount: '10000',
        confirm_btc_amount: '190000',
        pending_btc_amount: '10000',
      }

      state = accountsReducer(state, accountActions.setBalance(updatedPayload))

      expect(state.balanceMap['bc1qtest123'].amount).toBe('200000')
      expect(state.balanceMap['bc1qtest123'].inscription_amount).toBe('10000')
    })
  })

  describe('setBalanceV2', () => {
    it('should set balance v2 for an address', () => {
      const payload = {
        address: 'bc1qtest123',
        balance: {
          availableBalance: 95000,
          unavailableBalance: 5000,
          totalBalance: 100000,
          chainType: 'BITCOIN_MAINNET',
        },
      }

      const state = accountsReducer(initialState, accountActions.setBalanceV2(payload))

      expect(state.balanceV2Map['bc1qtest123']).toBeDefined()
      expect(state.balanceV2Map['bc1qtest123'].availableBalance).toBe(95000)
      expect(state.balanceV2Map['bc1qtest123'].unavailableBalance).toBe(5000)
      expect(state.balanceV2Map['bc1qtest123'].totalBalance).toBe(100000)
    })
  })

  describe('expireBalance', () => {
    it('should mark current address balance as expired', () => {
      const account = {
        type: 'hd',
        address: 'bc1qtest123',
        brandName: 'UniSat',
        alianName: 'Account 1',
        displayBrandName: 'UniSat',
        index: 0,
        balance: 0,
        pubkey: '02abc123',
        key: 'key1',
        flag: 0,
      }

      let state = accountsReducer(initialState, accountActions.setCurrent(account))
      state = accountsReducer(
        state,
        accountActions.setBalance({
          address: 'bc1qtest123',
          amount: '100000',
          btc_amount: '100000',
          inscription_amount: '0',
          confirm_btc_amount: '100000',
          pending_btc_amount: '0',
        })
      )

      expect(state.balanceMap['bc1qtest123'].expired).toBe(false)

      state = accountsReducer(state, accountActions.expireBalance(undefined))
      expect(state.balanceMap['bc1qtest123'].expired).toBe(true)
    })
  })

  describe('setHistory', () => {
    it('should set transaction history for an address', () => {
      const payload = {
        address: 'bc1qtest123',
        list: [
          { txid: 'tx1', time: 1234567890 },
          { txid: 'tx2', time: 1234567891 },
        ] as any[],
      }

      const state = accountsReducer(initialState, accountActions.setHistory(payload))

      expect(state.historyMap['bc1qtest123']).toBeDefined()
      expect(state.historyMap['bc1qtest123'].list).toHaveLength(2)
      expect(state.historyMap['bc1qtest123'].expired).toBe(false)
    })
  })

  describe('setCurrentAccountName', () => {
    it('should update current account name and matching account in list', () => {
      const account = {
        type: 'hd',
        address: 'bc1qtest123',
        brandName: 'UniSat',
        alianName: 'Account 1',
        displayBrandName: 'UniSat',
        index: 0,
        balance: 0,
        pubkey: '02abc123',
        key: 'key1',
        flag: 0,
      }

      let state = accountsReducer(initialState, accountActions.setCurrent(account))
      state = accountsReducer(state, accountActions.setAccounts([account]))
      state = accountsReducer(state, accountActions.setCurrentAccountName('New Name'))

      expect(state.current.alianName).toBe('New Name')
      expect(state.accounts[0].alianName).toBe('New Name')
    })
  })

  describe('pendingLogin / rejectLogin', () => {
    it('should set loading to true on pendingLogin', () => {
      const state = accountsReducer(initialState, accountActions.pendingLogin(undefined))
      expect(state.loading).toBe(true)
    })

    it('should set loading to false on rejectLogin', () => {
      let state = accountsReducer(initialState, accountActions.pendingLogin(undefined))
      expect(state.loading).toBe(true)

      state = accountsReducer(state, accountActions.rejectLogin(undefined))
      expect(state.loading).toBe(false)
    })
  })

  describe('reset', () => {
    it('should reset state to initial state', () => {
      let state = accountsReducer(initialState, accountActions.pendingLogin(undefined))
      state = accountsReducer(
        state,
        accountActions.setCurrent({
          type: 'hd',
          address: 'bc1qtest123',
          brandName: 'UniSat',
          alianName: 'Account 1',
          displayBrandName: 'UniSat',
          index: 0,
          balance: 100000,
          pubkey: '02abc123',
          key: 'key1',
          flag: 0,
        })
      )

      expect(state.loading).toBe(true)
      expect(state.current.address).toBe('bc1qtest123')

      state = accountsReducer(state, accountActions.reset(undefined))
      expect(state).toEqual(initialState)
    })
  })
})
