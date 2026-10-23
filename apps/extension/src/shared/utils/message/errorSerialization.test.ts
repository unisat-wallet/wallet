import { serializeProviderRpcError, serializeTransportError } from './errorSerialization';
import { describe, expect, it } from 'vitest';

describe('message error serialization', () => {
  it('does not transport Error stacks', () => {
    const error = new Error('RGB is not enabled');

    expect(serializeTransportError(error)).toEqual({ message: 'RGB is not enabled' });
  });

  it('preserves safe structured data while removing nested error details', () => {
    const error = Object.assign(new Error('Insufficient BTC'), {
      code: 'RGB_FEE_POOL_INSUFFICIENT_BTC',
      data: {
        requiredSatoshis: 1_000,
        nested: {
          status: 'insufficient',
          stack: 'private stack',
          originalError: { message: 'private error' },
          cause: new Error('private cause')
        }
      }
    });

    expect(serializeTransportError(error)).toEqual({
      message: 'Insufficient BTC',
      code: 'RGB_FEE_POOL_INSUFFICIENT_BTC',
      data: {
        requiredSatoshis: 1_000,
        nested: { status: 'insufficient' }
      }
    });
  });

  it('does not expose originalError for non-RPC errors', () => {
    const error = Object.assign(new Error('RGB is not enabled'), {
      stack: 'private stack',
      data: { originalError: { stack: 'nested private stack' } }
    });

    expect(serializeProviderRpcError(error)).toEqual({
      code: -32603,
      message: 'RGB is not enabled'
    });
  });

  it('preserves sanitized data for errors with a valid JSON-RPC code', () => {
    expect(
      serializeProviderRpcError({
        code: -32000,
        message: 'Request failed',
        data: { status: 'unavailable', stack: 'private stack' }
      })
    ).toEqual({
      code: -32000,
      message: 'Request failed',
      data: { status: 'unavailable' }
    });
  });
});
