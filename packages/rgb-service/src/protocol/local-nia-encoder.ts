import { Psbt, Transaction } from 'bitcoinjs-lib'
import { RgbServiceError } from '../errors'
import type {
  RgbCompletedTransfer,
  RgbPendingTransfer,
  RgbProtocolEncoder,
  RgbTransferIntent,
  RgbValidationHistory,
} from '../types'
import { completeRgbOpretPsbt } from './complete'
import { normalizeRgbAssetId } from './contract-id'
import { serializeNiaOpretWitnessBundle } from './consignment'
import { verifyRevealedNiaAllocations } from './nia-allocation'
import { decodeNiaConsignment } from './nia-consignment'
import { encodeNiaTransferConsignment } from './nia-contract'
import { mergeNiaConsignmentHistory } from './nia-history'
import { prepareNiaOpretTransfer } from './opret-transfer'
import { witnessSealDustLimit } from './witness'

// rgb-lib requires the sender to attach a dust-safe Bitcoin output to a witness seal.
const WITNESS_RECIPIENT_SATOSHIS = 330

function witnessRecipientSatoshis(
  seal: Extract<import('./invoice').RgbInvoiceSeal, { type: 'witness' }>
) {
  return Math.max(WITNESS_RECIPIENT_SATOSHIS, witnessSealDustLimit(seal))
}

function hex(value: Uint8Array) {
  return Buffer.from(value).toString('hex')
}

function bytes(value: string, name: string) {
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new RgbServiceError(`${name} must be a 32-byte hexadecimal value`)
  return Uint8Array.from(Buffer.from(value, 'hex'))
}

function assetId(value: string) {
  return normalizeRgbAssetId(value)
}

function randomU64() {
  if (!globalThis.crypto?.getRandomValues)
    throw new RgbServiceError('Secure RGB random generation is unavailable')
  const value = new Uint8Array(8)
  globalThis.crypto.getRandomValues(value)
  return value.reduce((total, byte, index) => total | (BigInt(byte) << BigInt(index * 8)), 0n)
}

function metadata(pending: RgbPendingTransfer) {
  const value = pending.prepared.metadata
  if (!value) throw new RgbServiceError('RGB prepared transfer is missing local protocol data')
  return value
}

function parseInputs(value: string) {
  try {
    const inputs = JSON.parse(value)
    if (!Array.isArray(inputs) || !inputs.length) throw new Error('empty')
    return inputs.map(item => {
      if (
        !item ||
        typeof item.opId !== 'string' ||
        !Number.isInteger(item.assignmentType) ||
        !Number.isInteger(item.assignmentIndex)
      ) {
        throw new Error('invalid')
      }
      return {
        opId: item.opId,
        assignmentType: item.assignmentType,
        assignmentIndex: item.assignmentIndex,
      }
    })
  } catch {
    throw new RgbServiceError('RGB prepared transfer contains invalid input history')
  }
}

function parseMetadataIndex(value: string | undefined, name: string) {
  const index = Number(value)
  if (!Number.isInteger(index) || index < 0) throw new RgbServiceError(`${name} is invalid`)
  return index
}

function parseMetadataU64(value: string | undefined, name: string) {
  try {
    const parsed = BigInt(value || '')
    if (parsed < 0n || parsed > 0xffff_ffff_ffff_ffffn) throw new Error('range')
    return parsed
  } catch {
    throw new RgbServiceError(`${name} is invalid`)
  }
}

function parseWitnessBundles(value: string | undefined) {
  try {
    const bundles = JSON.parse(value || '[]')
    if (!Array.isArray(bundles)) throw new Error('invalid')
    return bundles.map(bundle => Uint8Array.from(Buffer.from(bundle, 'base64')))
  } catch {
    throw new RgbServiceError('RGB prepared transfer has invalid WitnessBundle history')
  }
}

function assertSupportedNiaTransfer(history: RgbValidationHistory, intent: RgbTransferIntent) {
  if (!history.consignments.length) {
    throw new RgbServiceError('RGB sending requires complete local NIA consignment history')
  }
  if (intent.transition.preservedAllocations.length) {
    throw new RgbServiceError('Local RGB sending cannot spend UTXOs carrying another asset')
  }
}

function isBlindRecipient(metadata: Record<string, string>) {
  const recipientType = metadata['recipientType']
  // Transfers persisted before witness support only contain blind-recipient metadata.
  if (recipientType === undefined || recipientType === 'blind') return true
  if (recipientType === 'witness') return false
  throw new RgbServiceError('RGB prepared transfer has an invalid recipient type')
}

/**
 * Local NIA sender. Every selected allocation is verified against the supplied
 * consignment history before a spend is constructed, including imported assets.
 */
