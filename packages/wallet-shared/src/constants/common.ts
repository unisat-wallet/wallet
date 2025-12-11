import { KeyringType } from '@unisat/keyring-service/types'

import { AddressType, ChainType, NetworkType } from '@unisat/wallet-types'

import { RestoreWalletType } from '../types'
import { SupportedLocale } from '../types/i18n'

export { ADDRESS_TYPES } from '@unisat/keyring-service/types'

export const KEYRING_CLASS = {
  PRIVATE_KEY: 'Simple Key Pair',
  MNEMONIC: 'HD Key Tree',
  KEYSTONE: 'Keystone',
}

export const KEYRING_TYPE_TEXT = {
  [KeyringType.HdKeyring]: 'Created by Mnemonic',
  [KeyringType.SimpleKeyring]: 'Imported by Private Key',
  [KeyringType.KeystoneKeyring]: 'Import from Keystone',
  [KeyringType.ColdWalletKeyring]: 'Cold Wallet',
}
export const BRAND_ALIAN_TYPE_TEXT = {
  [KeyringType.HdKeyring]: 'Account',
  [KeyringType.SimpleKeyring]: 'Private Key',
  [KeyringType.KeystoneKeyring]: 'Account',
  [KeyringType.ColdWalletKeyring]: 'Account',
}

export const KEYRING_TYPES: {
  [key: string]: {
    name: string
    tag: string
    alianName: string
  }
} = {
  'HD Key Tree': {
    name: 'HD Key Tree',
    tag: 'HD',
    alianName: 'HD Wallet',
  },
  'Simple Key Pair': {
    name: 'Simple Key Pair',
    tag: 'IMPORT',
    alianName: 'Single Wallet',
  },
  Keystone: {
    name: 'Keystone',
    tag: 'KEYSTONE',
    alianName: 'Keystone',
  },
  'Cold Wallet': {
    name: 'Cold Wallet',
    tag: 'COLD',
    alianName: 'Cold Wallet',
  },
}

export const IS_CHROME =
  // @ts-ignore
  typeof navigator !== 'undefined' ? /Chrome\//i.test(navigator.userAgent) : false

export const IS_FIREFOX =
  // @ts-ignore
  typeof navigator !== 'undefined' ? /Firefox\//i.test(navigator.userAgent) : false

export const IS_LINUX =
  // @ts-ignore
  typeof navigator !== 'undefined' ? /linux/i.test(navigator.userAgent) : false

let chromeVersion: number | null = null

if (IS_CHROME) {
  // @ts-ignore
  const matches = navigator.userAgent.match(/Chrome\/(\d+[^.\s])/)
  if (matches && matches.length >= 2) {
    chromeVersion = Number(matches[1])
  }
}

export const IS_AFTER_CHROME91 = IS_CHROME ? chromeVersion && chromeVersion >= 91 : false

export const GAS_LEVEL_TEXT = {
  slow: 'Standard',
  normal: 'Fast',
  fast: 'Instant',
  custom: 'Custom',
}

export const IS_WINDOWS =
  // @ts-ignore
  typeof navigator !== 'undefined' ? /windows/i.test(navigator.userAgent) : false

export const LANGS = [
  {
    value: 'en',
    label: 'English',
  },
  {
    value: 'zh_CN',
    label: 'Chinese',
  },
  {
    value: 'ja',
    label: 'Japanese',
  },
  {
    value: 'es',
    label: 'Spanish',
  },
]

export const OW_HD_PATH = "m/86'/0'/0'"

