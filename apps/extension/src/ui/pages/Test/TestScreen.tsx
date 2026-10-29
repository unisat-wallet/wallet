import { useRef, useState } from 'react';

import { Button, Column, Content, Header, Layout, Text } from '@/ui/components';
import type { CosmosDirectSignSummary } from '@unisat/babylon-service';
import { COSMOS_CHAINS_MAP } from '@unisat/babylon-service/types';
import { ProviderMethodArgs, ProviderMethods } from '@unisat/wallet-background/types';
import { DummyTxType, SignMessageType, ToSignData } from '@unisat/wallet-shared';
import { useAsyncEffect, useTools, useWallet } from '@unisat/wallet-state';
import { ChainType, NetworkType } from '@unisat/wallet-types';
import { CosmosSign } from '../Approval/components';

const DUMMY_SESSION = {
  origin: 'https://mail.google.com/',
  icon: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
  name: 'GMAIL'
};

const COSMOS_TEST_CHAIN_ID = 'bbn-1';

type CosmosTestKey = {
  bech32Address: string;
  pubKey: string;
};

export default function TestScreen() {
  const tools = useTools();
  const wallet = useWallet();
  const [cosmosDirectPreview, setCosmosDirectPreview] = useState<{
    signerAddress: string;
    summary: CosmosDirectSignSummary;
  } | null>(null);

  const testApprovalData = useRef<{ toSignDatas: ToSignData[] }>({ toSignDatas: [] });

  useAsyncEffect(async () => {
    const toSignDatas: ToSignData[] = [];

    const types = [DummyTxType.SEND_BTC, DummyTxType.SPLIT_BTC, DummyTxType.MERGE_BTC, DummyTxType.LIST_ASSETS];
    for (const txType of types) {
      const data = await wallet.createDummyPsbt({ txType });
      toSignDatas.push(data);
    }

    testApprovalData.current.toSignDatas = toSignDatas;
  });

  const requestApproval = async (data: ProviderMethodArgs<ProviderMethods>) => {
    try {
      await wallet.requestMethod({
        data,
        session: DUMMY_SESSION
      });
      tools.toast('Request sent');
    } catch (e) {
      tools.toast('Error sending request');
      console.log('Error sending request', e);
    }
  };

  const getCosmosTestKey = async (): Promise<CosmosTestKey> => {
    const key = await wallet.requestMethod({
      data: {
        method: 'cosmosGetKey',
        params: { chainId: COSMOS_TEST_CHAIN_ID }
      },
      session: DUMMY_SESSION
    });
    if (!key?.bech32Address || !key?.pubKey) throw new Error('Unable to get the current Cosmos account');
    return key;
  };

  const requestCosmosDirectApproval = async () => {
    try {
      const key = await getCosmosTestKey();
      const chain = COSMOS_CHAINS_MAP[COSMOS_TEST_CHAIN_ID];
      setCosmosDirectPreview({
        signerAddress: key.bech32Address,
        summary: {
          chainId: COSMOS_TEST_CHAIN_ID,
          accountNumber: 'Preview value',
          sequence: 'Preview value',
          memo: 'UniSat Cosmos signing authorization test',
          fee: {
            amounts: [{ denom: chain.feeCurrencies[0].coinMinimalDenom, amount: '1' }],
            gasLimit: '80000'
          },
          messages: [
            {
              type: '/cosmos.bank.v1beta1.MsgSend',
              signer: key.bech32Address,
              recipient: key.bech32Address,
              amounts: [{ denom: chain.currencies[0].coinMinimalDenom, amount: '1' }]
            }
          ]
        }
      });
    } catch (error) {
      tools.toastError((error as Error).message);
    }
  };

  const requestCosmosArbitraryApproval = async () => {
    try {
      const key = await getCosmosTestKey();
      await requestApproval({
        method: 'cosmosSignArbitrary',
        params: {
          chainId: COSMOS_TEST_CHAIN_ID,
          signerAddress: key.bech32Address,
          type: 'string',
          data: 'UniSat Cosmos ADR-36 signing authorization test'
        }
      });
    } catch (error) {
      tools.toastError((error as Error).message);
    }
  };

  if (cosmosDirectPreview) {
    return (
      <CosmosSign
        previewOnly
        previewNotice="Preview only: accountNumber and sequence are placeholders. No signature will be created."
        onPreviewClose={() => setCosmosDirectPreview(null)}
        params={{
          method: 'cosmos_signDirect',
          data: {
            chainId: COSMOS_TEST_CHAIN_ID,
            signerAddress: cosmosDirectPreview.signerAddress,
            signBytesHex: '',
            summary: cosmosDirectPreview.summary
          },
          session: DUMMY_SESSION
        }}
      />
    );
  }

  return (
    <Layout>
      <Header title="TestScreen" />
      <Content>
        <Column gap="md">
          <Text text="Bitcoin signing authorization" preset="bold" />
          <Button
            text="SignPsbt"
            onClick={() => {
              requestApproval({
                method: 'signPsbt',
                params: {
                  psbtHex: testApprovalData.current.toSignDatas[0].psbtHex,
                  options: { toSignInputs: testApprovalData.current.toSignDatas[0].toSignInputs }
                }
              });
            }}
          />

          <Button
            text="Sign Multiple Psbts"
            onClick={() => {
              requestApproval({
                method: 'multiSignPsbt',
                params: {
                  psbtHexs: testApprovalData.current.toSignDatas.map((item) => item.psbtHex),
                  options: testApprovalData.current.toSignDatas.map((item) => ({ toSignInputs: item.toSignInputs }))
                }
              });
            }}
          />

          <Button
            text="SignMessage"
            onClick={() => {
              requestApproval({
                method: 'signMessage',
                params: {
                  text: 'hello',
                  type: SignMessageType.ECDSA
                }
              });
            }}
          />
          <Button
            text="Sign Multiple Messages"
            onClick={() => {
              requestApproval({
                method: 'multiSignMessage',
                params: {
                  messages: [
                    {
                      text: 'hello1',
                      type: SignMessageType.BIP322_SIMPLE
                    },
                    {
                      text: 'hello2',
                      type: SignMessageType.ECDSA
                    }
                  ]
                }
              });
            }}
          />

          <Text text="Cosmos signing authorization" preset="bold" />
          <Button text="Cosmos Direct Sign (Self Transfer Preview)" onClick={requestCosmosDirectApproval} />
          <Button text="Cosmos ADR-36 Sign" onClick={requestCosmosArbitraryApproval} />
          <Button
            text="Cosmos Enable"
            onClick={() => {
              requestApproval({
                method: 'cosmosEnable',
                params: {
                  chainId: COSMOS_TEST_CHAIN_ID
                }
              });
            }}
          />

          <Text text="Network authorization" preset="bold" />
          <Button
            text="Switch Chain"
            onClick={() => {
              requestApproval({
                method: 'switchChain',
                params: {
                  chain: ChainType.BITCOIN_MAINNET
                }
              });
            }}
          />
          <Button
            text="Switch Network"
            onClick={() => {
              requestApproval({
                method: 'switchNetwork',
                params: {
                  network: NetworkType.MAINNET
                }
              });
            }}
          />

          <Text text="Protocol authorization" preset="bold" />
          <Button
            text="Inscribe Transfer"
            onClick={() => {
              requestApproval({
                method: 'inscribeTransfer',
                params: {
                  ticker: 'sFB___000',
                  amount: '1000'
                }
              });
            }}
          />
        </Column>
      </Content>
    </Layout>
  );
}
