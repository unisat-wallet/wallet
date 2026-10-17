export function objToUint8Array(obj: unknown): Uint8Array {
  if (obj instanceof Uint8Array) {
    return Uint8Array.from(obj)
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('Invalid byte array')
  }

  const keys = Object.keys(obj)
  const bytes = new Uint8Array(keys.length)
  for (const key of keys) {
    if (!/^(0|[1-9]\d*)$/.test(key)) {
      throw new Error('Invalid byte array index')
    }
    const index = Number(key)
    if (!Number.isSafeInteger(index) || index >= keys.length) {
      throw new Error('Invalid byte array index')
    }
    const value = (obj as Record<string, unknown>)[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error('Invalid byte array value')
    }
    bytes[index] = value
  }
  return bytes
}
