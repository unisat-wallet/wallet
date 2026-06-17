import { useState } from 'react';

import { Button, Column, Content, Header, Layout, Row, Text } from '@/ui/components';
import type { SignedData, SignPsbtParams, ToSignData } from '@unisat/wallet-shared';
import { useI18n, useNavigation, useTools, useWallet } from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';

type RGBIssueScreenStep = 'issue' | 'sign_rgb_utxo';

type RgbPendingVanillaTx = {
  txid?: string;
  type?: string;
  [key: string]: unknown;
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 6,
  color: '#fff',
  padding: '10px 12px'
};

const resultStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  resize: 'vertical' as const,
  background: 'rgba(0,0,0,0.24)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#fff',
  padding: '10px 12px',
  fontSize: 11
};

function shouldOfferCreateUtxo(error: string) {
  return /utxo|allocation|insufficient|fund/i.test(error);
}

export default function RGBIssueScreen() {
  const nav = useNavigation();
  const wallet = useWallet();
  const tools = useTools();
  const { t } = useI18n();
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [precision, setPrecision] = useState('0');
  const [feeRate, setFeeRate] = useState('1');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [utxoResult, setUtxoResult] = useState('');
  const [step, setStep] = useState<RGBIssueScreenStep>('issue');
  const [utxoBeginResult, setUtxoBeginResult] = useState<unknown>();
  const [utxoToSignData, setUtxoToSignData] = useState<ToSignData>();
  const [utxoPendingVanillaTxid, setUtxoPendingVanillaTxid] = useState('');

  const run = async (action: () => Promise<any>, onSuccess: (value: any) => void) => {
    setLoading(true);
    setError('');
    try {
      const value = await action();
      onSuccess(value);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const onIssue = () => {
    setResult('');
    run(
      () =>
        wallet.createRgbIssueNia({
          ticker: ticker.trim(),
          name: name.trim(),
          precision: Number(precision || '0'),
          amounts: [amount.trim()]
        }),
      (value) => setResult(JSON.stringify(value, null, 2))
    );
  };

  const getPendingVanillaTxList = (value: unknown): RgbPendingVanillaTx[] => {
    if (!value || typeof value !== 'object') return [];
    const record = value as { list?: RgbPendingVanillaTx[]; data?: { list?: RgbPendingVanillaTx[] } };
    if (Array.isArray(record.list)) return record.list;
    if (record.data && Array.isArray(record.data.list)) return record.data.list;
    return [];
  };

  const getRgbUtxoBeginTxid = (value: unknown) => {
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    if (typeof record.txid === 'string') return record.txid;

    const data = record.data;
    if (data && typeof data === 'object') {
      const dataRecord = data as Record<string, unknown>;
      if (typeof dataRecord.txid === 'string') return dataRecord.txid;
    }

    return '';
  };

  const abortRgbVanillaTx = async (txid?: string) => {
    if (!txid) return;
    try {
      await wallet.abortRgbVanillaTx({ txid });
    } catch (e) {
      console.warn('Failed to abort RGB vanilla tx', e);
    }
  };

  const abortPendingCreateUtxosVanillaTxs = async () => {
    try {
      const result = await wallet.getRgbPendingVanillaTxs();
      const list = getPendingVanillaTxList(result).filter(
        (item) => item.txid && String(item.type || '').toLowerCase() === 'createutxos'
      );

      await Promise.all(list.map((item) => abortRgbVanillaTx(item.txid)));
    } catch (e) {
      console.warn('Failed to clean pending RGB vanilla txs', e);
    }
  };

  const onCreateUtxo = () => {
    setUtxoResult('');
    run(
      async () => {
        await abortPendingCreateUtxosVanillaTxs();
        const beginResult = await wallet.createRgbUtxosBegin({
          num: 1,
          feeRate: Number(feeRate || '1')
        });
        const toSignData = beginResult?.toSignData;
        if (!toSignData) {
          return beginResult;
        }
        setUtxoBeginResult(beginResult);
        setUtxoToSignData(toSignData);
        setUtxoPendingVanillaTxid(getRgbUtxoBeginTxid(beginResult));
        setStep('sign_rgb_utxo');
        return undefined;
      },
      (value) => {
        if (value !== undefined) {
          setUtxoResult(JSON.stringify(value, null, 2));
        }
      }
    );
  };

  const resetRgbUtxoSignStep = async () => {
    await abortRgbVanillaTx(utxoPendingVanillaTxid);
    setStep('issue');
    setUtxoBeginResult(undefined);
    setUtxoToSignData(undefined);
    setUtxoPendingVanillaTxid('');
  };

  const onSignRgbUtxoHandleConfirm = async (signedDatas: SignedData[]) => {
    tools.showLoading(true);
    setError('');
    try {
      const signedPsbt = signedDatas[0]?.psbtHex;
      if (!signedPsbt) {
        throw new Error('RGB UTXO PSBT signing did not return psbtHex');
      }
      const endResult = await wallet.createRgbUtxosEnd({ signedPsbt });
      setUtxoResult(JSON.stringify({ beginResult: utxoBeginResult, signed: signedDatas[0], endResult }, null, 2));
      setStep('issue');
      setUtxoBeginResult(undefined);
      setUtxoToSignData(undefined);
      setUtxoPendingVanillaTxid('');
    } catch (e: any) {
      await abortRgbVanillaTx(utxoPendingVanillaTxid);
      setError(e?.message || String(e));
      setStep('issue');
      setUtxoBeginResult(undefined);
      setUtxoToSignData(undefined);
      setUtxoPendingVanillaTxid('');
    } finally {
      tools.showLoading(false);
    }
  };

  const signRgbUtxoParams: SignPsbtParams = {
    data: {
      toSignDatas: utxoToSignData ? [utxoToSignData] : []
    }
  };

  if (step === 'sign_rgb_utxo') {
    return (
      <SignPsbt
        header={<Header onBack={resetRgbUtxoSignStep} />}
        params={signRgbUtxoParams}
        handleCancel={resetRgbUtxoSignStep}
        handleConfirm={onSignRgbUtxoHandleConfirm}
      />
    );
  }

  return (
    <Layout>
      <Header onBack={() => nav.goBack()} title={t('issue_rgb20')} />
      <Content>
        <Column gap="lg">
          <Column gap="md">
            <Text text={t('asset')} size="sm" color="white_muted" />
            <Row fullX gap="sm">
              <input
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                placeholder={t('ticker')}
                style={inputStyle}
              />
              <input
                value={precision}
                onChange={(e) => setPrecision(e.target.value)}
                placeholder={t('precision_rgb')}
                style={{ ...inputStyle, width: 96 }}
              />
            </Row>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('name_label')}
              style={inputStyle}
            />
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('amount')}
              style={inputStyle}
            />
            <Button
              text={t('issue_nia_asset')}
              preset="primary"
              disabled={loading || !ticker.trim() || !name.trim() || !amount.trim()}
              onClick={onIssue}
            />
            {result ? <textarea value={result} readOnly rows={8} style={resultStyle} /> : null}
          </Column>

          {error ? (
            <Column gap="md">
              <Text text={error} size="xs" color="danger" wrap />
              {shouldOfferCreateUtxo(error) ? (
                <>
                  <Text text={t('create_rgb_utxo_first')} size="xs" color="white_muted" />
                  <Row fullX gap="sm">
                    <input
                      value={feeRate}
                      onChange={(e) => setFeeRate(e.target.value)}
                      placeholder={t('fee_rate')}
                      style={inputStyle}
                    />
                    <Button text={t('create_rgb_utxo')} preset="default" disabled={loading} onClick={onCreateUtxo} />
                  </Row>
                  {utxoResult ? <textarea value={utxoResult} readOnly rows={8} style={resultStyle} /> : null}
                </>
              ) : null}
            </Column>
          ) : null}
        </Column>
      </Content>
    </Layout>
  );
}
