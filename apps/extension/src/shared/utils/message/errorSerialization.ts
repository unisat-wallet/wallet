import { serializeError } from 'eth-rpc-errors';

type TransportError = {
  message: string;
  code?: string | number;
  data?: unknown;
};

const PRIVATE_ERROR_FIELDS = new Set(['stack', 'originalError', 'cause']);

function sanitizeErrorData(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (depth >= 8 || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeErrorData(item, seen, depth + 1))
      .filter((item) => item !== undefined);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_ERROR_FIELDS.has(key)) continue;
    const next = sanitizeErrorData(item, seen, depth + 1);
    if (next !== undefined) sanitized[key] = next;
  }
  return sanitized;
}

/** Serialize an error for an extension message without exposing implementation details. */
export function serializeTransportError(error: unknown): TransportError {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined;
  const message =
    typeof record?.message === 'string'
      ? record.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';
  const code = record?.code;
  const data = sanitizeErrorData(record?.data);

  return {
    message,
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    ...(data && typeof data === 'object' && Object.keys(data).length ? { data } : {})
  };
}

/** Produce a JSON-RPC error safe to expose to an untrusted web page. */
export function serializeProviderRpcError(error: unknown): ReturnType<typeof serializeError> {
  const serialized = serializeError(serializeTransportError(error));
  const data = sanitizeErrorData(serialized.data);
  return {
    code: serialized.code,
    message: serialized.message,
    ...(data && typeof data === 'object' && Object.keys(data).length ? { data } : {})
  };
}
