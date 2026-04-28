import { bitcoin, toPsbtNetwork } from '@unisat/wallet-bitcoin'
import { AlkanesBalance, Risk, RiskType, RuneBalance, ToSignData } from '@unisat/wallet-shared'
import { NetworkType } from '@unisat/wallet-types'

const CAT20_TRANSFER_SIG_SIZE = 5229
const CAT20_GUARD_SIG_SIZE = 3650

function isDangerousSighashType(sighashType?: number): boolean {
  if (typeof sighashType !== 'number') return false
  const outputType = sighashType & bitcoin.Transaction.SIGHASH_OUTPUT_MASK
  return outputType === bitcoin.Transaction.SIGHASH_NONE
}

interface InputInfo {
  txid: string
  vout: number
  address: string
  value: number
  inscriptions: {
    inscriptionId: string
    inscriptionNumber?: number
    offset: number
  }[]
  runes: RuneBalance[]
  sighashType: number
  onchain: boolean
  height?: number
  brc20Count: number
  alkanes: AlkanesBalance[]
}

interface OutputInfo {
  address: string
  value: number
  inscriptions: {
    inscriptionId: string
    inscriptionNumber: number
    offset: number
  }[]
  runes: RuneBalance[]
  alkanes: AlkanesBalance[]
  isOpReturn?: boolean
  isUnspendableGenesis?: boolean
  isUnspendableLegacy?: boolean
}

export interface FeeRateThresholds {
  tooLow: number
  tooHigh: number
  recommended: number
}

export class PsbtDecoder {
  _psbt: bitcoin.Psbt
  _opreturnDataLength: number = 0
  _opreturnDataString: string = ''
  _inputInfos: InputInfo[] = []
  _outputInfos: OutputInfo[] = []
  _network: bitcoin.Network
  _cat20: boolean = false
  _isCompleted: boolean = false
  _fee: number = 0
  _feeRateToCheck: number = 0
  _feeRate: string = '-'
  _shouldWarnFeeRate: boolean = false
  sigSize: number = 0
  private _recommendedFeeRate = 1
  private _tooLowFeeRate = 1
  private _tooHighFeeRate = 1

  risks: Risk[] = []

  constructor({
    toSignData,
    networkType,
    feeRateThresholds,
  }: {
    toSignData: ToSignData
    networkType: NetworkType
    feeRateThresholds?: FeeRateThresholds
  }) {
    this._psbt = bitcoin.Psbt.fromHex(toSignData.psbtHex)
    this._network = toPsbtNetwork(networkType)
    if (feeRateThresholds) {
      this._tooLowFeeRate = feeRateThresholds.tooLow
      this._tooHighFeeRate = feeRateThresholds.tooHigh
      this._recommendedFeeRate = feeRateThresholds.recommended
    }
  }

  async decode() {
    this.checkSigHashTypes()

    this.initOutputs()

    this.checkCAT20Tx()

    this.initInputs()

    this.initCompleted()

    this.initFee()

    this.checkFeeRate()

    return {
      inputInfos: this._inputInfos,
      outputInfos: this._outputInfos,
      feeRate: this._feeRate,
      fee: this._fee,
      isCompleted: this._isCompleted,
      risks: this.risks,
      recommendedFeeRate: this._recommendedFeeRate,
      shouldWarnFeeRate: this._shouldWarnFeeRate,
    }
  }

  initOutputs() {
    this._psbt.txOutputs.forEach(v => {
      let isOpReturn = false
      let address = ''
      if (v.address) {
        address = v.address
      } else if (v.script) {
        if (v.script[0] === 0x6a) {
          let opreutrnDataString = 'OP_RETURN '
          let curScript = v.script.slice(1)
          let safeIdx = 0
          while (curScript.length > 0) {
            const len = parseInt(curScript.slice(0, 1).toString('hex'), 16)
            opreutrnDataString += curScript.slice(1, len + 1).toString('hex') + ' '
            curScript = curScript.slice(len + 1)
            safeIdx++
            if (safeIdx > 10) {
              break
            }
          }
          address = opreutrnDataString

          if (this._opreturnDataLength === 0) {
            this._opreturnDataLength = v.script.length
            this._opreturnDataString = opreutrnDataString
          }

          isOpReturn = true
        } else {
          address = v.script.toString('hex')
        }
      }
      this._outputInfos.push({
        address,
        value: v.value,
        inscriptions: [],
        runes: [],
        alkanes: [],
        isOpReturn,
      })
    })
  }

