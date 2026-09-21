import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Column, Content, Header, Icon, Layout, Text, Tooltip } from '@/ui/components';
import { FeeRateBar } from '@/ui/components/FeeRateBar';
import LoadingPage from '@/ui/components/LoadingPage';
import type { SignedData, SignPsbtParams, ToSignData } from '@unisat/wallet-shared';
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

import { copyToClipboard, shortAddress } from '@/ui/utils';

import { SignPsbt } from '../Approval/components';
import { IssueReviewModal } from './components/IssueReviewModal';
import { useRgbWriteLeaseGuard } from './components/useRgbWriteLeaseGuard';
import './RGBIssueScreen.less';

type RGBIssueScreenStep = 'issue' | 'sign_rgb_utxo';
type IssueField = 'ticker' | 'name' | 'amount' | 'precision';
type RgbIssueResult = { assetId: string; pendingConfirmation: boolean };
type RgbAllocationSummary = {
  available?: boolean;
  availableAllocationCount?: number;
  freeAllocationCount?: number;
  pendingConfirmation?: boolean;
  pendingAllocationCount?: number;
};
type IssueFormErrors = Partial<Record<IssueField, string>>;

const TICKER_MAX_BYTES = 8;
const NAME_MAX_BYTES = 40;
const PRECISION_MAX = 18;
const MAX_RGB_ISSUED_SUPPLY = BigInt('18446744073709551615');

const formatMaxRgbSupply = (precision: number) => {
  const atomic = MAX_RGB_ISSUED_SUPPLY.toString();
  if (precision === 0) return atomic;
  const padded = atomic.padStart(precision + 1, '0');
  return `${padded.slice(0, -precision)}.${padded.slice(-precision)}`;
};

const getErrorMessage = (error: unknown) => {
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; msg?: unknown };
    if (typeof value.msg === 'string') return value.msg;
    if (typeof value.message === 'string') return value.message;
  }
  return String(error || 'An unknown error occurred');
};

const getAvailableAllocationCount = (summary: RgbAllocationSummary) => {
  const confirmed = Number(summary.availableAllocationCount ?? summary.freeAllocationCount ?? 0);
  const pending = Number(summary.pendingAllocationCount ?? 0);
  const confirmedCount = Number.isFinite(confirmed) && confirmed > 0 ? confirmed : 0;
  const pendingCount = Number.isFinite(pending) && pending > 0 ? pending : 0;
  const total = confirmedCount + pendingCount;
  if (total > 0) return total;
  if (summary.available || summary.pendingConfirmation) return 1;
  return 0;
};

const getAssetId = (value: unknown) => {
  if (!value || typeof value !== 'object') return '';
  const assetId = (value as { assetId?: unknown }).assetId;
  return typeof assetId === 'string' ? assetId : '';
};

const getFormErrors = (ticker: string, name: string, amount: string, precision: string): IssueFormErrors => {
  const errors: IssueFormErrors = {};
  const tickerBytes = new TextEncoder().encode(ticker).length;
  if (!ticker) errors.ticker = 'required';
  else if (tickerBytes > TICKER_MAX_BYTES) errors.ticker = `Use up to ${TICKER_MAX_BYTES} characters`;
  const nameBytes = new TextEncoder().encode(name).length;
  if (!name) errors.name = 'required';
  else if (nameBytes > NAME_MAX_BYTES) errors.name = `Use up to ${NAME_MAX_BYTES} characters`;
  if (!precision) errors.precision = 'required';
  else if (!/^\d+$/.test(precision)) errors.precision = 'Enter a valid integer';
  else if (Number(precision) > PRECISION_MAX) {
    errors.precision = `Enter an integer between 0 and ${PRECISION_MAX}`;
  }
  const parsedPrecision = Number(precision);
  if (!amount) {
    errors.amount = 'required';
  } else if (
    !isValidRgbDecimalAmount(amount, parsedPrecision) ||
    !/[1-9]/.test(toRgbAtomicAmount(amount, parsedPrecision))
  ) {
    errors.amount = 'Enter a valid supply';
  } else if (BigInt(toRgbAtomicAmount(amount, parsedPrecision)) > MAX_RGB_ISSUED_SUPPLY) {
    errors.amount = `Maximum supply is ${formatMaxRgbSupply(parsedPrecision)}`;
  }
  return errors;
};

const getVisibleFieldError = (value: string, error?: string) =>
  value.trim() && error && error !== 'required' ? error : undefined;

