import { Buffer } from 'buffer'
import * as encoding from '@cosmjs/encoding'
import { makeSignBytes } from '@cosmjs/proto-signing'
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx.js'
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys.js'
import { MsgWithdrawDelegatorReward } from 'cosmjs-types/cosmos/distribution/v1beta1/tx.js'
import {
  MsgBeginRedelegate,
  MsgDelegate,
  MsgUndelegate,
} from 'cosmjs-types/cosmos/staking/v1beta1/tx.js'
import { BinaryReader } from 'cosmjs-types/binary.js'
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing.js'
import { AuthInfo, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js'

export const MAX_COSMOS_MEMO_LENGTH = 256
const MAX_COSMOS_BODY_BYTES = 256 * 1024
const MAX_COSMOS_AUTH_INFO_BYTES = 64 * 1024

export interface CosmosDirectSignDocInput {
  bodyBytes: unknown
  authInfoBytes: unknown
  chainId: unknown
  accountNumber: unknown
}

export interface CosmosSignAmount {
  denom: string
  amount: string
}

export interface CosmosMessageSummary {
  type: string
  signer?: string
  recipient?: string
  validator?: string
  sourceValidator?: string
  destinationValidator?: string
  amounts?: CosmosSignAmount[]
}

export interface CosmosDirectSignSummary {
  chainId: string
  accountNumber: string
  sequence: string
  memo: string
  fee: {
    amounts: CosmosSignAmount[]
    gasLimit: string
    payer?: string
    granter?: string
  }
  messages: CosmosMessageSummary[]
}

export interface CosmosDirectSignConstraints {
  chainId?: string
  signerAddress?: string
  publicKeyHex?: string
  accountNumber?: string | number | bigint
  sequence?: string | number | bigint
}

export interface ValidatedCosmosDirectSignDoc {
  signDoc: {
    bodyBytes: Uint8Array
    authInfoBytes: Uint8Array
    chainId: string
    accountNumber: string
  }
  signBytesHex: string
  summary: CosmosDirectSignSummary
}

export function assertValidCosmosMemo(memo: unknown): asserts memo is string {
  if (typeof memo !== 'string') {
    throw new Error('Invalid Cosmos memo')
  }
  if (Array.from(memo).length > MAX_COSMOS_MEMO_LENGTH) {
    throw new Error(`Cosmos memo must not exceed ${MAX_COSMOS_MEMO_LENGTH} characters`)
  }
}

export function sortObjectByKey(obj: Record<string, any>): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectByKey)
  }
  const sortedKeys = Object.keys(obj).sort()
  const result: Record<string, any> = {}
  sortedKeys.forEach(key => {
    result[key] = sortObjectByKey(obj[key])
  })
  return result
}

export function sortedJsonByKeyStringify(obj: Record<string, any>): string {
  return JSON.stringify(sortObjectByKey(obj))
}

export function escapeHTML(str: string): string {
  return str.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

export function serializeSignDoc(signDoc: any): Uint8Array {
  // @ts-ignore
  return Buffer.from(escapeHTML(sortedJsonByKeyStringify(signDoc)))
}

export function makeADR36AminoSignDoc(signer: string, data: string | Uint8Array) {
  if (typeof data === 'string') {
    data = Buffer.from(data).toString('base64')
  } else {
    data = Buffer.from(data).toString('base64')
  }

  return {
    chain_id: '',
    account_number: '0',
    sequence: '0',
    fee: {
      gas: '0',
      amount: [],
    },
    msgs: [
      {
        type: 'sign/MsgSignData',
        value: {
          signer,
          data,
        },
      },
    ],
    memo: '',
  }
}

export function encodeSecp256k1Pubkey(pubkey: Uint8Array): any {
  if (pubkey.length !== 33 || (pubkey[0] !== 0x02 && pubkey[0] !== 0x03)) {
    throw new Error(
      'Public key must be compressed secp256k1, i.e. 33 bytes starting with 0x02 or 0x03'
    )
  }
  return {
    type: 'tendermint/PubKeySecp256k1',
    value: Buffer.from(pubkey).toString('base64'),
  }
}

export function encodeSecp256k1Signature(pubkey: Uint8Array, signature: Uint8Array): any {
  if (signature.length !== 64) {
    throw new Error(
      'Signature must be 64 bytes long. Cosmos SDK uses a 2x32 byte fixed length encoding for the secp256k1 signature integers r and s.'
    )
  }

  return {
    pub_key: encodeSecp256k1Pubkey(pubkey),
    signature: Buffer.from(signature).toString('base64'),
  }
}

export const objToUint8Array = (obj: unknown): Uint8Array => {
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

function parseUnsignedInteger(value: unknown, name: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`Invalid Cosmos ${name}`)
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid Cosmos ${name}`)
    return BigInt(value)
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Invalid Cosmos ${name}`)
  }
  return BigInt(value)
}

function assertByteLength(bytes: Uint8Array, name: string, maximum: number) {
  if (bytes.length === 0 || bytes.length > maximum) {
    throw new Error(`Invalid Cosmos ${name}`)
  }
}

