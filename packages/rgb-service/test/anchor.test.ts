import { describe, expect, it } from 'vitest'
import { ensureOpretAnchor, setOpretHostPayload } from '../src'

const p2tr = Uint8Array.from([0x51, 0x20, ...new Array(32).fill(1)])
const p2wpkh = Uint8Array.from([0x00, 0x14, ...new Array(20).fill(2)])

describe('ensureOpretAnchor', () => {
  it('inserts the host at vout 0 when a transaction has a Taproot output', () => {
    const anchor = ensureOpretAnchor([{ value: 1000n, scriptPubKey: p2tr }])
    expect(anchor).toMatchObject({ hostVout: 0, inserted: true })
    expect([...anchor.outputs[0]!.scriptPubKey]).toEqual([0x6a])
  })

  it('appends the host for a non-Taproot transaction and encodes a direct payload', () => {
    const anchor = ensureOpretAnchor([{ value: 1000n, scriptPubKey: p2wpkh }])
    const committed = setOpretHostPayload(anchor, Uint8Array.from([1, 2, 3]))

    expect(committed.hostVout).toBe(1)
    expect([...committed.outputs[1]!.scriptPubKey]).toEqual([0x6a, 3, 1, 2, 3])
  })

  it('does not add a second host when the transaction already has OP_RETURN', () => {
    const anchor = ensureOpretAnchor([
      { value: 0n, scriptPubKey: Uint8Array.from([0x6a]) },
      { value: 1000n, scriptPubKey: p2tr },
    ])
    expect(anchor).toMatchObject({ hostVout: 0, inserted: false })
    expect(anchor.outputs).toHaveLength(2)
  })
})