const formatSupply = (amount: string, ticker: string) => {
  const [integerPart = '0', decimalPart = ''] = amount.split('.');
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formattedAmount = decimalPart ? `${formattedInteger}.${decimalPart}` : formattedInteger;
  return `${formattedAmount} ${ticker}`;
};

function IssueStatusMark({ pending }: { pending: boolean }) {
  if (pending) {
    return (
      <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="50" fill="#EBB94C" fillOpacity="0.05" />
        <circle cx="50.0011" cy="49.9991" r="39.0909" fill="#EBB94C" fillOpacity="0.06" />
        <path
          d="M50.275 23C44.8805 23 39.6072 24.5997 35.1218 27.5967C30.6365 30.5937 27.1406 34.8535 25.0762 39.8373C23.0118 44.8212 22.4717 50.3052 23.5241 55.5961C24.5765 60.8869 27.1742 65.7468 30.9887 69.5613C34.8031 73.3758 39.6631 75.9735 44.9539 77.0259C50.2447 78.0783 55.7288 77.5382 60.7127 75.4738C65.6965 73.4094 69.9563 69.9135 72.9533 65.4282C75.9503 60.9428 77.55 55.6695 77.55 50.275C77.55 46.6932 76.8445 43.1465 75.4738 39.8373C74.1031 36.5282 72.0941 33.5214 69.5613 30.9887C67.0286 28.4559 64.0219 26.4469 60.7127 25.0762C57.4035 23.7055 53.8568 23 50.275 23ZM57.9666 60.694C57.583 61.0771 57.0631 61.2923 56.521 61.2923C55.9789 61.2923 55.459 61.0771 55.0754 60.694L47.4657 53.0843C47.0819 52.7011 46.8661 52.1811 46.8656 51.6387V38.6695C46.8656 38.1269 47.0812 37.6066 47.4648 37.223C47.8484 36.8394 48.3687 36.6239 48.9113 36.6239C49.4538 36.6239 49.9741 36.8394 50.3577 37.223C50.7414 37.6066 50.9569 38.1269 50.9569 38.6695V50.7932L57.9666 57.8029C58.1579 57.9919 58.3098 58.217 58.4134 58.4651C58.5171 58.7133 58.5705 58.9795 58.5705 59.2485C58.5705 59.5174 58.5171 59.7837 58.4134 60.0318C58.3098 60.2799 58.1579 60.505 57.9666 60.694Z"
          fill="#EBB94C"
        />
      </svg>
    );
  }

  return (
    <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="50" fill="#7CDB98" fillOpacity="0.05" />
      <circle cx="50.0011" cy="49.9991" r="39.0909" fill="#7CDB98" fillOpacity="0.06" />
      <path
        d="M50.0032 22.7256C65.0652 22.7256 77.2759 34.9363 77.2759 49.9983C77.2759 65.0604 65.0652 77.271 50.0032 77.271C34.9412 77.271 22.7305 65.0604 22.7305 49.9983C22.7305 34.9363 34.9412 22.7256 50.0032 22.7256ZM61.6759 41.7326C61.4858 41.5428 61.2602 41.3923 61.012 41.2896C60.7637 41.187 60.4977 41.1342 60.229 41.1344C59.9604 41.1346 59.6944 41.1877 59.4463 41.2907C59.1982 41.3937 58.9728 41.5446 58.783 41.7347L46.6105 53.9256L41.2193 48.5569C40.834 48.1791 40.3149 47.9689 39.7752 47.9721C39.2355 47.9753 38.719 48.1917 38.3381 48.5741C37.9573 48.9565 37.743 49.4739 37.7419 50.0136C37.7409 50.5533 37.9531 51.0715 38.3325 51.4554L45.1712 58.266C45.5552 58.6485 46.0754 58.863 46.6175 58.8622C47.1595 58.8614 47.6791 58.6455 48.0621 58.262L61.678 44.6256C61.8678 44.4355 62.0183 44.2099 62.121 43.9616C62.2236 43.7134 62.2764 43.4473 62.2762 43.1787C62.276 42.91 62.2229 42.6441 62.1199 42.396C62.0169 42.1478 61.866 41.9224 61.6759 41.7326Z"
        fill="#7CDB98"
      />
    </svg>
  );
}

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
  tone,
  copyable
}: {
  label: string;
  value: string;
  tone?: 'pending' | 'confirmed' | 'failed';
  copyable?: boolean;
}) {
  const tools = useTools();
  const { t } = useI18n();
  const toneClass =
    tone === 'pending'
      ? 'rgb-issue-review-value-pending'
      : tone === 'confirmed'
        ? 'rgb-issue-review-value-confirmed'
        : tone === 'failed'
          ? 'rgb-issue-review-value-failed'
          : undefined;

  const handleCopy = () => {
    copyToClipboard(value).then(() => {
      tools.toastSuccess(t('copied'));
    });
  };

  return (
    <div className={`rgb-issue-review-row${copyable ? ' rgb-issue-review-row-copyable' : ''}`}>
      <span>{label}</span>
      {copyable ? (
        <button type="button" className="rgb-issue-review-copy" onClick={handleCopy}>
          <strong>{shortAddress(value, 10)}</strong>
          <Icon icon="copy" color="white_muted" size={14} />
        </button>
      ) : (
        <strong className={toneClass}>{value}</strong>
      )}
    </div>
  );
}