export const localNiaProtocolEncoder: RgbProtocolEncoder = {
  async prepareTransfer(input) {
    assertSupportedNiaTransfer(input.validationHistory, input.intent)
    const decodedHistory = input.validationHistory.consignments.map(item =>
      decodeNiaConsignment(Uint8Array.from(Buffer.from(item.payload, 'base64')))
    )
    verifyRevealedNiaAllocations({
      consignments: decodedHistory,
      utxos: input.selectedUtxos,
      assetId: input.intent.assetId,
      knownBlindSeals: input.validationHistory.knownBlindSeals,
    })
    const rootId = assetId(input.intent.assetId)
    const allocations = input.selectedUtxos.flatMap(utxo =>
      utxo.allocations.map(allocation => ({ utxo, allocation }))
    )
    if (allocations.some(({ allocation }) => assetId(allocation.assetId) !== rootId)) {
      throw new RgbServiceError('Local RGB transfer can only spend allocations for its own asset')
    }
    const history = mergeNiaConsignmentHistory({
      assetId: input.intent.assetId,
      consignments: input.validationHistory.consignments,
      requiredOpIds: allocations.map(({ allocation }) => allocation.opId || ''),
      knownBlindSeals: input.validationHistory.knownBlindSeals,
    })

    const nonce = randomU64()
    const entropy = randomU64()
    const recipientBlinding = randomU64()
    const changeBlinding = randomU64()

    const prepared = prepareNiaOpretTransfer({
      network: input.wallet.network,
      assetId: input.intent.assetId,
      amount: input.intent.amount,
      selectedUtxos: input.selectedUtxos,
      recipientSeal: input.intent.invoice.seal,
      feeRate: input.request.feeRate,
      ...(input.intent.invoice.seal.type === 'witness'
        ? { witnessAmountSat: witnessRecipientSatoshis(input.intent.invoice.seal) }
        : {}),
      nonce,
      entropy,
      recipientBlinding,
      changeBlinding,
      ...(input.feeFunding === undefined ? {} : { feeFunding: input.feeFunding }),
      ...(input.request.swapPsbt === undefined ? {} : { swapPsbt: input.request.swapPsbt }),
    })
    const feeUtxosByOutpoint = new Map(
      input.feeFunding?.utxos.map(utxo => [`${utxo.outpoint.txid}:${utxo.outpoint.vout}`, utxo]) || []
    )
    return {
      id: hex(prepared.transitionId),
      psbt: prepared.psbtHex,
      toSignInputs: [
        ...input.selectedUtxos.map(utxo => ({
          index: findPsbtInputIndex(prepared.psbtHex, utxo.outpoint.txid, utxo.outpoint.vout),
          publicKey: utxo.publicKey,
          useTweakedSigner: true,
        })),
        ...prepared.feeOutpoints.map(outpoint => ({
          index: findPsbtInputIndex(prepared.psbtHex, outpoint.txid, outpoint.vout),
          publicKey: feeUtxosByOutpoint.get(`${outpoint.txid}:${outpoint.vout}`)!.publicKey,
        })),
      ],
      lockedOutpoints: input.selectedUtxos.map(utxo => utxo.outpoint),
      feeOutpoints: prepared.feeOutpoints,
      metadata: {
        preparedPsbt: prepared.psbtHex,
        hostVout: String(prepared.hostVout),
        commitment: hex(prepared.commitment),
        transitionId: hex(prepared.transitionId),
        transition: hex(prepared.transition),
        bundleId: hex(prepared.bundleId),
        entropy: entropy.toString(),
        genesis: Buffer.from(history.genesis.strict).toString('base64'),
        historyWitnessBundles: JSON.stringify(
          history.witnessBundles.map(bundle => Buffer.from(bundle).toString('base64'))
        ),
        recipientId: input.intent.invoice.recipientId,
        recipientType: input.intent.invoice.recipientType,
        ...(input.intent.invoice.seal.type === 'confidential'
          ? { recipientSecretSeal: hex(input.intent.invoice.seal.secretSeal) }
          : {}),
        fundingScript: input.selectedUtxos[0]!.scriptPubKey,
        fundingPublicKey: input.selectedUtxos[0]!.publicKey,
        changeVout: prepared.changeVout === undefined ? '' : String(prepared.changeVout),
        inputs: JSON.stringify(
          allocations.map(({ allocation }) => ({
            opId: allocation.opId,
            assignmentType: allocation.assignmentType,
            assignmentIndex: allocation.assignmentIndex,
          }))
        ),
      },
    }
  },

  async completeTransfer(input): Promise<RgbCompletedTransfer> {
    const data = metadata(input.pending)
    const completed = completeRgbOpretPsbt({
      preparedPsbt: data['preparedPsbt'] || '',
      signedPsbt: input.signedPsbt,
      hostVout: parseMetadataIndex(data['hostVout'], 'RGB Opret host output'),
      commitment: bytes(data['commitment'] || '', 'RGB Opret commitment'),
    })
    const witnessBundle = serializeNiaOpretWitnessBundle({
      witnessTx: Uint8Array.from(Buffer.from(completed.rawTx, 'hex')),
      contractId: input.pending.request.assetId,
      transitionId: bytes(data['transitionId'] || '', 'RGB transition ID'),
      transition: Uint8Array.from(Buffer.from(data['transition'] || '', 'hex')),
      inputs: parseInputs(data['inputs'] || ''),
      entropy: parseMetadataU64(data['entropy'], 'RGB MPC entropy'),
    })
    if (hex(witnessBundle.bundleId) !== (data['bundleId'] || '').toLowerCase()) {
      throw new RgbServiceError('RGB WitnessBundle does not match the committed transition')
    }
    const genesis = Uint8Array.from(Buffer.from(data['genesis'] || '', 'base64'))
    if (!genesis.length)
      throw new RgbServiceError('RGB prepared transfer is missing its local Genesis')
    const terminals = isBlindRecipient(data)
      ? [
          {
            bundleId: witnessBundle.bundleId,
            secretSeals: [bytes(data['recipientSecretSeal'] || '', 'RGB recipient secret seal')],
          },
        ]
      : []
    const consignment = encodeNiaTransferConsignment({
      genesis: { strict: genesis },
      priorWitnessBundles: parseWitnessBundles(data['historyWitnessBundles']),
      witnessBundle: witnessBundle.strict,
      terminals,
    })
    const decoded = decodeNiaConsignment(consignment)
    if (
      decoded.assetId !== assetId(input.pending.request.assetId) ||
      !decoded.transitions.some(transition => transition.opId === data['transitionId'])
    ) {
      throw new RgbServiceError('Locally encoded RGB Consignment did not round-trip')
    }
    const changeVout =
      data['changeVout'] === ''
        ? undefined
        : parseMetadataIndex(data['changeVout'], 'RGB change output')
    const transaction = Transaction.fromHex(completed.rawTx)
    const changeOutput = changeVout === undefined ? undefined : transaction.outs[changeVout]
    if (changeOutput && changeOutput.script.toString('hex') !== data['fundingScript']) {
      throw new RgbServiceError('RGB change output does not match the funding script')
    }
    const changeAssignment =
      changeVout === undefined
        ? undefined
        : decoded.transitions
            .find(transition => transition.opId === data['transitionId'])
            ?.assignments.map((assignment, assignmentIndex) => ({ assignment, assignmentIndex }))
            .find(
              ({ assignment }) =>
                !('secretSeal' in assignment.seal) &&
                assignment.seal.txid === null &&
                assignment.seal.vout === changeVout
            )
    if (changeOutput && !changeAssignment)
      throw new RgbServiceError('RGB change allocation is missing from the local Transition')
    return {
      txid: completed.txid,
      rawTx: completed.rawTx,
      consignments: [
        {
          recipientId: data['recipientId'] || '',
          payload: Buffer.from(consignment).toString('base64'),
          assetId: input.pending.request.assetId,
          opIds: [data['transitionId'] || ''],
        },
      ],
      fundingUpdate: {
        spentOutpoints: input.pending.prepared.lockedOutpoints,
        ...(changeOutput && changeAssignment
          ? {
              createdUtxo: {
                outpoint: { txid: completed.txid, vout: changeVout! },
                satoshis: changeOutput.value,
                scriptPubKey: data['fundingScript'] || '',
                publicKey: data['fundingPublicKey'] || '',
                allocations: [
                  {
                    assetId: input.pending.request.assetId,
                    amount: changeAssignment.assignment.amount.toString(),
                    settled: true,
                    spendable: true,
                    opId: data['transitionId'],
                    assignmentIndex: changeAssignment.assignmentIndex,
                    assignmentType: 4000,
                  },
                ],
              },
            }
          : {}),
      },
    }
  },
}

function findPsbtInputIndex(psbtHex: string, txid: string, vout: number) {
  const psbt = Psbt.fromHex(psbtHex)
  const transaction = ((psbt.data.globalMap.unsignedTx as any).tx || psbt.data.globalMap.unsignedTx) as any
  const index = transaction.ins.findIndex(
    (input: any) => Buffer.from(input.hash).reverse().toString('hex') === txid && input.index === vout
  )
  if (index < 0) throw new RgbServiceError('RGB prepared PSBT is missing a selected input')
  return index
}
