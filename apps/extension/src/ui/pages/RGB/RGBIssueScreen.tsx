import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Column, Content, Header, Layout, Text, Tooltip } from '@/ui/components';
import { FeeRateBar } from '@/ui/components/FeeRateBar';
import type { SignedData, SignPsbtParams, ToSignData } from '@unisat/wallet-shared';
import { faCheck, faClock } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  useCurrentAccount,
  useFeeRateBar,
  useI18n,
  useNavigation,
  useTools,
  useWallet,
  isValidRgbDecimalAmount,
  normalizeRgbAmountInput,
  toRgbAtomicAmount
} from '@unisat/wallet-state';

import { SignPsbt } from '../Approval/components';
import { IssueReviewModal } from './components/IssueReviewModal';
import './RGBIssueScreen.less';

type RGBIssueScreenStep = 'issue' | 'sign_rgb_utxo';
type IssueField = 'ticker' | 'name' | 'amount' | 'precision';
type RgbIssueResult = { assetId: string; pendingConfirmation: boolean };
type RgbAllocationSummary = { available?: boolean; availableAllocationCount?: number; freeAllocationCount?: number };
type IssueFormErrors = Partial<Record<IssueField, string>>;

const TICKER_MAX_BYTES = 8;
const NAME_MAX_BYTES = 40;
const PRECISION_MAX = 18;

const getErrorMessage = (error: unknown) => {
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; msg?: unknown };
    if (typeof value.msg === 'string') return value.msg;
    if (typeof value.message === 'string') return value.message;
  }
  return String(error || 'An unknown error occurred');
};

const getAvailableAllocationCount = (summary: RgbAllocationSummary) => {
  const count = Number(summary.availableAllocationCount ?? summary.freeAllocationCount ?? 0);
  return Number.isFinite(count) && count >= 0 ? count : summary.available ? 1 : 0;
};

const getAssetId = (value: unknown) => {
  if (!value || typeof value !== 'object') return '';
  const assetId = (value as { assetId?: unknown }).assetId;
  return typeof assetId === 'string' ? assetId : '';
};

const getFormErrors = (ticker: string, name: string, amount: string, precision: string): IssueFormErrors => {
  const errors: IssueFormErrors = {};
  if (!ticker || new TextEncoder().encode(ticker).length > TICKER_MAX_BYTES)
    errors.ticker = `Use up to ${TICKER_MAX_BYTES} characters`;
  if (!name || new TextEncoder().encode(name).length > NAME_MAX_BYTES)
    errors.name = `Use up to ${NAME_MAX_BYTES} characters`;
  if (!/^\d+$/.test(precision) || Number(precision) > PRECISION_MAX) errors.precision = 'Enter a valid integer';
  const parsedPrecision = Number(precision);
  if (
    !isValidRgbDecimalAmount(amount, parsedPrecision) ||
    !/[1-9]/.test(toRgbAtomicAmount(amount, parsedPrecision))
  ) {
    errors.amount = 'Enter a valid supply';
  }
  return errors;
};

const formatSupply = (amount: string, ticker: string) => {
  const [integerPart = '0', decimalPart = ''] = amount.split('.');
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formattedAmount = decimalPart ? `${formattedInteger}.${decimalPart}` : formattedInteger;
  return `${formattedAmount} ${ticker}`;
};

function FormField({
  label,
  labelExtra,
  error,
  children
}: {
  label: string;
  labelExtra?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="rgb-issue-field">
      <div className="rgb-issue-label-row">
        <span className="rgb-issue-label">{label}</span>
        {labelExtra}
      </div>
      {children}
      {error ? <span className="rgb-issue-error">{error}</span> : null}
    </label>
  );
}

function ReviewRow({
  label,
  value,
  accent,
  tone
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: 'pending' | 'confirmed' | 'failed';
}) {
  const toneClass =
    tone === 'pending'
      ? 'rgb-issue-review-value-pending'
      : tone === 'confirmed'
        ? 'rgb-issue-review-value-confirmed'
        : tone === 'failed'
          ? 'rgb-issue-review-value-failed'
          : undefined;

  return (
    <div className="rgb-issue-review-row">
      <span>{label}</span>
      <strong className={accent ? 'rgb-issue-review-value-accent' : toneClass}>{value}</strong>
    </div>
  );
}

