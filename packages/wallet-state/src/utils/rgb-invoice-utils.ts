export type RgbInvoiceType = 'blind' | 'witness' | 'unknown'
export type RgbInvoiceAssignmentKind = 'fungible' | 'nonFungible' | 'inflationRight' | 'any' | 'unknown'

export interface DecodedRgbInvoice {
  invoice: string
  submissionInvoice: string
  valid: boolean
  scheme?: string
  invoiceType: RgbInvoiceType
  contractId?: string
  assetId?: string
  schemaId?: string
  assignmentState?: string
  assignmentKind: RgbInvoiceAssignmentKind
  amount?: string
  assignmentName?: string
  recipientId?: string
  network?: string
  expirationTimestamp?: number
  transportEndpoints: string[]
  query: Record<string, string | string[]>
  pathSegments: string[]
  needsAssetId: boolean
  needsAmount: boolean
  raw: {
    body: string
    path: string
    queryString: string
  }
  error?: string
}

const OMITTED = '~'
const AMOUNT_ALPHABET = 'abcdefghkmnABCDEFGHKMNPQRSTVWXYZ'
const AMOUNT_DECODER = new Map(AMOUNT_ALPHABET.split('').map((char, index) => [char, index]))
function toTextValue(source: any, key: string) {
  const value = source?.[key]
  return value === undefined || value === null || value === '' ? undefined : value.toString()
}

function normalizeOptionalSegment(segment?: string) {
  if (!segment || segment === OMITTED) return undefined
  return segment
}

function normalizeRgbAssetId(assetId?: string) {
  if (!assetId) return undefined
  return assetId.startsWith('rgb:') ? assetId : `rgb:${assetId}`
}

function decodeQueryPart(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch (e) {
    return value
  }
}

function appendQueryValue(
  query: Record<string, string | string[]>,
  key: string,
  value: string
) {
  const current = query[key]
  if (Array.isArray(current)) {
    current.push(value)
  } else if (current !== undefined) {
    query[key] = [current, value]
  } else {
    query[key] = value
  }
}

function parseQuery(queryString: string) {
  const query: Record<string, string | string[]> = {}
  if (!queryString) return query

  queryString.split('&').forEach(part => {
    if (!part) return
    const [rawKey, ...rawValueParts] = part.split('=')
    if (!rawKey) return
    const key = decodeQueryPart(rawKey)
    const value = decodeQueryPart(rawValueParts.join('='))
    appendQueryValue(query, key, value)
  })

  return query
}

function getQueryValue(query: Record<string, string | string[]>, key: string) {
  const value = query[key]
  if (Array.isArray(value)) {
    return value.find(item => item !== '')
  }
  if (value) {
    return value
  }
  return undefined
}