  initInputs() {
    let sigSize = 0

    let hasRbf = false

    this._psbt.txInputs.forEach((v, index) => {
      let address = 'UNKNOWN SCRIPT'
      let value = 0

      try {
        const input = this._psbt.data.inputs[index]!
        const { witnessUtxo, nonWitnessUtxo } = input
        if (witnessUtxo) {
          address = bitcoin.address.fromOutputScript(witnessUtxo.script, this._network)
          value = witnessUtxo.value
        } else if (nonWitnessUtxo) {
          const tx = bitcoin.Transaction.fromBuffer(nonWitnessUtxo)
          const output = tx.outs[this._psbt.txInputs[index]!.index]!
          address = bitcoin.address.fromOutputScript(output.script, this._network)
          value = output.value
        } else {
          // todo
        }

        if (address.indexOf('3') == 0 || address.indexOf('2') == 0) {
          if (input.finalScriptSig) {
            sigSize += input.finalScriptSig.length
          } else {
            sigSize += 23
          }
        } else if (address.indexOf('1') == 0 || address.indexOf('m') == 0) {
          if (input.finalScriptSig) {
            sigSize += input.finalScriptSig.length
          } else {
            sigSize += 106
          }
        }

        if (input.finalScriptWitness) {
          sigSize += input.finalScriptWitness.length * 0.25
        } else if (input.tapScriptSig && input.tapScriptSig[0] && input.tapLeafScript) {
          const size =
            input.tapScriptSig[0].signature.length +
            input.tapLeafScript[0]!.script.length +
            input.tapLeafScript[0]!.controlBlock.length +
            4
          sigSize += size * 0.25
        } else if (input.tapLeafScript) {
          const size =
            33 +
            input.tapLeafScript[0]!.script.length +
            input.tapLeafScript[0]!.controlBlock.length +
            4
          sigSize += size * 0.25
        } else {
          if (witnessUtxo) {
            if (this._cat20 && witnessUtxo.value == 330) {
              // CAT20 transfer
              sigSize += CAT20_TRANSFER_SIG_SIZE * 0.25
            } else if (this._cat20 && witnessUtxo.value == 332) {
              // cat20 guard
              sigSize += CAT20_GUARD_SIG_SIZE * 0.25
            } else if (address.indexOf('bc1p') == 0 || address.indexOf('tb1p') == 0) {
              // P2TR
              sigSize += 65 * 0.25
            } else if (address.indexOf('3') == 0 || address.indexOf('2') == 0) {
              // P2SH
              sigSize += 107 * 0.25
            } else {
              // P2PKH & PW2PKH
              sigSize += 107 * 0.25
            }
          }
        }
      } catch (e) {
        // unknown
        console.error(e)
      }

      const sighashType = this._psbt.data.inputs[index]!.sighashType!
      this._inputInfos.push({
        txid: Buffer.from(v.hash as any)
          .reverse()
          .toString('hex'),
        vout: v.index,
        address,
        value,
        inscriptions: [],
        alkanes: [],
        runes: [],
        sighashType,
        onchain: false,
        brc20Count: 0,
      })

      if (v.sequence === 0xfffffffd) {
        hasRbf = true
      }
    })

    this.sigSize = sigSize
  }

  initCompleted() {
    // is the final broadcastable transaction
    let isCompleted = true
    let totalInputValue = 0
    let totalOutputValue = 0
    for (let i = 0; i < this._inputInfos.length; i++) {
      const inputInfo = this._inputInfos[i]!
      if (inputInfo.value == 0) {
        // if value is 0, then the psbt is not completed
        isCompleted = false
      }
      totalInputValue += inputInfo.value
    }
    for (let i = 0; i < this._outputInfos.length; i++) {
      const outputInfo = this._outputInfos[i]!
      if (outputInfo.isOpReturn == false && outputInfo.value == 0) {
        // if there is a 0 value output (excluding OP_RETURN), then the psbt is not completed
        isCompleted = false
      }
      totalOutputValue += outputInfo.value
    }
    if (totalInputValue < totalOutputValue) {
      // if input is not enough, then it is definitely not completed
      isCompleted = false
    }
    this._isCompleted = isCompleted
  }

  initFee() {
    let finalFeeRate: string = '-'
    try {
      const totalInput = this._inputInfos.reduce((acc, v) => acc + v.value, 0)
      const totalOutput = this._outputInfos.reduce((acc, v) => acc + v.value, 0)

      this._fee = totalInput - totalOutput
      const tx = this._psbt.extractTransaction(true)
      const virtualSize = tx.virtualSize()
      finalFeeRate = (this._fee / virtualSize).toFixed(2)
      this._feeRateToCheck = parseFloat(finalFeeRate)
    } catch (e) {
      try {
        const tx = (this._psbt as any).__CACHE.__TX.clone()
        const feeRate = (this._fee / (tx.toHex().length / 2 + this.sigSize)).toFixed(1)
        this._feeRateToCheck = parseFloat(feeRate)
        finalFeeRate = `≈${feeRate}`
      } catch (e) {
        finalFeeRate = '-'
      }
    }
    this._feeRate = finalFeeRate.toString()
  }

  checkSigHashTypes() {
    const foundDangerousSighash = this._psbt.data.inputs.some(v =>
      isDangerousSighashType(v.sighashType)
    )
    if (foundDangerousSighash) {
      this.risks.push({
        type: RiskType.SIGHASH_NONE,
        level: 'danger',
        title: 'sighash_none_risk_title',
        desc: 'sighash_none_risk_description',
      })
    }
  }

  checkFeeRate() {
    if (this._feeRateToCheck != -1 && this._isCompleted) {
      try {
        if (this._feeRateToCheck < this._tooLowFeeRate) {
          this._shouldWarnFeeRate = true
        } else if (this._feeRateToCheck > this._tooHighFeeRate) {
          this._shouldWarnFeeRate = true
        }
      } catch (e) {
        console.error(e)
      }
    }
    if (this._shouldWarnFeeRate) {
      if (this._feeRateToCheck > this._recommendedFeeRate * 10) {
        this.risks.push({
          type: RiskType.HIGH_FEE_RATE,
          level: 'danger',
          title: 'high_fee_rate_risk_title',
          desc: 'high_fee_rate_risk_description',
        })
      }
    }
  }

  checkCAT20Tx() {
    if (this._opreturnDataString) {
      if (this._opreturnDataString.indexOf('OP_RETURN 636174') == 0) {
        this._cat20 = true
      }

      if (this._opreturnDataString.indexOf('OP_RETURN 63746d') == 0) {
        this._cat20 = true
      }
    }
  }
}
