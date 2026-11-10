const MAX_UI_MESSAGE_DEPTH = 32
const MAX_UI_MESSAGE_NODES = 50_000
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** Methods used by the extension UI through the background wallet proxy. */
const UI_CONTROLLER_METHODS = new Set([
  'abandonRgbAcceptedReceive',
  'abortRgbAcknowledgedSwap',
  'abortRgbVanillaTx',
  'acceptRgbReceive',
  'acceptRgbReceives',
  'activateRgbWriteLease',
  'addAddressFlag',
  'analyzeLocalPsbts',
  'approveRgbProxyEndpoints',
  'boot',
  'cancelRgbReceiveInvoice',
  'changeAddressType',
  'changeKeyring',
  'changePassword',
  'checkRgbInvoiceAvailability',
  'checkWebsite',
  'cosmosSignArbitrary',
  'cosmosSignDirect',
  'cosmosSignPreparedData',
  'createBuyCoinPaymentUrl',
  'createDummyPsbt',
  'createKeyringWithAddress',
  'createKeyringWithColdWallet',
  'createKeyringWithKeystone',
  'createKeyringWithMnemonics',
  'createKeyringWithPreMnemonic',
  'createKeyringWithPrivateKey',
  'createKeyringWithPublicKey',
  'createRgbBlindReceive',
  'getRgbReceiveProxyConfig',
  'createRgbFeePoolTopUpBegin',
  'createRgbFeePoolTopUpEnd',
  'createRgbFeePoolWithdrawBegin',
  'createRgbFeePoolWithdrawEnd',
  'createRgbSendBegin',
  'createRgbSendEnd',
  'createRgbUtxosBegin',
  'createRgbUtxosEnd',
  'getRgbAssetAbandonmentPlan',
  'createRgbAssetAbandonBegin',
  'createRgbAssetAbandonEnd',
  'createRgbWitnessReceive',
  'createSendAlkanesPsbt',
  'createSendAllBTCPsbt',
  'createSendBTCOffsetPsbt',
  'createSendBTCPsbt',
  'createSendInscriptionPsbt',
  'createSendMultipleInscriptionsPsbt',
  'createSendRunesPsbt',
  'createSendTokenStep1',
  'createSendTokenStep2',
  'createSplitInscriptionPsbt',
  'createTmpKeyringWithAddress',
  'createTmpKeyringWithKeystone',
  'createTmpKeyringWithMnemonics',
  'createTmpKeyringWithPreMnemonic',
  'createTmpKeyringWithPrivateKey',
  'createTmpKeyringWithPublicKey',
  'decodePsbt',
  'deleteNotification',
  'deriveAccountsFromXpub',
  'deriveNewAccountFromMnemonic',
  'enableRgbFeature',
  'exportRgbAssetContract',
  'exportRgbBurn',
  'exportRgbBurnConsignment',
  'exportRgbBurnDestination',
  'exportRgbHdBackup',
  'findGroupAssets',
  'genSignCosmosUr',
  'genSignMsgUr',
  'genSignPsbtUr',
  'generatePreMnemonic',
  'getAcceptLowFeeMode',
  'getAccounts',
  'getAddressAlkanesTokenSummary',
  'getAddressAssetOverview',
  'getAddressAssetSummary',
  'getAddressBalance',
  'getAddressBalanceV2',
  'getAddressHistory',
  'getAddressRunesTokenSummary',
  'getAddressSummary',
  'getAlkanesCollectionItems',
  'getAlkanesCollectionList',
  'getAlkanesList',
  'getAlkanesPrice',
  'getAllAddresses',
  'getAllInscriptionList',
  'getAnnouncements',
  'getAppExtra',
  'getAppList',
  'getAppSummary',
  'getApproval',
  'getAssetUtxosAlkanes',
  'getAssetUtxosRunes',
  'getAutoLockTimeId',
  'getBRC20List',
  'getBRC20ProgList',
  'getBRC20RecentHistory',
  'getBRC20Summary',
  'getBRC20TransferableList',
  'getBabylonAddress',
  'getBabylonAddressSummary',
  'getBabylonConfig',
  'getBackgroundInited',
  'getBannerList',
  'getBlockActiveInfo',
  'getBrc20sPrice',
  'getBTCUtxos',
  'getBuyCoinChannelList',
  'getChainType',
  'getCoinPrice',
  'getConnectedSites',
  'getContactByAddressAndChain',
  'getCurrentAccount',
  'getCurrentConnectedSite',
  'getCurrentKeyring',
  'getDeveloperMode',
  'getEnableRBF',
  'getFeeSummary',
  'getInscribeResult',
  'getInscriptionInfo',
  'getInscriptionSummary',
  'getInscriptionUtxoDetail',
  'getIsFirstOpen',
  'getKeyrings',
  'getKeystoneConnectionType',
  'getLocale',
  'getLowFeeSummary',
  'getMnemonics',
  'getMultiAddressAssets',
  'getNetworkType',
  'getNextAlianName',
  'getNotificationUnreadCount',
  'getNotifications',
  'getPrivateKey',
  'getRGBAssetActivity',
  'getRGBAssetBalance',
  'getRGBAssetDetail',
  'getRGBList',
  'getRgbAllocationSummary',
  'getRgbFeePoolInspection',
  'getRgbFeePoolStatus',
  'getRgbFeatureStatus',
  'getRgbFundingAddress',
  'getRgbHdBackupPlan',
  'getRgbInvoiceExpirySeconds',
  'getRgbPendingReceiveInvoices',
  'getRgbProxyApprovalRequirement',
  'getRgbRecoveryCheckpointStatus',
  'getRgbTransfers',
  'getRgbActivityPollingState',
  'getRgbUtxoInspection',
  'getRgbWriteLeaseStatus',
  'getRunesList',
  'getRunesPrice',
  'getShowSafeNotice',
  'getSkippedVersion',
  'getTotalKeyringCount',
  'getVersionDetail',
  'getWalletConfig',
  'hasVault',
  'inscribeBRC20Transfer',
  'inspectRgbBackupFile',
  'isBooted',
  'isReady',
  'isUnlocked',
  'listContacts',
  'lockWallet',
  'parseCosmosSignUr',
  'parseSignMsgUr',
  'parseSignPsbtUr',
  'publishLocalRgbRecoveryConflictResolution',
  'pushTx',
  'queryDomainInfo',
  'readAllNotifications',
  'readApp',
  'readNotification',
  'readTab',
  'rejectApproval',
  'rejectRgbReceive',
  'removeAddressFlag',
  'removeConnectedSite',
  'removeContact',
  'removeKeyring',
  'removePreMnemonics',
  'resolveApproval',
  'resolveConnectApproval',
  'resolveUnlockApproval',
  'restoreLatestRgbRecoveryCheckpoint',
  'restoreRgbBackupFile',
  'retryRgbBroadcast',
  'saveContactsOrder',
  'setAcceptLowFeeMode',
  'setAccountAlianName',
  'setAssetsNewBadgeDismissed',
  'setAutoLockTimeId',
  'setChainType',
  'setDeveloperMode',
  'setEnableRBF',
  'setKeyringAlianName',
  'setLastActiveTime',
  'setLocale',
  'setOpenInSidePanel',
  'setRgbInvoiceExpirySeconds',
  'setShowSafeNotice',
  'setSkippedVersion',
  'signMessage',
  'signPsbtV2',
  'simulateBabylonGas',
  'singleStepTransferBRC20Step1',
  'singleStepTransferBRC20Step2',
  'singleStepTransferBRC20Step3',
  'unlock',
  'updateConnectSite',
  'updateContact',
]) as ReadonlySet<string>