function splitTransportEndpoints(value?: string) {
  if (!value) return []
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function uniqueTransportEndpoints(endpoints: string[]) {
  return [...new Set(endpoints)]
}

function addTransportEndpointsToInvoice(invoice: string, endpoints: string[]) {
  if (!endpoints.length) return invoice

  const queryStart = invoice.indexOf('?')
  const query = parseQuery(queryStart >= 0 ? invoice.slice(queryStart + 1) : '')
  const existingEndpoints = getQueryTransportEndpoints(query)
  const missingEndpoints = endpoints.filter(endpoint => !existingEndpoints.includes(endpoint))
  if (!missingEndpoints.length) return invoice

  return `${invoice}${queryStart >= 0 ? '&' : '?'}endpoints=${encodeURIComponent(
    missingEndpoints.join(',')
  )}`
}

function getQueryTransportEndpoints(query: Record<string, string | string[]>) {
  const values: string[] = []
  const value = query['endpoints']
  if (Array.isArray(value)) {
    value.forEach(item => values.push(...splitTransportEndpoints(item)))
  } else if (value) {
    values.push(...splitTransportEndpoints(value))
  }

  return values
}

function isUnsignedInteger(value?: string) {
  return !!value && /^(0|[1-9][0-9]*)$/.test(value)
}

function decodeFast32AmountToBytes(value: string) {
  let buffer = 0
  let bits = 0
  const bytes: number[] = []

  for (const char of value) {
    const decoded = AMOUNT_DECODER.get(char)
    if (decoded === undefined) return undefined

    buffer = (buffer << 5) | decoded
    bits += 5

    while (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }

  return bytes
}

export function decodeRgbInvoiceAmountState(assignmentState?: string) {
  if (!assignmentState || assignmentState === OMITTED) return undefined

  const bytes = decodeFast32AmountToBytes(assignmentState)
  if (!bytes || bytes.length === 0 || bytes.length > 8) return undefined

  let value = BigInt(0)
  bytes.forEach((byte, index) => {
    value += BigInt(byte) << BigInt(index * 8)
  })

  return value.toString()
}

function getInvoiceType(recipientId?: string): RgbInvoiceType {
  if (!recipientId) return 'unknown'
  if (recipientId.includes(':utxob:')) return 'blind'
  return 'witness'
}

function getNetwork(recipientId?: string) {
  if (!recipientId) return undefined
  const prefix = recipientId.split(':')[0]
  const map: Record<string, string> = {
    bc: 'mainnet',
    tb: 'testnet',
    sb: 'signet',
    tbs: 'signet',
    bcrt: 'regtest',
  }
  return map[prefix] || prefix || undefined
}

function getAssignmentKind(assignmentName?: string, assignmentState?: string): RgbInvoiceAssignmentKind {
  if (!assignmentState || assignmentState === OMITTED) {
    if (assignmentName === 'inflationAllowance') return 'inflationRight'
    if (assignmentName === 'assetOwner') return 'fungible'
    return 'any'
  }
  if (assignmentState.includes('@')) return 'nonFungible'
  if (assignmentName === 'inflationAllowance') return 'inflationRight'
  return 'fungible'
}

function parseJsonInvoice(value: string): DecodedRgbInvoice | undefined {
  if (!value.startsWith('{')) return undefined

  const parsed = JSON.parse(value)
  const invoiceText = toTextValue(parsed, 'invoice')
  if (!invoiceText) return undefined
  const fallback = decodeRgbInvoice(invoiceText)
  const endpointsValue =
    toTextValue(parsed, 'endpoints') || toTextValue(parsed, 'transportEndpoints')
  const envelopeEndpoints = endpointsValue ? splitTransportEndpoints(endpointsValue) : []
  const transportEndpoints = uniqueTransportEndpoints([
    ...fallback.transportEndpoints,
    ...envelopeEndpoints,
  ])

  return {
    ...fallback,
    invoice: invoiceText,
    submissionInvoice: addTransportEndpointsToInvoice(invoiceText, envelopeEndpoints),
    transportEndpoints,
  }
}

export function decodeRgbInvoice(invoice: string): DecodedRgbInvoice {
  const value = invoice.trim()
  const emptyResult: DecodedRgbInvoice = {
    invoice: value,
    submissionInvoice: value,
    valid: false,
    invoiceType: 'unknown',
    assignmentKind: 'unknown',
    transportEndpoints: [],
    query: {},
    pathSegments: [],
    needsAssetId: true,
    needsAmount: true,
    raw: {
      body: '',
      path: '',
      queryString: '',
    },
  }

  if (!value) return emptyResult

  try {
    const jsonResult = parseJsonInvoice(value)
    if (jsonResult) return jsonResult
  } catch (e) {
    return {
      ...emptyResult,
      valid: false,
      error: (e as Error).message,
    }
  }

  const schemeMatch = value.match(/^([a-z][a-z0-9+.-]*):(.*)$/i)
  if (!schemeMatch) {
    return {
      ...emptyResult,
      valid: false,
      error: 'Invalid RGB invoice scheme',
    }
  }

  const scheme = schemeMatch[1]
  const body = schemeMatch[2]
  const queryStart = body.indexOf('?')
  const path = queryStart >= 0 ? body.slice(0, queryStart) : body
  const queryString = queryStart >= 0 ? body.slice(queryStart + 1) : ''
  const pathSegments = path.split('/').filter(segment => segment.length > 0)
  const query = parseQuery(queryString)
  const contractId = normalizeOptionalSegment(pathSegments[0])
  const schemaId = normalizeOptionalSegment(pathSegments[1])
  const assignmentState = normalizeOptionalSegment(pathSegments[2])
  const recipientId = pathSegments[3]
  const queryAmount = getQueryValue(query, 'amount')
  const amount = queryAmount || decodeRgbInvoiceAmountState(assignmentState)
  const queryAssetId = getQueryValue(query, 'assetId')
  const assetId = normalizeRgbAssetId(queryAssetId || contractId)
  const assignmentName = getQueryValue(query, 'assignment_name')
  const expiry = query['expiry']
  const legacyExpiry = query['expirationTimestamp']
  const expirationText = typeof expiry === 'string'
    ? expiry
    : typeof legacyExpiry === 'string' ? legacyExpiry : undefined
  const expiryInvalid = (expiry !== undefined && legacyExpiry !== undefined) ||
    Array.isArray(expiry) ||
    Array.isArray(legacyExpiry) ||
    (expirationText !== undefined && (
      !/^(0|[1-9][0-9]*)$/.test(expirationText) ||
      !Number.isSafeInteger(Number(expirationText))
    ))
  const expirationTimestamp = expiryInvalid || expirationText === undefined
    ? undefined
    : Number(expirationText)

  return {
    invoice: value,
    submissionInvoice: value,
    valid: scheme.toLowerCase() === 'rgb' && pathSegments.length >= 4 && !expiryInvalid,
    ...(expiryInvalid ? { error: 'RGB invoice expiry is invalid or ambiguous' } : {}),
    scheme,
    invoiceType: getInvoiceType(recipientId),
    contractId,
    assetId,
    schemaId,
    assignmentState,
    assignmentKind: getAssignmentKind(assignmentName, assignmentState),
    amount,
    assignmentName,
    recipientId,
    network: getNetwork(recipientId),
    expirationTimestamp,
    transportEndpoints: getQueryTransportEndpoints(query),
    query,
    pathSegments,
    needsAssetId: !assetId,
    needsAmount: !isUnsignedInteger(amount) || amount === '0',
    raw: {
      body,
      path,
      queryString,
    },
  }
}

export function getRgbInvoiceAmount(invoice: string) {
  return decodeRgbInvoice(invoice).amount
}

export function getRgbInvoiceAssetId(invoice: string) {
  return decodeRgbInvoice(invoice).assetId
}
