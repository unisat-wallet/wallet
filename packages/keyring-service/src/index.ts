// Main service class
export { KeyringService, normalizeMnemonic } from './keyring-service'

// Keyring implementations
export {
  SimpleKeyring,
  HdKeyring,
  KeystoneKeyring,
  ColdWalletKeyring,
  WatchAddressKeyring,
  isKeystoneSupportedHdPath,
  KEYSTONE_SUPPORTED_HD_PATH,
} from './keyrings'

// encryptor
export { BrowserPassworderEncryptor } from './encryptor/browser-encryptor'
export {
  WebCryptoVaultEncryptor,
  webCryptoVaultEncryptor,
} from './encryptor/webcrypto-vault-encryptor'
export { SimpleEncryptor } from './encryptor/simple-encryptor'

export * from './types'
