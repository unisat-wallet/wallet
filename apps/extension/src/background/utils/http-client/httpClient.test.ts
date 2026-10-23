import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServiceUnavailableError, isRetryableError } from './errors';
import { HttpClient } from './httpClient';

describe('wallet API HTTP retries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not retry the wallet API 567 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 567,
      statusText: 'Unknown Status'
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const client = new HttpClient({ endpoint: 'https://wallet-api.example.com', retries: 3 });
    await expect(client.get('/v5/address/balance2')).rejects.toMatchObject({
      name: 'ServiceUnavailableError',
      details: { status: 567 }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps other server failures eligible for retry', () => {
    expect(isRetryableError(new ServiceUnavailableError('server error', { status: 500 }))).toBe(true);
    expect(isRetryableError(new ServiceUnavailableError('server error', { status: 567 }))).toBe(false);
  });
});
