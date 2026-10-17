import { bech32 } from 'bech32'
import { Buffer } from 'buffer'
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js'

import { incentivequery } from '@babylonlabs-io/babylon-proto-ts'
import { Secp256k1, sha256 } from '@cosmjs/crypto'
import * as encoding from '@cosmjs/encoding'
import {
  AccountData,
  DirectSecp256k1Wallet,
  encodePubkey,
  makeAuthInfoBytes,
  makeSignBytes,
  makeSignDoc,
} from '@cosmjs/proto-signing'
import {
  GasPrice,
  QueryClient,
  SigningStargateClient,
  createProtobufRpcClient,
} from '@cosmjs/stargate'
import { Tendermint34Client } from '@cosmjs/tendermint-rpc'

import { assertValidCosmosMemo, encodeSecp256k1Pubkey } from './utils'
import { PubKeySecp256k1 } from './crypto'
import type { Key, CosmosBalance, CosmosChainInfo } from '../types/cosmos'
import { DEFAULT_BBN_GAS_PRICE } from '../types'

const REWARD_GAUGE_KEY_BTC_DELEGATION = 'btc_delegation'

export function bech32AddressToAddress(bech32Address: string): Uint8Array {
  const decoded = bech32.decode(bech32Address)
  return new Uint8Array(bech32.fromWords(decoded.words))
}

// Provider interface to abstract WalletController dependency
export interface CosmosProvider {
  cosmosChainInfoMap: Record<string, CosmosChainInfo>
}

export class CosmosKeyring {
  private chainId: string
  private key: Key
  private signer?: DirectSecp256k1Wallet
  private provider: CosmosProvider
  private client: SigningStargateClient
  private _signDoc_bodyBytes: any = null
  private _signDoc_authInfoBytes: any = null

  constructor({
    key,
    signer,
    client,
    provider,
    chainId,
  }: {
    key: Key
    signer?: DirectSecp256k1Wallet
    client: SigningStargateClient
    provider: CosmosProvider
    chainId: string
  }) {
    this.key = key
    this.signer = signer
    this.client = client
    this.provider = provider
    this.chainId = chainId
  }

  static async createCosmosKeyring({
    privateKey,
    publicKey,
    name,
    chainId,
    provider,
  }: {
    privateKey?: string
    publicKey: string
    name: string
    chainId: string
    provider: CosmosProvider
  }): Promise<CosmosKeyring> {
    let signer: DirectSecp256k1Wallet = undefined as any
    if (privateKey) {
      signer = await DirectSecp256k1Wallet.fromKey(
        Buffer.from(privateKey, 'hex') as any,
        provider.cosmosChainInfoMap[chainId]!.bech32Config.bech32PrefixAccAddr
      )
    }

    const client = await SigningStargateClient.connectWithSigner(
      provider.cosmosChainInfoMap[chainId]!.rpc,
      null as any
    )

    const pubKey = encoding.fromHex(publicKey)
    const address = CosmosKeyring.publicKeyToBBNAddress(pubKey)

    const key = {
      name,
      algo: 'secp256k1',
      pubKey: pubKey,
      address: bech32AddressToAddress(address),
      bech32Address: address,
      isNanoLedger: false,
    }

    return new CosmosKeyring({ key, signer, client, provider, chainId })
  }

  async getBalance(): Promise<CosmosBalance> {
    const { bech32Address } = this.getKey()
    const chainInfo = this.provider.cosmosChainInfoMap[this.chainId]!
    return await this.client.getBalance(bech32Address, chainInfo.currencies[0]!.coinMinimalDenom)
  }

  async getBabylonStakingRewards(): Promise<number> {
    const { bech32Address } = this.getKey()
    const chain = this.provider.cosmosChainInfoMap[this.chainId]!
    const tmClient = await Tendermint34Client.connect(chain.rpc)
    const client = QueryClient.withExtensions(tmClient)
    const rpc = createProtobufRpcClient(client)
    const incentiveClient = new incentivequery.QueryClientImpl(rpc)
    const req = incentivequery.QueryRewardGaugesRequest.fromPartial({
      address: bech32Address,
    })

    let rewards: incentivequery.QueryRewardGaugesResponse
    try {
      rewards = await incentiveClient.RewardGauges(req)
    } catch (error) {
      // If error message contains "reward gauge not found", silently return 0
      // This is to handle the case where the user has no rewards, meaning
      // they have not staked
      if (error instanceof Error && error.message.includes('reward gauge not found')) {
        return 0
      }
      throw error
    }
    const coins = rewards.rewardGauges[REWARD_GAUGE_KEY_BTC_DELEGATION]?.coins
    if (!coins) {
      return 0
    }

    const withdrawnCoins = rewards.rewardGauges[
      REWARD_GAUGE_KEY_BTC_DELEGATION
    ]?.withdrawnCoins.reduce((acc, coin) => acc + Number(coin.amount), 0)

    return coins.reduce((acc, coin) => acc + Number(coin.amount), 0) - (withdrawnCoins || 0)
  }