export const getRestoreWallets = (): {
  value: RestoreWalletType
  name: string
  addressTypes: AddressType[]
}[] => [
  {
    value: RestoreWalletType.UNISAT,
    name: 'UniSat Wallet',
    addressTypes: [
      AddressType.P2WPKH,
      AddressType.P2SH_P2WPKH,
      AddressType.P2TR,
      AddressType.P2PKH,
      AddressType.M44_P2WPKH,
      AddressType.M44_P2TR,
    ],
  },
  {
    value: RestoreWalletType.SPARROW,
    name: 'Sparrow Wallet',
    addressTypes: [
      AddressType.P2PKH,
      AddressType.P2WPKH,
      AddressType.P2SH_P2WPKH,
      AddressType.P2TR,
    ],
  },
  {
    value: RestoreWalletType.XVERSE,
    name: 'Xverse Wallet',
    addressTypes: [AddressType.P2SH_P2WPKH, AddressType.P2TR],
  },
  {
    value: RestoreWalletType.OW,
    name: 'Ordinals Wallet',
    addressTypes: [AddressType.P2TR],
  },
  {
    value: RestoreWalletType.OTHERS,
    name: 'other_wallet',
    addressTypes: [
      AddressType.P2PKH,
      AddressType.P2WPKH,
      AddressType.P2SH_P2WPKH,
      AddressType.P2TR,
      AddressType.M44_P2WPKH,
      AddressType.M44_P2TR,
    ],
  },
]

export const NETWORK_TYPES = [
  {
    value: NetworkType.MAINNET,
    label: 'LIVENET',
    name: 'livenet',
    validNames: [0, 'livenet', 'mainnet'],
  },
  { value: NetworkType.TESTNET, label: 'TESTNET', name: 'testnet', validNames: ['testnet'] },
]

export type TypeChain = {
  enum: ChainType
  label: string
  iconLabel: string
  icon: string
  unit: string
  networkType: NetworkType
  endpoints: string[]
  mempoolSpaceUrl: string
  unisatUrl: string
  ordinalsUrl: string
  contentUrl: string
  unisatExplorerUrl: string
  okxExplorerUrl: string
  isViewTxHistoryInternally?: boolean
  disable?: boolean
  isFractal?: boolean
  showPrice: boolean
  defaultExplorer: 'mempool-space' | 'unisat-explorer'
  enableBrc20SingleStep?: boolean
  enableBrc20Prog?: boolean
  svg?: string
  iconBaseUrl?: string
  enableLowFeeMode?: boolean
}