function coinToSummary(coin: { denom: string; amount: string }): CosmosSignAmount {
  if (!coin.denom || !/^(0|[1-9]\d*)$/.test(coin.amount)) {
    throw new Error('Invalid Cosmos coin')
  }
  return { denom: coin.denom, amount: coin.amount }
}

function decodeWrappedStakingMessage<T>(
  value: Uint8Array,
  decode: (reader: BinaryReader, length: number) => T
): T {
  const reader = new BinaryReader(value)
  let message: T | undefined

  while (reader.pos < reader.len) {
    const tag = reader.uint32()
    if (tag >>> 3 === 1) {
      if ((tag & 7) !== 2) throw new Error('Invalid wrapped staking message')
      message = decode(reader, reader.uint32())
    } else {
      reader.skipType(tag & 7)
    }
  }

  if (!message) throw new Error('Invalid wrapped staking message')
  return message
}

function delegateToSummary(
  type: string,
  message: ReturnType<typeof MsgDelegate.decode>
): CosmosMessageSummary {
  if (!message.delegatorAddress || !message.validatorAddress || !message.amount) {
    throw new Error('Invalid MsgDelegate')
  }
  return {
    type,
    signer: message.delegatorAddress,
    validator: message.validatorAddress,
    amounts: [coinToSummary(message.amount)],
  }
}

function undelegateToSummary(
  type: string,
  message: ReturnType<typeof MsgUndelegate.decode>
): CosmosMessageSummary {
  if (!message.delegatorAddress || !message.validatorAddress || !message.amount) {
    throw new Error('Invalid MsgUndelegate')
  }
  return {
    type,
    signer: message.delegatorAddress,
    validator: message.validatorAddress,
    amounts: [coinToSummary(message.amount)],
  }
}

function redelegateToSummary(
  type: string,
  message: ReturnType<typeof MsgBeginRedelegate.decode>
): CosmosMessageSummary {
  if (
    !message.delegatorAddress ||
    !message.validatorSrcAddress ||
    !message.validatorDstAddress ||
    !message.amount
  ) {
    throw new Error('Invalid MsgBeginRedelegate')
  }
  return {
    type,
    signer: message.delegatorAddress,
    sourceValidator: message.validatorSrcAddress,
    destinationValidator: message.validatorDstAddress,
    amounts: [coinToSummary(message.amount)],
  }
}

function decodeMessageSummary(typeUrl: string, value: Uint8Array): CosmosMessageSummary {
  switch (typeUrl) {
    case '/cosmos.bank.v1beta1.MsgSend': {
      const message = MsgSend.decode(value)
      if (!message.fromAddress || !message.toAddress || message.amount.length === 0) {
        throw new Error('Invalid MsgSend')
      }
      return {
        type: typeUrl,
        signer: message.fromAddress,
        recipient: message.toAddress,
        amounts: message.amount.map(coinToSummary),
      }
    }
    case '/cosmos.staking.v1beta1.MsgDelegate': {
      return delegateToSummary(typeUrl, MsgDelegate.decode(value))
    }
    case '/cosmos.staking.v1beta1.MsgUndelegate': {
      return undelegateToSummary(typeUrl, MsgUndelegate.decode(value))
    }
    case '/cosmos.staking.v1beta1.MsgBeginRedelegate': {
      return redelegateToSummary(typeUrl, MsgBeginRedelegate.decode(value))
    }
    case '/babylon.epoching.v1.MsgWrappedDelegate': {
      const message = decodeWrappedStakingMessage(value, (reader, length) =>
        MsgDelegate.decode(reader, length)
      )
      return delegateToSummary(typeUrl, message)
    }
    case '/babylon.epoching.v1.MsgWrappedUndelegate': {
      const message = decodeWrappedStakingMessage(value, (reader, length) =>
        MsgUndelegate.decode(reader, length)
      )
      return undelegateToSummary(typeUrl, message)
    }
    case '/babylon.epoching.v1.MsgWrappedBeginRedelegate': {
      const message = decodeWrappedStakingMessage(value, (reader, length) =>
        MsgBeginRedelegate.decode(reader, length)
      )
      return redelegateToSummary(typeUrl, message)
    }
    case '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward': {
      const message = MsgWithdrawDelegatorReward.decode(value)
      if (!message.delegatorAddress || !message.validatorAddress) {
        throw new Error('Invalid MsgWithdrawDelegatorReward')
      }
      return {
        type: typeUrl,
        signer: message.delegatorAddress,
        validator: message.validatorAddress,
      }
    }
    default:
      return { type: typeUrl }
  }
}