export function isAllowedUiControllerMethod(method: unknown): method is string {
  return typeof method === 'string' && UI_CONTROLLER_METHODS.has(method)
}

export function isValidUiMessageParams(params: unknown): params is unknown[] {
  if (!Array.isArray(params) || params.length > 10) return false
  const seen = new WeakSet<object>()
  const state = { nodes: 0 }
  return params.every(value => isValidUiMessageValue(value, 0, seen, state))
}

export function isValidUiDevelopmentRequest(value: unknown): boolean {
  if (!isPlainObject(value) || !isPlainObject(value['data'])) return false
  if (typeof value['data']['method'] !== 'string') return false
  return isValidUiMessageParams([value])
}

function isValidUiMessageValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  state: { nodes: number }
): boolean {
  state.nodes++
  if (depth > MAX_UI_MESSAGE_DEPTH || state.nodes > MAX_UI_MESSAGE_NODES) return false
  if (
    value === undefined ||
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return true
  }
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true
  if (seen.has(value)) return false
  seen.add(value)

  let valid: boolean
  if (Array.isArray(value)) {
    valid = value.every(item => isValidUiMessageValue(item, depth + 1, seen, state))
  } else if (!isPlainObject(value)) {
    valid = false
  } else {
    valid = Object.entries(value).every(
      ([key, item]) =>
        !FORBIDDEN_OBJECT_KEYS.has(key) && isValidUiMessageValue(item, depth + 1, seen, state)
    )
  }
  seen.delete(value)
  return valid
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
