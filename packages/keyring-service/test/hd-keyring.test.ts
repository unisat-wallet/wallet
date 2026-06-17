import { describe, expect, it } from 'vitest'

import { bitcoin, toXOnly } from '@unisat/wallet-bitcoin'
import { deriveContextHash, parseHexContext } from '../src/keyrings/derive-context-hash'
import { HdKeyring } from '../src/keyrings/hd-keyring'
const sampleMnemonic =
  'finish oppose decorate face calm tragic certain desk hour urge dinosaur mango'
const firstPrivateKey = '69f477943dd1591f0261cabade0839e2ffc0c13d8fa1ce0d69f6c6c251163b34'
const firstAccount = '025d7c14ab260a6932bc5484a0d9791f5cce66b0c6e1e4d7aee1e6bd294459e7d9'
const secondAccount = '0306cd1266c7dfc5522d1f170fa45cca29a7071a5dad848204b676cbd398aa7d30'
describe('bitcoin-hd-keyring', () => {
  describe('constructor', () => {
    it('constructs with a typeof string mnemonic', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
      })
      const accounts = await keyring.getAccounts()
      expect(accounts[0]).eq(firstAccount)
      expect(accounts[1]).eq(secondAccount)
      const privateKey = await keyring.exportAccount(accounts[0])
      expect(privateKey).eq(firstPrivateKey)
    })
  })

  describe('re-initialization protection', () => {
    const alreadyProvidedError = 'Btc-Hd-Keyring: Secret recovery phrase already provided'
    it('double generateRandomMnemonic', async () => {
      const keyring = new HdKeyring()
      await keyring.initFromMnemonic(sampleMnemonic)

      let error = ''
      try {
        await keyring.initFromMnemonic(sampleMnemonic)
      } catch (e) {
        error = (e as Error).message
      }
      expect(error).eq(alreadyProvidedError)
    })

    it('constructor + generateRandomMnemonic', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
      })

      let error = ''
      try {
        await keyring.initFromMnemonic(sampleMnemonic)
      } catch (e) {
        error = (e as Error).message
      }
      expect(error).eq(alreadyProvidedError)
    })
  })

  describe('Keyring.type', () => {
    it('is a class property that returns the type string.', () => {
      const { type } = HdKeyring
      expect(typeof type).eq('string')
    })
  })

  describe('#type', () => {
    it('returns the correct value', () => {
      const keyring = new HdKeyring()

      const { type } = keyring
      const correct = HdKeyring.type
      expect(type).eq(correct)
    })
  })

  describe('#Change hdPath', () => {
    it('pass m/44', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
        hdPath: "m/44'/0'/0'/0",
      })

      const accounts_m44 = await keyring.getAccounts()
      expect(accounts_m44).deep.equal([
        '025d7c14ab260a6932bc5484a0d9791f5cce66b0c6e1e4d7aee1e6bd294459e7d9',
        '0306cd1266c7dfc5522d1f170fa45cca29a7071a5dad848204b676cbd398aa7d30',
      ])
    })

    it('pass m/84', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
        hdPath: "m/84'/0'/0'/0",
      })

      const accounts_m84 = await keyring.getAccounts()
      expect(accounts_m84).deep.equal([
        '02d16db9d525d8623e80c04e33c4463450285791124381bc545bb85e5e8925a776',
        '023f0b3115a6c5a51ec62d8cbe6e834e79fe4bf22555e095a163e0e451a6fdc4d5',
      ])
    })

    it('change m/44 to m/84', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
        hdPath: "m/44'/0'/0'/0",
      })

      keyring.changeHdPath("m/84'/0'/0'/0")
      const accounts_m84 = await keyring.getAccounts()
      expect(accounts_m84).deep.equal([
        '02d16db9d525d8623e80c04e33c4463450285791124381bc545bb85e5e8925a776',
        '023f0b3115a6c5a51ec62d8cbe6e834e79fe4bf22555e095a163e0e451a6fdc4d5',
      ])
    })

    it('getAccountByHdPath', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
        hdPath: "m/44'/0'/0'/0",
      })

      const account = keyring.getAccountByHdPath("m/84'/0'/0'/0", 1)
      expect(account).eq('023f0b3115a6c5a51ec62d8cbe6e834e79fe4bf22555e095a163e0e451a6fdc4d5')
    })
  })

  describe('more words test', () => {
    it('12 words', async () => {
      const sampleMnemonic =
        'glue peanut huge wait vicious depend copper ribbon access boring walk point'
      const firstAccount = '0244ffe4b9f87b7c1e2f8b0d7dee2a91492fedf9c92fc06231764826633b2c8afa'
      const secondAccount = '0243906ea96ce2680826bfd906cdfcbb70cf2764e469518ba000f0aeb76a6b025b'

      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
      })

      const accounts = await keyring.getAccounts()
      expect(accounts[0]).eq(firstAccount)
      expect(accounts[1]).eq(secondAccount)
    })

    it('15 words', async () => {
      const sampleMnemonic =
        'gloom prepare pause lazy item valley pear develop ahead crucial fuel seed bone reward shoot'
      const firstAccount = '02c7b966f5ea72f65c3c3e218103d08c3f259b21cc99d846754e2ca766eb1afd85'
      const secondAccount = '02dea555ea75823e76c2b7589bdbc601ef4eb26742be5f096bc31319367873101b'

      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
      })

      const accounts = await keyring.getAccounts()
      expect(accounts[0]).eq(firstAccount)
      expect(accounts[1]).eq(secondAccount)
    })

    it('18 words', async () => {
      const sampleMnemonic =
        'machine chest second galaxy rally design stumble code address general twelve job code acquire dutch debate jealous truly'
      const firstAccount = '02d9bf4d71d15e941fb060f58e74c53995761a381d2e368062687c1ef65bb52a84'
      const secondAccount = '03d1b536f6f18eb1ffea8227987a1a80072a316c3d0bfedc2af01b21ece5b7492e'

      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
      })

      const accounts = await keyring.getAccounts()
      expect(accounts[0]).eq(firstAccount)
      expect(accounts[1]).eq(secondAccount)
    })

    it('21 words', async () => {
      const sampleMnemonic =
        'squirrel spawn fog zero approve connect mirror social basic about alert yellow giraffe oak company file finger winner coast cushion oxygen'
      const firstAccount = '02deda9f6759511ac3b00bd685871cf5b658dc082db39ba7dfeb394134cddc5537'
      const secondAccount = '031c90977662ae1c7ab0082940307a0a82d34bdba9c26b38404402676e99484b9e'

      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
      })

      const accounts = await keyring.getAccounts()
      expect(accounts[0]).eq(firstAccount)
      expect(accounts[1]).eq(secondAccount)
    })

    it('24 words', async () => {
      const sampleMnemonic =
        'dash pair decline scrap federal marine erase lounge fancy quick valid crawl wing ahead art chaos deposit rare deputy gaze often fence alien picture'
      const firstAccount = '03111f9a4b905f058d0fb0cbc968f2e8d3796d8e6a2308b90069477a5a0be09b01'
      const secondAccount = '03e514ed9ec10e4df0b134d0728abf5746ace056230e12d3e9cce8fe669d74a532'

      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
      })

      const accounts = await keyring.getAccounts()
      expect(accounts[0]).eq(firstAccount)
      expect(accounts[1]).eq(secondAccount)
    })
  })

  describe('MagicEden account-index derivation', () => {
    // MagicEden varies the BIP44 account segment instead of the address index:
    //   m/86'/0'/{i}'/0/0  and  m/84'/0'/{i}'/0/0
    // activeIndexes [0,1,2] correspond to account indices 0,1,2.

    it('P2TR (m/86): derives 3 accounts at account-index level', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1, 2],
        hdPath: "m/86'/0'/0'/0",
        accountIndexDerivation: true,
      })

      const accounts = await keyring.getAccounts()
      expect(accounts[0]).eq('02ed399b9a6d5c2bc47371bf8eafd59f2a02e81d24850013cbb2eb621bf183d748') // m/86'/0'/0'/0/0
      expect(accounts[1]).eq('0215460951216224652a468a59634428747807e402c738d8dc71349b2a4d9f94b9') // m/86'/0'/1'/0/0
      expect(accounts[2]).eq('03067fcd71e9ebe4b6f8f55671186d88c683d7421b59b3a75355379112124b1d60') // m/86'/0'/2'/0/0
    })

    it('P2WPKH (m/84): derives 3 accounts at account-index level', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1, 2],
        hdPath: "m/84'/0'/0'/0",
        accountIndexDerivation: true,
      })

      const accounts = await keyring.getAccounts()
      expect(accounts[0]).eq('02d16db9d525d8623e80c04e33c4463450285791124381bc545bb85e5e8925a776') // m/84'/0'/0'/0/0
      expect(accounts[1]).eq('020935f353d66e1e0af2972fa7332b98c1eda1b8a4399f84a59122ec292dbc5ccb') // m/84'/0'/1'/0/0
      expect(accounts[2]).eq('024ca05656e3d319971b26925f26faeb460f4345fd75868a7fe2bd780c8ea25564') // m/84'/0'/2'/0/0
    })

    it('getAccountByHdPath uses account-index derivation', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0],
        hdPath: "m/84'/0'/0'/0",
        accountIndexDerivation: true,
      })

      // account index 2 → m/84'/0'/2'/0/0
      const account = keyring.getAccountByHdPath("m/84'/0'/0'/0", 2)
      expect(account).eq('024ca05656e3d319971b26925f26faeb460f4345fd75868a7fe2bd780c8ea25564')
    })

    it('serialize and deserialize preserves accountIndexDerivation', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
        hdPath: "m/86'/0'/0'/0",
        accountIndexDerivation: true,
      })

      const serialized = await keyring.serialize()
      expect(serialized.accountIndexDerivation).toBe(true)

      const restored = new HdKeyring(serialized)
      const accounts = await restored.getAccounts()
      expect(accounts[0]).eq('02ed399b9a6d5c2bc47371bf8eafd59f2a02e81d24850013cbb2eb621bf183d748')
      expect(accounts[1]).eq('0215460951216224652a468a59634428747807e402c738d8dc71349b2a4d9f94b9')
    })

    it('standard derivation is unaffected (accountIndexDerivation defaults to false)', async () => {
      // m/84'/0'/0'/0/{i} — address index varies, same as existing behaviour
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
        hdPath: "m/84'/0'/0'/0",
      })

      const accounts = await keyring.getAccounts()
      expect(accounts[0]).eq('02d16db9d525d8623e80c04e33c4463450285791124381bc545bb85e5e8925a776') // m/84'/0'/0'/0/0
      expect(accounts[1]).eq('023f0b3115a6c5a51ec62d8cbe6e834e79fe4bf22555e095a163e0e451a6fdc4d5') // m/84'/0'/0'/0/1
    })

    it('RGB wallet context uses the active account index for account-index derivation', async () => {
      const standardKeyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
        hdPath: "m/86'/0'/0'/0",
      })
      const accountIndexKeyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
        hdPath: "m/86'/0'/0'/0",
        accountIndexDerivation: true,
      })

      const standardContext = await standardKeyring.getRgbWalletContext(0)
      const accountIndexContext = await accountIndexKeyring.getRgbWalletContext(0)

      expect(standardContext.xpubVan).toBe(accountIndexContext.xpubVan)
    })
  })

  describe('#signTransaction with PSBT derivation paths', () => {
    function createP2trPsbt(pubkey: string, path: string, masterFingerprint: Buffer) {
      const network = bitcoin.networks.bitcoin
      const xOnlyPubkey = toXOnly(Buffer.from(pubkey, 'hex'))
      const payment = bitcoin.payments.p2tr({
        internalPubkey: xOnlyPubkey,
        network,
      })

      const txToSpend = new bitcoin.Transaction()
      txToSpend.version = 0
      txToSpend.addInput(Buffer.alloc(32), 0xffffffff, 0)
      txToSpend.addOutput(payment.output!, 10000)

      const psbt = new bitcoin.Psbt({ network })
      psbt.addInput({
        hash: txToSpend.getHash(),
        index: 0,
        sequence: 0,
        witnessUtxo: {
          script: payment.output!,
          value: 10000,
        },
        tapInternalKey: xOnlyPubkey,
        tapBip32Derivation: [
          {
            masterFingerprint,
            path,
            pubkey: xOnlyPubkey,
            leafHashes: [],
          },
        ],
      })
      psbt.addOutput({
        address: payment.address!,
        value: 9500,
      })
      return psbt
    }

    it('rejects PSBT derivation when the requested publicKey does not match the derived key', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0],
        hdPath: "m/86'/0'/0'/0",
      })
      const accounts = await keyring.getAccounts()
      const psbt = createP2trPsbt(accounts[0], "m/86'/0'/0'/0/0", Buffer.from('817c1e36', 'hex'))
      const wrongPubkey = '02' + '11'.repeat(32)

      await expect(
        keyring.signTransaction(psbt, [{ index: 0, publicKey: wrongPubkey }], {
          network: bitcoin.networks.bitcoin,
        })
      ).rejects.toThrow('Unable to find matching RGB PSBT publicKey')
    })

    it('signs a non-active derived input when request publicKey, PSBT pubkey, and path agree', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0],
        hdPath: "m/86'/0'/0'/0",
      })
      const derivedPubkey = keyring.getAccountByHdPath("m/86'/0'/0'/0", 3)
      const psbt = createP2trPsbt(derivedPubkey, "m/86'/0'/0'/0/3", Buffer.from('817c1e36', 'hex'))

      await keyring.signTransaction(psbt, [{ index: 0, publicKey: derivedPubkey }], {
        network: bitcoin.networks.bitcoin,
      })

      expect(psbt.data.inputs[0].tapKeySig).toBeDefined()
    })

    it('rejects non-RGB derivation paths even when the derived pubkey matches', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0],
        hdPath: "m/84'/0'/0'/0",
      })
      const derivedPubkey = keyring.getAccountByHdPath("m/84'/0'/0'/0", 3)
      const psbt = createP2trPsbt(derivedPubkey, "m/84'/0'/0'/0/3", Buffer.from('817c1e36', 'hex'))

      await expect(
        keyring.signTransaction(psbt, [{ index: 0, publicKey: derivedPubkey }], {
          network: bitcoin.networks.bitcoin,
        })
      ).rejects.toThrow('Unable to find matching RGB PSBT publicKey')
    })
  })

  describe('deriveContextHash (v2.0)', () => {
    const APP_NAME = 'test-app'
    const NETWORK = 'bitcoin-mainnet'

    it('derives context hash with mnemonic-based keyring', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0],
      })
      const accounts = await keyring.getAccounts()
      const result = await keyring.deriveContextHash(accounts[0], APP_NAME, NETWORK, 'deadbeef')
      expect(result).toHaveLength(64)
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('produces same result as direct derivation with BIP-32 derived key and pubkey injected into info', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0],
      })
      const accounts = await keyring.getAccounts()
      const contextHex = 'deadbeef'
      const keyringResult = await keyring.deriveContextHash(
        accounts[0],
        APP_NAME,
        NETWORK,
        contextHex
      )

      // Manually derive BIP-32 key at m/73681862' and compute directly with all 5 args.
      const bip39 = await import('bip39')
      // @ts-ignore
      const hdkey = await import('hdkey')

      const seedBuf = bip39.mnemonicToSeedSync(sampleMnemonic)
      const master = hdkey.fromMasterSeed(seedBuf)
      const child = master.derive("m/73681862'")
      const privKey = new Uint8Array(child.privateKey)
      const pubkeyBytes = Uint8Array.from(Buffer.from(accounts[0], 'hex'))
      const directResult = deriveContextHash(
        privKey,
        APP_NAME,
        NETWORK,
        pubkeyBytes,
        parseHexContext(contextHex)
      )
      expect(keyringResult).toBe(directResult)
    })

    it('mnemonic keyring produces DIFFERENT results across account pubkeys (v2.0 per-pubkey rotation)', async () => {
      // Under v1.0, the HD keyring ignored publicKey for derivation and returned the
      // same root for any account in the same keyring. v2.0 injects the connected
      // pubkey into HKDF info, so different accounts MUST produce different outputs
      // even though the underlying IKM (at m/73681862') is shared.
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0, 1],
      })
      const accounts = await keyring.getAccounts()
      const result0 = await keyring.deriveContextHash(accounts[0], APP_NAME, NETWORK, 'deadbeef')
      const result1 = await keyring.deriveContextHash(accounts[1], APP_NAME, NETWORK, 'deadbeef')
      expect(result0).not.toBe(result1)
    })

    it('produces DIFFERENT results across canonical networks', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0],
      })
      const accounts = await keyring.getAccounts()
      const mainnet = await keyring.deriveContextHash(
        accounts[0],
        APP_NAME,
        'bitcoin-mainnet',
        'deadbeef'
      )
      const testnet = await keyring.deriveContextHash(
        accounts[0],
        APP_NAME,
        'bitcoin-testnet',
        'deadbeef'
      )
      const signet = await keyring.deriveContextHash(
        accounts[0],
        APP_NAME,
        'bitcoin-signet',
        'deadbeef'
      )
      expect(mainnet).not.toBe(testnet)
      expect(mainnet).not.toBe(signet)
      expect(testnet).not.toBe(signet)
    })

    it('xpriv-only keyring derives from BIP-32 path', async () => {
      const sampleXpriv =
        'xprvA2JBuYsdqVhrC2wGmb9QhBejk9gXXYgM3Jg9xgVYmDMsakDoURc8V7UYos1pP1kev1tG51PPA9A8VMYYCLov1L5c3J7npraxwjeJCquGhDi'
      const keyring = new HdKeyring({
        xpriv: sampleXpriv,
        activeIndexes: [0],
      })
      const accounts = await keyring.getAccounts()
      const result = await keyring.deriveContextHash(accounts[0], APP_NAME, NETWORK, 'deadbeef')
      expect(result).toHaveLength(64)
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('xpriv: same account index gives same output regardless of activation order', async () => {
      // Activation-order independence: keyring1 lists [0, 1] and keyring2 lists [1, 0].
      // accounts1[0] is index 0; accounts2[1] is also index 0. Both should produce the
      // same output when the pubkey passed in matches the same underlying account.
      const sampleXpriv =
        'xprvA2JBuYsdqVhrC2wGmb9QhBejk9gXXYgM3Jg9xgVYmDMsakDoURc8V7UYos1pP1kev1tG51PPA9A8VMYYCLov1L5c3J7npraxwjeJCquGhDi'
      const keyring1 = new HdKeyring({
        xpriv: sampleXpriv,
        activeIndexes: [0, 1],
      })
      const keyring2 = new HdKeyring({
        xpriv: sampleXpriv,
        activeIndexes: [1, 0],
      })
      const accounts1 = await keyring1.getAccounts()
      const accounts2 = await keyring2.getAccounts()
      // Sanity: keyring1[0] (index 0) and keyring2[1] (also index 0) are the same pubkey.
      expect(accounts1[0]).toBe(accounts2[1])
      const result1 = await keyring1.deriveContextHash(accounts1[0], APP_NAME, NETWORK, 'deadbeef')
      const result2 = await keyring2.deriveContextHash(accounts2[1], APP_NAME, NETWORK, 'deadbeef')
      expect(result1).toBe(result2)
    })

    it('rejects invalid hex context', async () => {
      const keyring = new HdKeyring({
        mnemonic: sampleMnemonic,
        activeIndexes: [0],
      })
      const accounts = await keyring.getAccounts()
      await expect(
        keyring.deriveContextHash(accounts[0], APP_NAME, NETWORK, 'xyz')
      ).rejects.toThrow()
      await expect(keyring.deriveContextHash(accounts[0], APP_NAME, NETWORK, '')).rejects.toThrow()
      await expect(
        keyring.deriveContextHash(accounts[0], APP_NAME, NETWORK, 'abc')
      ).rejects.toThrow()
    })

    it('rejects uninitialized keyring', async () => {
      const keyring = new HdKeyring()
      const fakePubkey = '02' + '11'.repeat(32)
      await expect(
        keyring.deriveContextHash(fakePubkey, APP_NAME, NETWORK, 'deadbeef')
      ).rejects.toThrow('requires a mnemonic or xpriv-based keyring')
    })

    it('pinned wallet-integration vector with canonical "abandon" mnemonic', async () => {
      const knownMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const keyring = new HdKeyring({
        mnemonic: knownMnemonic,
        activeIndexes: [0],
      })
      const accounts = await keyring.getAccounts()
      // accounts[0] is the m/44'/0'/0'/0/0 compressed pubkey for this mnemonic:
      // 03aaeb52dd7494c361049de67cc680e83ebcbbbdbeb13637d92cd845f70308af5e
      expect(accounts[0]).toBe('03aaeb52dd7494c361049de67cc680e83ebcbbbdbeb13637d92cd845f70308af5e')
      const result = await keyring.deriveContextHash(
        accounts[0],
        'test-app',
        'bitcoin-mainnet',
        'deadbeef'
      )
      expect(result).toBe('f82ced3be0e29591a7863ece03d65f79fb494fe0de7203549855f462455df008')
    })
  })

  describe('support xpriv', () => {
    it('xpriv', async () => {
      const sampleXpriv =
        'xprvA2JBuYsdqVhrC2wGmb9QhBejk9gXXYgM3Jg9xgVYmDMsakDoURc8V7UYos1pP1kev1tG51PPA9A8VMYYCLov1L5c3J7npraxwjeJCquGhDi'
      const firstAccount = '0244ffe4b9f87b7c1e2f8b0d7dee2a91492fedf9c92fc06231764826633b2c8afa'
      const secondAccount = '0243906ea96ce2680826bfd906cdfcbb70cf2764e469518ba000f0aeb76a6b025b'

      const keyring = new HdKeyring({
        xpriv: sampleXpriv,
        activeIndexes: [0, 1],
      })

      const accounts = await keyring.getAccounts()
      expect(accounts[0]).eq(firstAccount)
      expect(accounts[1]).eq(secondAccount)
    })
  })
})
