import { describe, expect, it, vi } from 'vitest'
import { Brc20TickFilter } from '@unisat/wallet-shared'

import { BRC20Service } from '../src/services/brc20'

describe('BRC20Service.getBRC20List', () => {
  it('adds the combined filter only when the caller requests it', async () => {
    const get = vi.fn().mockResolvedValue({ list: [], total: 0 })
    const service = new BRC20Service({ get } as any)

    await service.getBRC20List({ address: 'bc1qexample', cursor: 0, size: 20 })
    await service.getBRC20List({
      address: 'bc1qexample',
      cursor: 0,
      size: 20,
      tickFilter: Brc20TickFilter.TICK_BYTES_4_5_6,
    })

    expect(get).toHaveBeenNthCalledWith(1, '/v5/brc20/list', {
      query: { address: 'bc1qexample', cursor: 0, size: 20 },
    })
    expect(get).toHaveBeenNthCalledWith(2, '/v5/brc20/list', {
      query: { address: 'bc1qexample', cursor: 0, size: 20, tick_filter: 56 },
    })
  })
})
