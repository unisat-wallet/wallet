/**
 * Self-contained vault encryptor for the extension background.
 * Avoids depending on a rebuilt @unisat/keyring-service lib artifact.
 * Same algorithm as packages/keyring-service WebCryptoVaultEncryptor.
 */
const LEGACY_ITERATIONS = 10_000;
const CURRENT_ITERATIONS = 600_000;

type VaultPayload = {
  data: string;
  iv: string;
  salt: string;
  iterations?: number;
};

function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function utf8ToBuffer(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function bufferToUtf8(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return new TextDecoder().decode(bytes);
}

async function deriveAesKey(password: string, saltB64: string, iterations: number): Promise<CryptoKey> {
  const passKey = await crypto.subtle.importKey(
    'raw',
    utf8ToBuffer(password) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToBuffer(saltB64) as BufferSource,
      iterations,
      hash: 'SHA-256'
    },
    passKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function decryptWithIterations(password: string, payload: VaultPayload, iterations: number): Promise<any> {
  const key = await deriveAesKey(password, payload.salt, iterations);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBuffer(payload.iv) as BufferSource },
    key,
    base64ToBuffer(payload.data) as BufferSource
  );
  return JSON.parse(bufferToUtf8(plain));
}

async function encrypt(password: string, data: any): Promise<string> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(32));
  const salt = bufferToBase64(saltBytes);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveAesKey(password, salt, CURRENT_ITERATIONS);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    utf8ToBuffer(JSON.stringify(data)) as BufferSource
  );
  const payload: VaultPayload = {
    data: bufferToBase64(cipher),
    iv: bufferToBase64(iv),
    salt,
    iterations: CURRENT_ITERATIONS
  };
  return JSON.stringify(payload);
}

async function decrypt(password: string, encryptedData: string): Promise<any> {
  const payload = JSON.parse(encryptedData) as VaultPayload;
  if (!payload?.data || !payload?.iv || !payload?.salt) {
    throw new Error('Incorrect password');
  }

  const candidates =
    typeof payload.iterations === 'number' ? [payload.iterations] : [CURRENT_ITERATIONS, LEGACY_ITERATIONS];

  for (const iterations of candidates) {
    try {
      return await decryptWithIterations(password, payload, iterations);
    } catch {
      // try next
    }
  }
  throw new Error('Incorrect password');
}

export const encryptor = {
  encrypt,
  decrypt
};
