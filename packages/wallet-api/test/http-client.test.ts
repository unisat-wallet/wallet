import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HttpClient } from '../src/client/http-client'
import { ApiClientError, RateLimitError, TimeoutError } from '../src/utils/errors'

function jsonResponse(body: any, init: { status?: number; statusText?: string; headers?: Record<string, string> } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: {
      get: (name: string) => init.headers?.[name] ?? null,
    },
    json: vi.fn().mockResolvedValue(body),
  } as any
}

describe('HttpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds url with query and returns api data payload on success', async () => {
    const fetchMock = vi.mocked(globalThis.fetch as any)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 0, msg: 'ok', data: { value: 1 } })
    )

    const client = new HttpClient({ endpoint: 'https://api.example.com' })
    const result = await client.get('/v1/test', { query: { a: 1, b: 'x' } })

    expect(result).toEqual({ value: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/test?a=1&b=x')
  })

  it('throws ApiClientError when api code is non-zero', async () => {
    const fetchMock = vi.mocked(globalThis.fetch as any)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 1001, msg: 'bad request', data: { serverTime: 1_000 } })
    )

    const client = new HttpClient({ endpoint: 'https://api.example.com' })

    await expect(client.get('/v1/test')).rejects.toMatchObject<Partial<ApiClientError>>({
      name: 'ApiClientError',
      code: 1001,
      message: 'bad request',
      details: { serverTime: 1_000 },
    })
  })

  it('preserves a structured API error message instead of showing an object', async () => {
    const fetchMock = vi.mocked(globalThis.fetch as any)
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 1002,
      msg: { message: 'RGB recovery checkpoint is unavailable' },
      data: { retryable: true },
    }))

    const client = new HttpClient({ endpoint: 'https://api.example.com' })
    await expect(client.get('/v1/test')).rejects.toMatchObject<Partial<ApiClientError>>({
      code: 1002,
      message: 'RGB recovery checkpoint is unavailable',
      details: { retryable: true },
    })
  })

  it('throws RateLimitError on 429 and parses Retry-After header', async () => {
    const fetchMock = vi.mocked(globalThis.fetch as any)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({}, { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '12' } })
    )

    const client = new HttpClient({ endpoint: 'https://api.example.com' })

    await expect(client.get('/v1/test')).rejects.toMatchObject<Partial<RateLimitError>>({
      name: 'RateLimitError',
      retryAfter: 12,
    })
  })

  it('retries on retryable errors and succeeds on later attempt', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.mocked(globalThis.fetch as any)

    fetchMock
      .mockRejectedValueOnce(new Error('temporary network issue'))
      .mockResolvedValueOnce(jsonResponse({ code: 0, msg: 'ok', data: { done: true } }))

    const client = new HttpClient({ endpoint: 'https://api.example.com', retries: 1 })

    const promise = client.get('/v1/retry')
    await vi.advanceTimersByTimeAsync(1000)

    await expect(promise).resolves.toEqual({ done: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps AbortError to TimeoutError', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.mocked(globalThis.fetch as any)
    const abortError = new Error('aborted') as any
    abortError.name = 'AbortError'
    fetchMock.mockRejectedValueOnce(abortError).mockRejectedValueOnce(abortError)

    const client = new HttpClient({ endpoint: 'https://api.example.com', timeout: 1234, retries: 1 })

    const rejection = expect(client.get('/v1/timeout')).rejects.toMatchObject<Partial<TimeoutError>>({
      name: 'TimeoutError',
      message: 'Request timeout after 1234ms',
    })
    await vi.advanceTimersByTimeAsync(1000)
    await rejection
  })
})
