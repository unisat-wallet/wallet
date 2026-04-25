import { describe, expect, it, vi, beforeEach } from 'vitest'
import axios from 'axios'

import { apiWrapper } from '../src/api/apiWrapper'
import { ServerError } from '../src/api/serverError'

vi.mock('axios', () => {
  const get = vi.fn()
  const post = vi.fn()
  const isAxiosError = vi.fn()

  return {
    default: { get, post, isAxiosError },
    get,
    post,
    isAxiosError,
    HttpStatusCode: {
      BadRequest: 400,
      InternalServerError: 500,
    },
  }
})

describe('apiWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls axios.get with serialized query config', async () => {
    const response = { data: { ok: true } }
    vi.mocked(axios.get).mockResolvedValue(response as any)

    const result = await apiWrapper(
      'https://api.example.com',
      'GET',
      '/v2/delegations',
      'request failed',
      {
        query: { staker_pk_hex: 'abc', active: true },
      },
      1234
    )

    expect(result).toBe(response)
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.example.com/v2/delegations',
      expect.objectContaining({
        timeout: 1234,
        params: { staker_pk_hex: 'abc', active: true },
      })
    )
  })

  it('calls axios.post with body payload', async () => {
    const response = { data: { id: 1 } }
    vi.mocked(axios.post).mockResolvedValue(response as any)

    const result = await apiWrapper(
      'https://api.example.com',
      'POST',
      '/v1/submit',
      'submit failed',
      {
        body: { foo: 'bar' },
      }
    )

    expect(result).toBe(response)
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.example.com/v1/submit',
      { foo: 'bar' },
      expect.objectContaining({ timeout: 0 })
    )
  })

  it('wraps axios errors as ServerError using response message and status', async () => {
    const axiosErr = {
      response: {
        data: { message: 'backend said no' },
        status: 400,
      },
    }

    vi.mocked(axios.get).mockRejectedValue(axiosErr as any)
    vi.mocked(axios.isAxiosError).mockReturnValue(true)

    await expect(
      apiWrapper('https://api.example.com', 'GET', '/v2/delegations', 'fallback message')
    ).rejects.toMatchObject<Partial<ServerError>>({
      name: 'ServerError',
      message: 'backend said no',
      status: 400,
      endpoint: '/v2/delegations',
    })
  })

  it('wraps non-axios errors with general error message', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('boom'))
    vi.mocked(axios.isAxiosError).mockReturnValue(false)

    await expect(
      apiWrapper('https://api.example.com', 'GET', '/v2/delegations', 'fallback message')
    ).rejects.toMatchObject<Partial<ServerError>>({
      name: 'ServerError',
      message: 'fallback message',
      status: 500,
      endpoint: '/v2/delegations',
    })
  })
})