const PROD_CHAINS_MAP: { [key: string]: TypeChain } = {
  [ChainType.BITCOIN_MAINNET]: {
    enum: ChainType.BITCOIN_MAINNET,
    label: 'Bitcoin',
    iconLabel: 'Bitcoin',
    icon: 'bitcoinMainnet',
    unit: 'BTC',
    networkType: NetworkType.MAINNET,
    endpoints: ['https://wallet-api.unisat.space', 'https://wallet-api.unisat.io'],
    mempoolSpaceUrl: 'https://mempool.space',
    unisatUrl: 'https://link.unisat.space/btc',
    ordinalsUrl: 'https://ordinals.com',
    contentUrl: 'https://static.unisat.space/content',
    unisatExplorerUrl: 'https://uniscan.cc',
    okxExplorerUrl: '',
    showPrice: true,
    defaultExplorer: 'unisat-explorer',
    enableBrc20Prog: true,
    iconBaseUrl: 'https://static.unisat.space/icon',
    enableLowFeeMode: true,
    svg: 'bitcoin-mainnet',
  },
  [ChainType.BITCOIN_TESTNET]: {
    enum: ChainType.BITCOIN_TESTNET,
    label: 'Bitcoin Testnet',
    iconLabel: 'Bitcoin',
    icon: 'bitcoinTestnet',
    unit: 'tBTC',
    networkType: NetworkType.TESTNET,
    endpoints: ['https://wallet-api-testnet.unisat.io'],
    mempoolSpaceUrl: 'https://mempool.space/testnet',
    unisatUrl: 'https://link.unisat.space/testnet',
    ordinalsUrl: 'https://testnet.ordinals.com',
    contentUrl: 'https://testnet-static.unisat.space/content',
    iconBaseUrl: 'https://testnet-static.unisat.space/icon',
    unisatExplorerUrl: '',
    okxExplorerUrl: '',
    showPrice: false,
    defaultExplorer: 'mempool-space',
    svg: 'bitcoin-testnet',
  },
  [ChainType.BITCOIN_TESTNET4]: {
    enum: ChainType.BITCOIN_TESTNET4,
    label: 'Bitcoin Testnet4 (Beta)',
    iconLabel: 'Bitcoin',
    icon: 'bitcoinTestnet',
    unit: 'tBTC',
    networkType: NetworkType.TESTNET,
    endpoints: [
      'https://wallet-api-testnet4.unisat.io',
      'https://wallet-api-testnet4.unisat.space',
    ],
    mempoolSpaceUrl: 'https://mempool.space/testnet4',
    unisatUrl: 'https://link.unisat.space/testnet4',
    ordinalsUrl: 'https://testnet4.ordinals.com',
    contentUrl: 'https://testnet4-static.unisat.space/content',
    iconBaseUrl: 'https://testnet4-static.unisat.space',
    unisatExplorerUrl: '',
    okxExplorerUrl: '',
    showPrice: false,
    defaultExplorer: 'mempool-space',
    svg: 'bitcoin-testnet',
  },
  [ChainType.BITCOIN_SIGNET]: {
    enum: ChainType.BITCOIN_SIGNET,
    label: 'Bitcoin Signet',
    iconLabel: 'Bitcoin',
    icon: 'bitcoinSignet',
    unit: 'sBTC',
    networkType: NetworkType.TESTNET,
    endpoints: ['https://wallet-api-signet.unisat.io', 'https://wallet-api-signet.unisat.space'],
    mempoolSpaceUrl: 'https://mempool.space/signet',
    unisatUrl: 'https://signet.unisat.io',
    ordinalsUrl: 'https://signet.ordinals.com',
    contentUrl: 'https://signet-static.unisat.space/content',
    unisatExplorerUrl: 'https://uniscan.cc/signet',
    iconBaseUrl: 'https://signet-static.unisat.space/icon',
    okxExplorerUrl: '',
    showPrice: false,
    defaultExplorer: 'unisat-explorer',
    enableBrc20Prog: true,
    svg: 'bitcoin-signet',
  },
  [ChainType.FRACTAL_BITCOIN_MAINNET]: {
    enum: ChainType.FRACTAL_BITCOIN_MAINNET,
    label: 'Fractal Bitcoin',
    iconLabel: 'Fractal',
    icon: 'fractal',

    unit: 'FB',
    networkType: NetworkType.MAINNET,
    endpoints: ['https://wallet-api-fractal.unisat.space'],
    mempoolSpaceUrl: 'https://mempool.fractalbitcoin.io',
    unisatUrl: 'https://link.unisat.space/fractal',
    ordinalsUrl: 'https://ordinals.fractalbitcoin.io',
    contentUrl: 'https://fractal-static.unisat.space/content',
    unisatExplorerUrl: 'https://link.unisat.space/uniscan-fractal',
    iconBaseUrl: 'https://fractal-static.unisat.space/icon',
    okxExplorerUrl: '',
    isViewTxHistoryInternally: false,
    disable: false,
    isFractal: true,
    showPrice: true,
    defaultExplorer: 'unisat-explorer',
    enableBrc20SingleStep: true,
    svg: 'fractalbitcoin-mainnet',
  },
  [ChainType.FRACTAL_BITCOIN_TESTNET]: {
    enum: ChainType.FRACTAL_BITCOIN_TESTNET,
    label: 'Fractal Bitcoin Testnet',
    iconLabel: 'Fractal',
    icon: 'fractalTestnet',
    unit: 'tFB',
    networkType: NetworkType.MAINNET,
    endpoints: [
      'https://wallet-api-fractal-testnet.unisat.io',
      'https://wallet-api-fractal-testnet.unisat.space',
    ],
    mempoolSpaceUrl: 'https://mempool-testnet.fractalbitcoin.io',
    unisatUrl: 'https://link.unisat.space/fractal-testnet',
    ordinalsUrl: 'https://ordinals-testnet.fractalbitcoin.io',
    contentUrl: 'https://fractal-testnet-static.unisat.space/content',
    unisatExplorerUrl: 'https://link.unisat.space/uniscan-fractal-testnet',
    iconBaseUrl: 'https://fractal-testnet-static.unisat.space/icon',
    okxExplorerUrl: '',
    isViewTxHistoryInternally: false,
    isFractal: true,
    showPrice: false,
    defaultExplorer: 'unisat-explorer',
    enableBrc20SingleStep: true,
    svg: 'fractalbitcoin-testnet',
  },
}

