import { describe, expect, it } from 'vitest'

import { RiskType } from '@unisat/wallet-shared'
import { bitcoin, eccManager, toXOnly } from '@unisat/wallet-bitcoin'
import { tapleafHash } from 'bitcoinjs-lib/src/payments/bip341.js'
import {
  getSigningPubkeyRisk,
  validateTaprootSigningSelection,
} from '../src/utils/psbt-signing-risk'

const ownerPubkey = Buffer.from(
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  'hex'
)
const unrelatedPubkey = Buffer.from(
  '02c6047f9441ed7d6d3045406e95c07cd85a2b1a7bca24fd754c182fdc9e02a3',
  'hex'
)

function createPsbt(script: Buffer) {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin })
  psbt.addInput({
    hash: Buffer.alloc(32, 1),
    index: 0,
    witnessUtxo: { script, value: 10_000 },
  })
  psbt.addOutput({ script: Buffer.from([bitcoin.opcodes.OP_RETURN]), value: 0 })
  return psbt
}

function createTaprootPsbt(leafScript: Buffer) {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin })
  psbt.addInput({
    hash: Buffer.alloc(32, 2),
    index: 0,
    witnessUtxo: {
      script: bitcoin.script.compile([bitcoin.opcodes.OP_1, Buffer.alloc(32, 3)]),
      value: 10_000,
    },
    tapLeafScript: [
      {
        leafVersion: 0xc0,
        script: leafScript,
        controlBlock: Buffer.concat([Buffer.from([0xc0]), Buffer.alloc(32, 4)]),
      },
    ],
  })
  psbt.addOutput({ script: Buffer.from([bitcoin.opcodes.OP_RETURN]), value: 0 })
  return psbt
}

function getTapleafHash(script: Buffer) {
  const version = Buffer.from([0xc0])
  const length = Buffer.from([script.length])
  return bitcoin.crypto.taggedHash('TapLeaf', Buffer.concat([version, length, script]))
}

describe('PSBT signing pubkey risk', () => {
  it('does not warn when the signing pubkey matches the input script', () => {
    const script = bitcoin.payments.p2wpkh({ pubkey: ownerPubkey }).output!
    const psbt = createPsbt(script)

    expect(
      getSigningPubkeyRisk(psbt.toHex(), [{ index: 0, publicKey: ownerPubkey.toString('hex') }])
    ).toBeUndefined()
  })

  it('warns instead of rejecting a signing pubkey absent from a standard script', () => {
    const script = bitcoin.payments.p2wpkh({ pubkey: ownerPubkey }).output!
    const psbt = createPsbt(script)

    expect(
      getSigningPubkeyRisk(psbt.toHex(), [
        { index: 0, publicKey: unrelatedPubkey.toString('hex') },
      ])
    ).toMatchObject({
      type: RiskType.SIGNING_PUBKEY_NOT_IN_SCRIPT,
      level: 'danger',
    })
  })

  it('warns for a specialized non-Taproot script that does not reference the pubkey', () => {
    const psbt = createPsbt(bitcoin.script.compile([bitcoin.opcodes.OP_TRUE]))

    expect(
      getSigningPubkeyRisk(psbt.toHex(), [{ index: 0, publicKey: ownerPubkey.toString('hex') }])
    ).toMatchObject({ type: RiskType.SIGNING_PUBKEY_NOT_IN_SCRIPT })
  })

  it('does not warn for an automatically filtered specialized tapleaf', () => {
    const psbt = createTaprootPsbt(bitcoin.script.compile([bitcoin.opcodes.OP_TRUE]))

    expect(
      getSigningPubkeyRisk(psbt.toHex(), [{ index: 0, publicKey: ownerPubkey.toString('hex') }])
    ).toBeUndefined()
  })

  it('rejects before approval when implicit Taproot leaf selection cannot find the pubkey', () => {
    const psbt = createTaprootPsbt(bitcoin.script.compile([bitcoin.opcodes.OP_TRUE]))

    expect(() =>
      validateTaprootSigningSelection(psbt.toHex(), [
        { index: 0, publicKey: ownerPubkey.toString('hex') },
      ])
    ).toThrow('specialized leaves require an explicit tapLeafHashToSign')
  })

  it('warns when a specialized tapleaf without the pubkey is explicitly selected', () => {
    const leafScript = bitcoin.script.compile([bitcoin.opcodes.OP_TRUE])
    const psbt = createTaprootPsbt(leafScript)

    expect(
      getSigningPubkeyRisk(psbt.toHex(), [
        {
          index: 0,
          publicKey: ownerPubkey.toString('hex'),
          tapLeafHashToSign: getTapleafHash(leafScript),
        },
      ])
    ).toMatchObject({
      type: RiskType.SIGNING_PUBKEY_NOT_IN_SCRIPT,
      level: 'danger',
    })

    expect(() =>
      validateTaprootSigningSelection(psbt.toHex(), [
        {
          index: 0,
          publicKey: ownerPubkey.toString('hex'),
          tapLeafHashToSign: getTapleafHash(leafScript),
        },
      ])
    ).not.toThrow()
  })

  it('does not warn when the explicitly selected tapleaf references the x-only pubkey', () => {
    const leafScript = bitcoin.script.compile([
      ownerPubkey.slice(1),
      bitcoin.opcodes.OP_CHECKSIG,
    ])
    const psbt = createTaprootPsbt(leafScript)

    expect(
      getSigningPubkeyRisk(psbt.toHex(), [
        {
          index: 0,
          publicKey: ownerPubkey.toString('hex'),
          tapLeafHashToSign: getTapleafHash(leafScript),
        },
      ])
    ).toBeUndefined()
  })

  it('signs a pubkey-less tapleaf only when its hash is explicitly selected', () => {
    const signer = eccManager.eccPair.fromPrivateKey(Buffer.alloc(32, 1))
    const internalKey = toXOnly(
      eccManager.eccPair.fromPrivateKey(Buffer.alloc(32, 2)).publicKey
    )
    const leaf = {
      output: bitcoin.script.compile([bitcoin.opcodes.OP_TRUE]),
      version: 0xc0,
    }
    const payment = bitcoin.payments.p2tr({
      internalPubkey: internalKey,
      scriptTree: leaf,
      redeem: leaf,
      network: bitcoin.networks.bitcoin,
    })
    const controlBlock = payment.witness![payment.witness!.length - 1]!
    const createSignablePsbt = () => {
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin })
      psbt.addInput({
        hash: Buffer.alloc(32, 5),
        index: 0,
        witnessUtxo: { script: payment.output!, value: 10_000 },
        tapLeafScript: [
          {
            leafVersion: leaf.version,
            script: leaf.output,
            controlBlock,
          },
        ],
      })
      psbt.addOutput({ script: Buffer.from([bitcoin.opcodes.OP_RETURN]), value: 0 })
      return psbt
    }

    expect(() => createSignablePsbt().signTaprootInput(0, signer)).toThrow(
      'Can not sign for input'
    )

    const explicitlySelected = createSignablePsbt()
    explicitlySelected.signTaprootInput(0, signer, tapleafHash(leaf))
    expect(explicitlySelected.data.inputs[0]!.tapScriptSig).toHaveLength(1)
  })
})