export default function RGBIssueScreen() {
  const nav = useNavigation();
  const wallet = useWallet();
  const tools = useTools();
  const { t } = useI18n();
  const currentAccount = useCurrentAccount();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
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
  const [fundingTxid, setFundingTxid] = useState('');
  const [issueResult, setIssueResult] = useState<RgbIssueResult>();
  const [reviewModalVisible, setReviewModalVisible] = useState(false);

  const formErrors = useMemo(
    () => getFormErrors(ticker.trim(), name.trim(), amount.trim(), precision.trim()),
    [amount, name, precision, ticker]
  );
  const isFormValid = Object.keys(formErrors).length === 0;
  const nameError = getVisibleFieldError(name, formErrors.name);
  const tickerError = getVisibleFieldError(ticker, formErrors.ticker);
  const amountError = getVisibleFieldError(amount, formErrors.amount);
  const precisionError = getVisibleFieldError(precision, formErrors.precision);
  const parsedPrecision = Number(precision);
  const assetPrecision =
    Number.isInteger(parsedPrecision) && parsedPrecision >= 0 && parsedPrecision <= PRECISION_MAX
      ? parsedPrecision
      : 0;
  const atomicSupply = toRgbAtomicAmount(amount.trim(), assetPrecision);
  const isFormLocked = loading;
  const isFeeRateValid = Number.isFinite(feeRate) && feeRate > 0;
  const canIssue = !isFormLocked && !fundingLoading && !!fundingAddress && isFormValid && isFeeRateValid;
  const assetTicker = ticker.trim() || 'ASSET';
  const displaySupply = formatSupply(amount.trim() || '0', assetTicker);

  const refreshFundingState = useCallback(async () => {
    setFundingLoading(true);
    try {
      const [funding] = await Promise.all([
        wallet.getRgbFundingAddress(),
        wallet.getRgbAllocationSummary({ skipSync: false })
      ]);
      setFundingAddress(funding.address);
    } catch (e: unknown) {
      setFundingAddress('');
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

  const issueAsset = useCallback(async () => {
    setLoading(true);
    setOperationError('');
    try {
      const value = await wallet.createRgbIssueNia({
        ticker: ticker.trim(),
        name: name.trim(),
        precision: assetPrecision,
        amounts: [atomicSupply]
      });
      const assetId = getAssetId(value);
      if (!assetId) {
        throw new Error('RGB issuance did not return an asset ID');
      }
      const result = value && typeof value === 'object' ? (value as { pendingConfirmation?: unknown }) : {};
      setReviewModalVisible(false);
      setIssueResult({
        assetId,
        pendingConfirmation: result.pendingConfirmation === true
      });
      void refreshFundingState();
      return true;
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      setOperationError(message);
      tools.toastError(message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [assetPrecision, atomicSupply, name, refreshFundingState, ticker, tools, wallet]);

  const startCreateRgbUtxo = useCallback(async () => {
    if (!isFeeRateValid) return;

    setFundingTxid('');
    setLoading(true);
    setOperationError('');
    try {
      const beginResult = await wallet.createRgbUtxosBegin({
        // The issuance consumes one funding UTXO; retain the other four for
        // subsequent invoices or issuances without another split transaction.
        num: 5,
        feeRate
      });
      const toSignData = beginResult?.toSignData as ToSignData | undefined;
      if (!toSignData) throw new Error('RGB UTXO creation did not return signing data');
      setReviewModalVisible(false);
      setUtxoToSignData(toSignData);
      setStep('sign_rgb_utxo');
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      setOperationError(message);
      tools.toastError(message);
    } finally {
      setLoading(false);
    }
  }, [feeRate, isFeeRateValid, tools, wallet]);

  const onDeploy = () => {
    if (!canIssue) return;

    void (async () => {
      setLoading(true);
      setOperationError('');
      try {
        const summary = await wallet.getRgbAllocationSummary({ skipSync: false });
        const availableCount = getAvailableAllocationCount(summary as RgbAllocationSummary);
        if (availableCount > 0) {
          await issueAsset();
          return;
        }
        await startCreateRgbUtxo();
      } catch (e: unknown) {
        const message = getErrorMessage(e);
        setOperationError(message);
        tools.toastError(message);
      } finally {
        setLoading(false);
      }
    })();
  };

  const onIssueAssetClick = () => {
    if (!canIssue) return;
    // Acquire (or explicitly take over) the RGB writer lease before showing
    // the review portal. Otherwise the lease modal sits behind the already
    // open review dialog and cannot be acted on.
    void requestWrite(() => setReviewModalVisible(true));
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
      const issued = await issueAsset();
      if (!issued) {
        resetRgbUtxoSignStep();
        return;
      }
      setUtxoToSignData(undefined);
      setStep('issue');
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      setOperationError(message);
      tools.toastError(message);
      resetRgbUtxoSignStep();
    } finally {
      tools.showLoading(false);
    }
  };

  if (issueResult) {
    return (
      <Layout style={{ backgroundColor: '#070706' }}>
        <Header onBack={() => nav.goBack()} title={t('issue_rgb_asset')} />
        <Content style={{ backgroundColor: '#070706', padding: '24px 16px 112px' }}>
          <main className="rgb-issue-page rgb-issue-success-page">
            <div className="rgb-issue-success-mark">
              <IssueStatusMark pending={issueResult.pendingConfirmation} />
            </div>
            <span className="rgb-issue-eyebrow">
              {issueResult.pendingConfirmation ? 'ASSET ISSUED - UNCONFIRMED' : 'ASSET DEPLOYED'}
            </span>
            <h1>{name.trim() || assetTicker}</h1>
            <section className="rgb-issue-section rgb-issue-result-card">
              <ReviewRow label={t('asset_id')} value={issueResult.assetId} copyable />
              <ReviewRow label={t('ticker_label')} value={assetTicker} />
              <ReviewRow label={t('total_supply')} value={displaySupply} />
              <ReviewRow label={t('precision_rgb')} value={precision.trim()} />
              <ReviewRow
                label="Status"
                value={issueResult.pendingConfirmation ? t('unconfirmed') : t('rgb_status_confirmed')}
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

  if (loading) {
    return <LoadingPage />;
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
            <FormField label={t('name_label')} error={nameError}>
              <input
                className={`rgb-issue-input ${nameError ? 'rgb-issue-input-error' : ''}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('asset_display_name')}
                maxLength={NAME_MAX_BYTES}
                disabled={isFormLocked}
              />
            </FormField>

            <FormField label={t('ticker_label')} error={tickerError}>
              <input
                className={`rgb-issue-input ${tickerError ? 'rgb-issue-input-error' : ''}`}
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder={t('ticker_placeholder')}
                maxLength={TICKER_MAX_BYTES}
                autoCapitalize="characters"
                disabled={isFormLocked}
              />
            </FormField>

            <FormField label={t('total_supply')} error={amountError}>
              <div className={`rgb-issue-input-shell ${amountError ? 'rgb-issue-input-error' : ''}`}>
                <input
                  className="rgb-issue-input rgb-issue-supply-input"
                  value={amount}
                  onChange={(e) => setAmount(normalizeRgbAmountInput(e.target.value, assetPrecision))}
                  inputMode="decimal"
                  placeholder={t('enter_total_supply')}
                  disabled={isFormLocked}
                />
                <span>{assetTicker}</span>
              </div>
            </FormField>

            <FormField
              label={t('precision_rgb')}
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
              error={precisionError}>
              <input
                className={`rgb-issue-input ${precisionError ? 'rgb-issue-input-error' : ''}`}
                value={precision}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
                  setPrecision(digits.replace(/^0+(?=\d)/, ''));
                }}
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
          error={operationError}
          onClose={() => setReviewModalVisible(false)}
          onConfirm={onDeploy}
          t={t}
        />
      ) : null}
      {writeLeaseModal}
    </Layout>
  );
}