const DEV_CHAINS_MAP: { [key: string]: TypeChain } = {}

export const CHAINS_MAP = PROD_CHAINS_MAP

export const CHAINS = Object.values(CHAINS_MAP)

export type TypeChainGroup = {
  type: 'single' | 'list'
  chain?: TypeChain
  label?: string
  icon?: string
  items?: TypeChain[]
}

export const PROD_CHAIN_GROUPS: TypeChainGroup[] = [
  {
    type: 'single',
    chain: PROD_CHAINS_MAP[ChainType.BITCOIN_MAINNET]!,
  },
  {
    type: 'list',
    label: 'Bitcoin Testnet',
    icon: 'testnet-all',
    items: [
      PROD_CHAINS_MAP[ChainType.BITCOIN_TESTNET]!,
      PROD_CHAINS_MAP[ChainType.BITCOIN_TESTNET4]!,
      PROD_CHAINS_MAP[ChainType.BITCOIN_SIGNET]!,
    ],
  },
  {
    type: 'single',
    chain: PROD_CHAINS_MAP[ChainType.FRACTAL_BITCOIN_MAINNET]!,
  },
  {
    type: 'single',
    chain: PROD_CHAINS_MAP[ChainType.FRACTAL_BITCOIN_TESTNET]!,
  },
]

export const DEV_CHAIN_GROUPS: TypeChainGroup[] = [
  {
    type: 'single',
    chain: DEV_CHAINS_MAP[ChainType.BITCOIN_MAINNET]!,
  },
  {
    type: 'single',
    chain: DEV_CHAINS_MAP[ChainType.FRACTAL_BITCOIN_MAINNET]!,
  },
]

export const CHAIN_GROUPS = PROD_CHAIN_GROUPS

export const MINIMUM_GAS_LIMIT = 21000

export enum WATCH_ADDRESS_CONNECT_TYPE {
  WalletConnect = 'WalletConnect',
}

export const WALLETCONNECT_STATUS_MAP = {
  PENDING: 1,
  CONNECTED: 2,
  WAITING: 3,
  SIBMITTED: 4,
  REJECTED: 5,
  FAILD: 6,
}

export const INTERNAL_REQUEST_ORIGIN = 'https://unisat.io'

export const INTERNAL_REQUEST_SESSION = {
  name: 'UniSat Wallet',
  origin: INTERNAL_REQUEST_ORIGIN,
  icon: './images/logo/logo@128x.png',
}

export const BUS_EVENTS = {
  broadcastToUI: 'broadcastToUI',
  broadcastToBG: 'broadcastToBG',
}

export const BUS_METHODS = {
  CHAIN_CHANGED: 'chainChanged',
  ACCOUNTS_CHANGED: 'accountsChanged',
  LOCKED: 'walletLocked',
  UNLOCKED: 'walletUnlocked',
  AUTO_LOCKED: 'walletAutoLocked',
  SIGN_FINISHED: 'signFinished',
  LOCALE_CHANGED: 'localeChanged',

  USER_UI_INTERACT: 'USER_UI_INTERACT', // used to notify background script that user has interacted with the UI
}