  async cosmosSignData(signBytesHex: string): Promise<{
    publicKey: string
    signature: string
  }> {
    const messageHash = sha256(encoding.fromHex(signBytesHex))
    const _sig = await Secp256k1.createSignature(messageHash, (this.signer as any).privkey)
    const signature = new Uint8Array([..._sig.r(32), ..._sig.s(32)])
    return {
      publicKey: encoding.toHex(this.key.pubKey),
      signature: encoding.toHex(signature),
    }
  }

  destroy() {
    const signer = this.signer as any
    signer?.privkey?.fill(0)
    this.signer = undefined
    this._signDoc_bodyBytes?.fill?.(0)
    this._signDoc_authInfoBytes?.fill?.(0)
    this._signDoc_bodyBytes = null
    this._signDoc_authInfoBytes = null
  }

  /**
   * Convert Keystone public key to BBN address
   * @param publicKey - The public key from Keystone as Uint8Array
   * @returns BBN address string
   */
  static publicKeyToBBNAddress(publicKey: Uint8Array): string {
    const pubKey = new PubKeySecp256k1(publicKey)
    return pubKey.getBech32Address('bbn')
  }

  /**
   * getCurrentKey
   * @returns
   */
  getKey(): Key {
    return this.key
  }

  async createSendTokenStep1(
    tokenBalance: { denom: string; amount: string },
    recipient: string,
    memo: string,
    {
      gasLimit,
      gasPrice,
      gasAdjustment,
    }: {
      gasLimit: number
      gasPrice: string
      gasAdjustment?: number
    }
  ) {
    assertValidCosmosMemo(memo)
    const chainInfo = this.provider.cosmosChainInfoMap[this.chainId]!

    const fromAddress = this.getKey().bech32Address
    const sendMsg = {
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: {
        fromAddress: fromAddress,
        toAddress: recipient,
        amount: [tokenBalance],
      },
    }

    const txBodyEncodeObject = {
      typeUrl: '/cosmos.tx.v1beta1.TxBody',
      value: {
        messages: [sendMsg],
        memo: memo,
        timeoutHeight: undefined,
      },
    }

    const { accountNumber, sequence } = await this.client.getSequence(fromAddress)

    const fee = {
      amount: [
        {
          denom: chainInfo.feeCurrencies[0]!.coinMinimalDenom,
          amount: Math.ceil(parseFloat(gasPrice) * gasLimit * (gasAdjustment || 1.0)).toString(),
        },
      ],
      gas: gasLimit, // for transfer is enough
    }
    const txBodyBytes = this.client.registry.encode(txBodyEncodeObject)
    // const gasLimit = math.Int53.fromString(fee.gas).toNumber();

    const pubkey = encodePubkey(encodeSecp256k1Pubkey(this.getKey().pubKey))
    const authInfoBytes = makeAuthInfoBytes(
      [{ pubkey, sequence }],
      fee.amount,
      gasLimit,
      undefined,
      undefined
    )

    const signDoc = makeSignDoc(txBodyBytes, authInfoBytes, this.chainId, accountNumber)

    // cache
    this._signDoc_bodyBytes = signDoc.bodyBytes
    this._signDoc_authInfoBytes = signDoc.authInfoBytes

    const signBytes = makeSignBytes(signDoc)

    return encoding.toHex(signBytes)
  }

  async createSendTokenStep2(signature: string) {
    const txRaw = TxRaw.fromPartial({
      bodyBytes: this._signDoc_bodyBytes,
      authInfoBytes: this._signDoc_authInfoBytes,
      signatures: [encoding.fromHex(signature)], // only hex for keystone. should use base64 for other signers
    })

    const txBytes = TxRaw.encode(txRaw).finish()
    return this.client.broadcastTxSync(txBytes)
  }

  /**
   * simulate babylon gas
   * @param recipient
   * @param amount
   * @param memo
   * @returns return gas fee
   */
  async simulateBabylonGas(
    recipient: string,
    amount: { denom: string; amount: string },
    memo: string
  ) {
    assertValidCosmosMemo(memo)
    try {
      const chainInfo = this.provider.cosmosChainInfoMap[this.chainId]!

      const key: AccountData = {
        address: this.getKey().bech32Address,
        algo: 'secp256k1',
        pubkey: this.getKey().pubKey,
      }

      const dummySigner = {
        getAccounts: async () => [key],
      } as unknown as DirectSecp256k1Wallet

      // TODO: Performance optimization - investigate if account query can be skipped before simulation
      // Current implementation queries account info during client connection which may be redundant
      // Consider implementing lazy loading or caching mechanism for better performance
      const client = await SigningStargateClient.connectWithSigner(chainInfo.rpc, dummySigner, {
        gasPrice: GasPrice.fromString(DEFAULT_BBN_GAS_PRICE + 'ubbn'),
      })

      const { bech32Address } = this.getKey()
      const sendMsg = {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        value: {
          fromAddress: bech32Address,
          toAddress: recipient,
          amount: [amount],
        },
      }

      const ret = await client.simulate(bech32Address, [sendMsg], memo)

      return ret
    } catch (error: any) {
      console.log('simulation error:', error)
      return
    }
  }
}