export function validateCosmosDirectSignDoc(
  input: CosmosDirectSignDocInput,
  constraints: CosmosDirectSignConstraints = {}
): ValidatedCosmosDirectSignDoc {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid Cosmos signDoc')
  }

  const bodyBytes = objToUint8Array(input.bodyBytes)
  const authInfoBytes = objToUint8Array(input.authInfoBytes)
  assertByteLength(bodyBytes, 'TxBody', MAX_COSMOS_BODY_BYTES)
  assertByteLength(authInfoBytes, 'AuthInfo', MAX_COSMOS_AUTH_INFO_BYTES)

  if (typeof input.chainId !== 'string' || !input.chainId) {
    throw new Error('Invalid Cosmos chainId')
  }
  if (constraints.chainId !== undefined && input.chainId !== constraints.chainId) {
    throw new Error('Cosmos chainId does not match the requested chain')
  }

  const accountNumber = parseUnsignedInteger(input.accountNumber, 'accountNumber')
  if (
    constraints.accountNumber !== undefined &&
    accountNumber !== parseUnsignedInteger(constraints.accountNumber, 'accountNumber')
  ) {
    throw new Error('Cosmos accountNumber does not match the current account')
  }

  let txBody: TxBody
  let authInfo: AuthInfo
  try {
    txBody = TxBody.decode(bodyBytes)
    authInfo = AuthInfo.decode(authInfoBytes)
  } catch {
    throw new Error('Invalid Cosmos SignDoc encoding')
  }

  if (txBody.messages.length === 0 || txBody.messages.length > 64) {
    throw new Error('Cosmos SignDoc must contain between 1 and 64 messages')
  }
  assertValidCosmosMemo(txBody.memo)

  if (authInfo.signerInfos.length !== 1) {
    throw new Error('Cosmos SignDoc must contain exactly one signer')
  }
  const signerInfo = authInfo.signerInfos[0]!
  if (signerInfo.modeInfo?.single?.mode !== SignMode.SIGN_MODE_DIRECT) {
    throw new Error('Cosmos SignDoc must use SIGN_MODE_DIRECT')
  }
  if (!signerInfo.publicKey || signerInfo.publicKey.typeUrl !== '/cosmos.crypto.secp256k1.PubKey') {
    throw new Error('Cosmos SignDoc must include a secp256k1 public key')
  }

  let signerPublicKey: Uint8Array
  try {
    signerPublicKey = PubKey.decode(signerInfo.publicKey.value).key
  } catch {
    throw new Error('Invalid Cosmos signer public key')
  }
  if (signerPublicKey.length !== 33 || (signerPublicKey[0] !== 0x02 && signerPublicKey[0] !== 0x03)) {
    throw new Error('Invalid Cosmos signer public key')
  }
  if (
    constraints.publicKeyHex !== undefined &&
    encoding.toHex(signerPublicKey) !== constraints.publicKeyHex.toLowerCase()
  ) {
    throw new Error('Cosmos signer public key does not match the current account')
  }

  if (
    constraints.sequence !== undefined &&
    signerInfo.sequence !== parseUnsignedInteger(constraints.sequence, 'sequence')
  ) {
    throw new Error('Cosmos sequence does not match the current account')
  }

  const messages = txBody.messages.map(message => {
    if (!message.typeUrl.startsWith('/') || message.value.length === 0) {
      throw new Error('Invalid Cosmos message')
    }
    try {
      return decodeMessageSummary(message.typeUrl, message.value)
    } catch {
      throw new Error(`Invalid Cosmos message: ${message.typeUrl}`)
    }
  })
  if (
    constraints.signerAddress !== undefined &&
    messages.some(message => message.signer && message.signer !== constraints.signerAddress)
  ) {
    throw new Error('Cosmos message signer does not match the current account')
  }

  const normalizedSignDoc = {
    bodyBytes,
    authInfoBytes,
    chainId: input.chainId,
    accountNumber: accountNumber.toString(),
  }
  const signBytes = makeSignBytes({ ...normalizedSignDoc, accountNumber })
  if (signBytes.length === 32) {
    throw new Error('Refusing unsafe 32-byte Cosmos signing payload')
  }

  return {
    signDoc: normalizedSignDoc,
    signBytesHex: encoding.toHex(signBytes),
    summary: {
      chainId: input.chainId,
      accountNumber: accountNumber.toString(),
      sequence: signerInfo.sequence.toString(),
      memo: txBody.memo,
      fee: {
        amounts: (authInfo.fee?.amount || []).map(coinToSummary),
        gasLimit: (authInfo.fee?.gasLimit || 0n).toString(),
        payer: authInfo.fee?.payer || undefined,
        granter: authInfo.fee?.granter || undefined,
      },
      messages,
    },
  }
}

export function directSignDocToBytesHex(signDoc: any): string {
  return validateCosmosDirectSignDoc(signDoc).signBytesHex
}

export function arbitrarySignDocToBytesHex(signerAddress: string, data: any): string {
  const signDoc = makeADR36AminoSignDoc(signerAddress, data)
  const signBytes = serializeSignDoc(signDoc)
  return encoding.toHex(signBytes)
}

export function encodeSignature(publicKey: string, signature: string) {
  return encodeSecp256k1Signature(encoding.fromHex(publicKey), encoding.fromHex(signature))
}