/**
┌─────────────────────────────────────────────────────────────┐
│ UI (ui-messaging.ts)                                        │
│   ✅ UI_CONTROLLER / UI_OPENAPI / UI_BROADCAST              │
└─────────────────────────────────────────────────────────────┘
                            ↕️
┌─────────────────────────────────────────────────────────────┐
│ Background (messaging.ts)                                   │
│   ✅ receive: UI_CONTROLLER / UI_OPENAPI / UI_BROADCAST        │
│   ✅ send: BG_BROADCAST                                     │
│   ✅ push: BG_TO_CONTENT                                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
        📡 Chrome Extension Port API
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ PortMessage (portMessage.ts)                                │
│   ✅ receive: UNISAT_WALLET_BG_TO_CONTENT                      │
│   ✅ emit: PM_BG_TO_CONTENT                                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Content Script (scriptInjector.ts)                          │
│   ✅ pm.on: PM_BG_TO_CONTENT                                   │
│   ✅ bcm.send: BCM_CONTENT_TO_CHANNEL                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
        📻 BroadcastChannel API
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ BroadcastChannelMessage (broadcastChannelMessage.ts)        │
│   ✅ receive: BCM_CONTENT_TO_CHANNEL                               │
│   ✅ emit: BCM_CHANNEL_TO_PAGE                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ PageProvider (providerCore.ts)                              │
│   ✅ _bcm.on: BCM_CHANNEL_TO_PAGE                               │
│   ✅ provider.emit: 'accountsChanged', 'networkChanged'...  │
└─────────────────────────────────────────────────────────────┘

 */
export const MESSAGE_TYPE = {
  // UI ↔ Background Communication
  UI_CONTROLLER: 'ui_controller', // from ui to bg controller
  UI_OPENAPI: 'ui_openapi', // from ui to bg openapi
  UI_BROADCAST: 'ui_broadcast', // from ui to bg broadcast
  BG_BROADCAST: 'bg_broadcast', // from bg to ui broadcast

  // Background → Content Script (via Port)
  PM_BG_TO_CONTENT: 'pm_bg_to_content',

  // Content Script → BroadcastChannel (via postMessage)
  BCM_CONTENT_TO_CHANNEL: 'bcm_content_to_channel', // content script to channel

  // BroadcastChannel → PageProvider (via emit)
  BCM_CHANNEL_TO_PAGE: 'bcm_channel_to_page', // channel to page provider

  REQUEST: 'request',
  RESPONSE: 'response',
}

export const PORT_CHANNELS = {
  POPUP: 'popup',
}

export const SESSION_EVENTS = {
  chainChanged: 'chainChanged',
  networkChanged: 'networkChanged',
  accountsChanged: 'accountsChanged',
  lock: 'lock',
  unlock: 'unlock',
}

export const COIN_NAME = 'BTC'
export const COIN_SYMBOL = 'BTC'

export const COIN_DUST = 1000

export const TO_LOCALE_STRING_CONFIG = {
  minimumFractionDigits: 8,
}

export const SAFE_DOMAIN_CONFIRMATION = 3

export const GITHUB_URL = 'https://github.com/unisat-wallet/extension'
export const DISCORD_URL = 'https://discord.com/invite/EMskB2sMz8'
export const TWITTER_URL = 'https://twitter.com/unisat_wallet'
export const TELEGRAM_URL = 'https://t.me/unisat_wallet'
export const WEBSITE_URL = 'https://unisat.io'
export const FEEDBACK_URL = 'https://feedback.unisat.io'
export const EMAIL_URL = 'contact@unisat.io'
export const DOCS_URL = 'https://link.unisat.space/docs'
export const MEDIUM_URL = 'https://unisat-wallet.medium.com/'
export const UPDATE_URL =
  'https://chromewebstore.google.com/detail/unisat-wallet/ppbibelpcjmhbdihakflkdcoccbgbkpo'
export const TERMS_OF_SERVICE_URL = 'https://link.unisat.space/terms-of-service-app'
export const PRIVACY_POLICY_URL = 'https://link.unisat.space/privacy-policy-app'
export const LOW_FEE_GUIDE_URL =
  'https://docs.unisat.io/technical/understanding-sub-1-sat-vb-bitcoin-transactions/sub-1-sat-vb-mode-setup-guide'
export const UNCONFIRMED_HEIGHT = 4194303

export const PAYMENT_CHANNELS = {
  moonpay: {
    name: 'MoonPay',
    img: './images/artifacts/moonpay.png',
  },
  alchemypay: {
    name: 'Alchemy Pay',
    img: './images/artifacts/alchemypay.png',
  },

  transak: {
    name: 'Transak',
    img: './images/artifacts/transak.png',
  },
}