export default function RGBIssueScreen() {
  const nav = useNavigation();
  const wallet = useWallet();
  const tools = useTools();
  const { t } = useI18n();
  const currentAccount = useCurrentAccount();
  const { feeRate } = useFeeRateBar();
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [precision, setPrecision] = useState('0');
  const [loading, setLoading] = useState(false);
  const [fundingLoading, setFundingLoading] = useState(true);
  const [operationError, setOperationError] = useState('');
  const [step, setStep] = useState<RGBIssueScreenStep>('issue');
  const [utxoToSignData, setUtxoToSignData] = useState<ToSignData>();
  const [fundingAddress, setFundingAddress] = useState('');
  const [availableAllocationCount, setAvailableAllocationCount] = useState(0);
  const [fundingTxid, setFundingTxid] = useState('');
  const [issueResult, setIssueResult] = useState<RgbIssueResult>();
  const [touched, setTouched] = useState<Partial<Record<IssueField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);

  const formErrors = useMemo(
    () => getFormErrors(ticker.trim(), name.trim(), amount.trim(), precision.trim()),
    [amount, name, precision, ticker]
  );
  const isFormValid = Object.keys(formErrors).length === 0;
  const parsedPrecision = Number(precision);
  const assetPrecision =
    Number.isInteger(parsedPrecision) && parsedPrecision >= 0 && parsedPrecision <= PRECISION_MAX
      ? parsedPrecision
      : 0;
  const atomicSupply = toRgbAtomicAmount(amount.trim(), assetPrecision);
  const hasFundingAllocation = availableAllocationCount > 0;
  const isFormLocked = loading;
  const canIssue = !isFormLocked && !fundingLoading && !!fundingAddress && isFormValid;
  const assetTicker = ticker.trim() || 'ASSET';
  const displaySupply = formatSupply(amount.trim() || '0', assetTicker);

  const refreshFundingState = useCallback(async () => {
    setFundingLoading(true);
    try {
      const [funding, summary] = await Promise.all([
        wallet.getRgbFundingAddress(),
        wallet.getRgbAllocationSummary({ skipSync: false })
      ]);
      const availableCount = getAvailableAllocationCount(summary as RgbAllocationSummary);
      setFundingAddress(funding.address);
      setAvailableAllocationCount(availableCount);
    } catch (e: unknown) {
      setFundingAddress('');
      setAvailableAllocationCount(0);
      setOperationError(getErrorMessage(e));
    } finally {
      setFundingLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    setIssueResult(undefined);
    setFundingTxid('');
    setOperationError('');
    void refreshFundingState();
  }, [currentAccount?.key, refreshFundingState]);

  const run = useCallback(async <T,>(action: () => Promise<T>, onSuccess: (value: T) => void) => {
    setLoading(true);
    setOperationError('');
    try {
      onSuccess(await action());
    } catch (e: unknown) {
      setOperationError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const issueAsset = useCallback(() => {
    void run(
      () =>
        wallet.createRgbIssueNia({
          ticker: ticker.trim(),
          name: name.trim(),
          precision: assetPrecision,
          amounts: [atomicSupply]
        }),
      (value) => {
        const assetId = getAssetId(value);
        if (!assetId) {
          setOperationError('RGB issuance did not return an asset ID');
          return;
        }
        const result = value && typeof value === 'object' ? (value as { pendingConfirmation?: unknown }) : {};
        setReviewModalVisible(false);
        setIssueResult({
          assetId,
          pendingConfirmation: result.pendingConfirmation === true
        });
        void refreshFundingState();
      }
    );
  }, [assetPrecision, atomicSupply, name, refreshFundingState, run, ticker, wallet]);

  const startCreateRgbUtxo = useCallback(async () => {
    setFundingTxid('');
    setLoading(true);
    setOperationError('');
    try {
      const beginResult = await wallet.createRgbUtxosBegin({ num: 1, ...(feeRate > 0 ? { feeRate } : {}) });
      const toSignData = beginResult?.toSignData as ToSignData | undefined;
      if (!toSignData) throw new Error('RGB UTXO creation did not return signing data');
      setReviewModalVisible(false);
      setUtxoToSignData(toSignData);
      setStep('sign_rgb_utxo');
    } catch (e: unknown) {
      setOperationError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [feeRate, wallet]);

  const onDeploy = () => {
    if (hasFundingAllocation) {
      issueAsset();
    } else {
      void startCreateRgbUtxo();
    }
  };

  const onIssueAssetClick = () => {
    setSubmitted(true);
    if (!isFormValid) return;
    setReviewModalVisible(true);
  };

  const resetRgbUtxoSignStep = () => {
    setStep('issue');
    setUtxoToSignData(undefined);
  };
  const cancelRgbUtxoSignStep = () => {
    resetRgbUtxoSignStep();
  };
  const onSignRgbUtxoHandleConfirm = async (signedDatas: SignedData[]) => {
    tools.showLoading(true);
    setOperationError('');
    try {
      const signedPsbt = signedDatas[0]?.psbtHex;
      if (!signedPsbt) throw new Error('RGB UTXO PSBT signing did not return psbtHex');
      const endResult = await wallet.createRgbUtxosEnd({ signedPsbt });
      setFundingTxid(typeof endResult?.txid === 'string' ? endResult.txid : '');
      resetRgbUtxoSignStep();
      issueAsset();
    } catch (e: unknown) {
      setOperationError(getErrorMessage(e));
      resetRgbUtxoSignStep();
    } finally {
      tools.showLoading(false);
    }
  };

  if (step === 'sign_rgb_utxo') {
    const params: SignPsbtParams = { data: { toSignDatas: utxoToSignData ? [utxoToSignData] : [] } };
    return (
      <SignPsbt
        header={<Header onBack={cancelRgbUtxoSignStep} />}
        params={params}
        handleCancel={cancelRgbUtxoSignStep}
        handleConfirm={onSignRgbUtxoHandleConfirm}
      />
    );
  }

  if (issueResult) {
    return (
      <Layout style={{ backgroundColor: '#070706' }}>
        <Header onBack={() => nav.goBack()} title={t('issue_rgb_asset')} />
        <Content style={{ backgroundColor: '#070706', padding: '24px 16px 112px' }}>
          <main className="rgb-issue-page rgb-issue-success-page">
            <div className="rgb-issue-success-mark">
              <FontAwesomeIcon icon={issueResult.pendingConfirmation ? faClock : faCheck} />
            </div>
            <span className="rgb-issue-eyebrow">
              {issueResult.pendingConfirmation ? 'ASSET ISSUED - UNCONFIRMED' : 'ASSET DEPLOYED'}
            </span>
            <h1>{assetTicker}</h1>
            <p>{name.trim()}</p>
            <section className="rgb-issue-section rgb-issue-result-card">
              <ReviewRow label="Asset ID" value={issueResult.assetId} />
              <ReviewRow label={t('total_supply')} value={displaySupply} accent />
              <ReviewRow label={t('decimal_places_label')} value={precision.trim()} />
              <ReviewRow
                label="Status"
                value={issueResult.pendingConfirmation ? 'Pending confirmation' : 'Confirmed'}
                tone={issueResult.pendingConfirmation ? 'pending' : 'confirmed'}
              />
            </section>
          </main>
        </Content>
        <div className="rgb-issue-bottom-action">
          <button className="rgb-issue-deploy-button" type="button" onClick={() => nav.goBack()}>
            Done
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout style={{ backgroundColor: '#070706' }}>
      <Header onBack={() => nav.goBack()} title={t('issue_rgb_asset')} />
      <Content style={{ backgroundColor: '#070706', padding: '12px 16px 112px' }}>
        <main className="rgb-issue-page">
          <Text
            text={t('issue_rgb_asset_desc')}
            size="sm"
            style={{ color: 'rgba(255,255,255,0.65)', marginBottom: 16, display: 'block' }}
          />

          <Column gap="lg" fullX>
            <FormField label={t('ticker_label')} error={submitted || touched.ticker ? formErrors.ticker : undefined}>
              <input
                className={`rgb-issue-input ${submitted || touched.ticker ? (formErrors.ticker ? 'rgb-issue-input-error' : '') : ''}`}
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onBlur={() => setTouched((value) => ({ ...value, ticker: true }))}
                placeholder={t('ticker_placeholder')}
                maxLength={TICKER_MAX_BYTES}
                autoCapitalize="characters"
                disabled={isFormLocked}
              />
            </FormField>

            <FormField label={t('name_label')} error={submitted || touched.name ? formErrors.name : undefined}>
              <input
                className={`rgb-issue-input ${submitted || touched.name ? (formErrors.name ? 'rgb-issue-input-error' : '') : ''}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched((value) => ({ ...value, name: true }))}
                placeholder={t('asset_display_name')}
                maxLength={NAME_MAX_BYTES}
                disabled={isFormLocked}
              />
            </FormField>

            <FormField label={t('total_supply')} error={submitted || touched.amount ? formErrors.amount : undefined}>
              <div
                className={`rgb-issue-input-shell ${submitted || touched.amount ? (formErrors.amount ? 'rgb-issue-input-error' : '') : ''}`}>
                <input
                  className="rgb-issue-input rgb-issue-supply-input"
                  value={amount}
                  onChange={(e) => setAmount(normalizeRgbAmountInput(e.target.value, assetPrecision))}
                  onBlur={() => setTouched((value) => ({ ...value, amount: true }))}
                  inputMode="decimal"
                  placeholder={t('enter_total_supply')}
                  disabled={isFormLocked}
                />
                <span>{assetTicker}</span>
              </div>
            </FormField>

            <FormField
              label={t('decimal_places_label')}
              labelExtra={
                <Tooltip
                  title={t('decimal_places_tooltip')}
                  placement="top"
                  overlayInnerStyle={{
                    maxWidth: 293,
                    fontSize: 12,
                    lineHeight: '16px',
                    fontWeight: 600,
                    padding: '10px 12px',
                    borderRadius: 8,
                    backgroundColor: '#2A2A2E'
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <img src="./images/icons/status/circle-info-muted.svg" alt="" width={20} height={20} />
                  </div>
                </Tooltip>
              }
              error={submitted || touched.precision ? formErrors.precision : undefined}>
              <input
                className={`rgb-issue-input ${submitted || touched.precision ? (formErrors.precision ? 'rgb-issue-input-error' : '') : ''}`}
                value={precision}
                onChange={(e) => setPrecision(e.target.value.replace(/\D/g, '').slice(0, 2))}
                onBlur={() => setTouched((value) => ({ ...value, precision: true }))}
                inputMode="numeric"
                placeholder="0"
                disabled={isFormLocked}
              />
            </FormField>

            <div className="rgb-issue-fee-section">
              <FeeRateBar />
            </div>
          </Column>

          {fundingTxid ? <div className="rgb-issue-txid">Transaction ID: {fundingTxid}</div> : null}
          {operationError ? <div className="rgb-issue-operation-error">{operationError}</div> : null}
        </main>
      </Content>

      <div className="rgb-issue-bottom-action">
        <button
          className="rgb-issue-deploy-button"
          type="button"
          disabled={!canIssue}
          onClick={onIssueAssetClick}>
          {t('issue_asset')}
        </button>
      </div>

      {reviewModalVisible ? (
        <IssueReviewModal
          ticker={assetTicker}
          name={name.trim()}
          supply={displaySupply}
          precision={precision.trim()}
          loading={loading}
          onClose={() => setReviewModalVisible(false)}
          onConfirm={onDeploy}
          t={t}
        />
      ) : null}
    </Layout>
  );
}
