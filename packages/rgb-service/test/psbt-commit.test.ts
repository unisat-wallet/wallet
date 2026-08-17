import { Psbt } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import { commitOpretRgbPsbt, opretHostRecord } from '../src'

describe('commitOpretRgbPsbt', () => {
  it('writes local MPC and RGB records and updates the empty OP_RETURN host', () => {
    const psbt = new Psbt()
    psbt.addInput({ hash: Buffer.alloc(32, 0x55), index: 0 })
    psbt.addOutput({ script: Buffer.from([0x6a]), value: 0 })

    const committed = commitOpretRgbPsbt({
      psbtHex: psbt.toHex(),
      hostVout: 0,
      entropy: 0x0102_0304_0506_0708n,
      messages: [
        {
          protocolId: Uint8Array.from({ length: 32 }, () => 0x11),
          message: Uint8Array.from({ length: 32 }, () => 0x22),
        },
      ],
      transitionId: Uint8Array.from({ length: 32 }, () => 0x33),
      transition: Uint8Array.from([1, 2, 3]),
    })
    const result = Psbt.fromHex(committed.psbtHex)
    expect(result.txOutputs[0]!.script).toEqual(Buffer.from([0x6a, 0x20, ...committed.commitment]))
    expect(result.data.outputs[0]!.unknownKeyVals).toHaveLength(6)
    expect(
      result.data.outputs[0]!.unknownKeyVals?.some(record =>
        record.key.equals(Buffer.from(opretHostRecord().key))
      )
    ).toBe(true)
    expect(result.data.globalMap.unknownKeyVals).toHaveLength(2)
  })
})