export enum HardwareWalletType {
  Keystone = 'keystone',
  Ledger = 'ledger',
  Trezor = 'trezor',
}

export const HARDWARE_WALLETS = {
  [HardwareWalletType.Keystone]: {
    name: 'Keystone',
    img: './images/artifacts/keystone.png',
  },
  [HardwareWalletType.Ledger]: {
    name: 'Ledger',
    img: './images/artifacts/ledger.png',
  },
  [HardwareWalletType.Trezor]: {
    name: 'Trezor',
    img: './images/artifacts/trezor.png',
  },
}

export const getAutoLockTimes = (t: any) => [
  { id: 0, time: 30000, label: `30${t('seconds')}` },
  { id: 1, time: 60000, label: `1${t('minute')}` },
  { id: 2, time: 180000, label: `3${t('minutes')}` },
  { id: 3, time: 300000, label: `5${t('minutes')}` },
  { id: 4, time: 600000, label: `10${t('minutes')}` },
  { id: 5, time: 1800000, label: `30${t('minutes')}` },
  { id: 6, time: 3600000, label: `1${t('hour')}` },
  { id: 7, time: 14400000, label: `4${t('hours')}` },
]

export const getLockTimeInfo = (id: number, t?: any) => {
  const AUTO_LOCK_TIMES = getAutoLockTimes(t || ((s: string) => s))
  const item = AUTO_LOCK_TIMES.find(v => v.id === id)
  if (item) {
    return item
  }
  return AUTO_LOCK_TIMES.find(v => v.id === DEFAULT_LOCKTIME_ID)!
}

export const DEFAULT_LOCKTIME_ID = 2

export const RESTORE_WALLETS: {
  value: RestoreWalletType
  name: string
  addressTypes: AddressType[]
}[] = [
  {
    value: RestoreWalletType.UNISAT,
    name: 'UniSat Wallet',
    addressTypes: [
      AddressType.P2WPKH,
      AddressType.P2SH_P2WPKH,
      AddressType.P2TR,
      AddressType.P2PKH,
      AddressType.M44_P2WPKH,
      AddressType.M44_P2TR,
    ],
  },
  {
    value: RestoreWalletType.SPARROW,
    name: 'Sparrow Wallet',
    addressTypes: [
      AddressType.P2PKH,
      AddressType.P2WPKH,
      AddressType.P2SH_P2WPKH,
      AddressType.P2TR,
    ],
  },
  {
    value: RestoreWalletType.XVERSE,
    name: 'Xverse Wallet',
    addressTypes: [AddressType.P2SH_P2WPKH, AddressType.P2TR],
  },
  {
    value: RestoreWalletType.OW,
    name: 'Ordinals Wallet',
    addressTypes: [AddressType.P2TR],
  },
  {
    value: RestoreWalletType.OTHERS,
    name: 'other_wallet',
    addressTypes: [
      AddressType.P2PKH,
      AddressType.P2WPKH,
      AddressType.P2SH_P2WPKH,
      AddressType.P2TR,
      AddressType.M44_P2WPKH,
      AddressType.M44_P2TR,
    ],
  },
]

export const FALLBACK_LOCALE = 'en'

export const BROWSER_TO_APP_LOCALE_MAP: Record<string, string> = {
  'zh-CN': 'zh_TW',
  'zh-TW': 'zh_TW',
  'zh-Hans': 'zh_TW',
  'zh-Hant': 'zh_TW',
}

export const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'fr', 'es', 'ru', 'ja', 'zh_TW']

export const LOCALE_NAMES = {
  en: 'English',
  zh_TW: '中文(繁體)',
  fr: 'Français',
  es: 'Español',
  ru: 'Русский',
  ja: '日本語',
}

export const DEFAULT_I18N_CONFIG = {
  fallbackLocale: FALLBACK_LOCALE,
  supportedLocales: SUPPORTED_LOCALES,
  debug: false,
}

export enum FeeRateType {
  SLOW,
  AVG,
  FAST,
  CUSTOM,
}
