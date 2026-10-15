import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Column, Content, Header, Icon, Layout, Text, Tooltip } from '@/ui/components';
import { FeeRateBar } from '@/ui/components/FeeRateBar';
import LoadingPage from '@/ui/components/LoadingPage';
import { TxResultStatusMark } from '@/ui/components/TxResultStatusMark';
import type { SignedData, SignPsbtParams, ToSignData } from '@unisat/wallet-shared';
import {
  useCurrentAccount,
  useChain,
  useFeeRateBar,
  useI18n,
  useNavigation,
  useTools,
  useWallet,
  isValidRgbDecimalAmount,
  normalizeRgbAmountInput,
  toRgbAtomicAmount,
  estimateRgbUtxoCreateMinSats,
  RGB_UTXO_CREATE_COUNT
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
type Translate = ReturnType<typeof useI18n>['t'];

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

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; msg?: unknown };
    if (typeof value.msg === 'string') return value.msg;
    if (typeof value.message === 'string') return value.message;
  }
  return String(error || fallback);
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

const getFormErrors = (ticker: string, name: string, amount: string, precision: string, t: Translate): IssueFormErrors => {
  const errors: IssueFormErrors = {};
  const tickerBytes = new TextEncoder().encode(ticker).length;
  if (!ticker) errors.ticker = 'required';
  else if (tickerBytes > TICKER_MAX_BYTES) errors.ticker = t('rgb_use_up_to_characters', { count: TICKER_MAX_BYTES });
  const nameBytes = new TextEncoder().encode(name).length;
  if (!name) errors.name = 'required';
  else if (nameBytes > NAME_MAX_BYTES) errors.name = t('rgb_use_up_to_characters', { count: NAME_MAX_BYTES });
  if (!precision) errors.precision = 'required';
  else if (!/^\d+$/.test(precision)) errors.precision = t('rgb_enter_valid_integer');
  else if (Number(precision) > PRECISION_MAX) {
    errors.precision = t('rgb_enter_integer_range', { max: PRECISION_MAX });
  }
  const parsedPrecision = Number(precision);
  if (!amount) {
    errors.amount = 'required';
  } else if (errors.precision) {
    // Supply validation requires a valid precision.
  } else if (
    !isValidRgbDecimalAmount(amount, parsedPrecision) ||
    !/[1-9]/.test(toRgbAtomicAmount(amount, parsedPrecision))
  ) {
    errors.amount = t('rgb_enter_valid_supply');
  } else if (BigInt(toRgbAtomicAmount(amount, parsedPrecision)) > MAX_RGB_ISSUED_SUPPLY) {
    errors.amount = t('rgb_maximum_supply', { amount: formatMaxRgbSupply(parsedPrecision) });
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
  const chain = useChain();
  const fundingRequestRef = useRef(0);
  const [availableFundingSats, setAvailableFundingSats] = useState<number>();
  const { requestWrite, writeLeaseModal } = useRgbWriteLeaseGuard();
  const { feeRate } = useFeeRateBar();
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [precision, setPrecision] = useState('0');
  const [loading, setLoading] = useState(false);
  const [fundingLoading, setFundingLoading] = useState(true);
  const [availableIssueUtxoCount, setAvailableIssueUtxoCount] = useState<number>();
  const [operationError, setOperationError] = useState('');
  const [step, setStep] = useState<RGBIssueScreenStep>('issue');
  const [utxoToSignData, setUtxoToSignData] = useState<ToSignData>();
  const [fundingAddress, setFundingAddress] = useState('');
  const [fundingTxid, setFundingTxid] = useState('');
  const [issueResult, setIssueResult] = useState<RgbIssueResult>();
  const [reviewModalVisible, setReviewModalVisible] = useState(false);

  const formErrors = useMemo(
    () => getFormErrors(ticker.trim(), name.trim(), amount.trim(), precision.trim(), t),
    [amount, name, precision, t, ticker]
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
  const estimatedFundingSats = estimateRgbUtxoCreateMinSats(feeRate);
  const insufficientBtcForFunding =
    !fundingLoading && availableIssueUtxoCount === 0 && availableFundingSats !== undefined && availableFundingSats < estimatedFundingSats;
  const canIssue =
    !isFormLocked &&
    !fundingLoading &&
    !!fundingAddress &&
    isFormValid &&
    isFeeRateValid &&
    !insufficientBtcForFunding;
  const assetTicker = ticker.trim() || 'ASSET';
  const displaySupply = formatSupply(amount.trim() || '0', assetTicker);

  const refreshFundingState = useCallback(async () => {
    const request = ++fundingRequestRef.current;
    setFundingLoading(true);
    setAvailableFundingSats(undefined);
    setAvailableIssueUtxoCount(undefined);
    try {
      const [funding, summary, balance] = await Promise.all([
        wallet.getRgbFundingAddress(),
        wallet.getRgbAllocationSummary({ skipSync: false }),
        wallet.getAddressBalanceV2(currentAccount.address)
      ]);
      if (request !== fundingRequestRef.current) return;
      setAvailableFundingSats(balance.availableBalance);
      setFundingAddress(funding.address);
      setAvailableIssueUtxoCount(getAvailableAllocationCount(summary as RgbAllocationSummary));
    } catch (e: unknown) {
      if (request !== fundingRequestRef.current) return;
      setFundingAddress('');
      setAvailableIssueUtxoCount(undefined);
      setOperationError(getErrorMessage(e, t('unknown_error')));
    } finally {
      if (request === fundingRequestRef.current) setFundingLoading(false);
    }
  }, [t, wallet, currentAccount.address, chain.enum]);

  useEffect(() => {
    setIssueResult(undefined);
    setFundingTxid('');
    setOperationError('');
    void refreshFundingState();
    return () => { fundingRequestRef.current += 1; };
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
        throw new Error(t('rgb_issuance_missing_asset_id'));
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
      const message = getErrorMessage(e, t('unknown_error'));
      setOperationError(message);
      tools.toastError(message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [assetPrecision, atomicSupply, name, refreshFundingState, t, ticker, tools, wallet]);

  const startCreateRgbUtxo = useCallback(async () => {
    if (!isFeeRateValid) return;

    setFundingTxid('');
    setLoading(true);
    setOperationError('');
    try {
      const beginResult = await wallet.createRgbUtxosBegin({
        // The issuance consumes one funding UTXO; retain the other four for
        // subsequent invoices or issuances without another split transaction.
        num: RGB_UTXO_CREATE_COUNT,
        feeRate
      });
      const toSignData = beginResult?.toSignData as ToSignData | undefined;
      if (!toSignData) throw new Error(t('rgb_utxo_signing_data_missing'));
      setReviewModalVisible(false);
      setUtxoToSignData(toSignData);
      setStep('sign_rgb_utxo');
    } catch (e: unknown) {
      const message = getErrorMessage(e, t('unknown_error'));
      setOperationError(message);
      tools.toastError(message);
    } finally {
      setLoading(false);
    }
  }, [feeRate, isFeeRateValid, t, tools, wallet]);

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
        const message = getErrorMessage(e, t('unknown_error'));
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
      if (!signedPsbt) throw new Error(t('rgb_psbt_signing_missing_result'));
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
      const message = getErrorMessage(e, t('unknown_error'));
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
              <TxResultStatusMark pending={issueResult.pendingConfirmation} />
            </div>
            <span className="rgb-issue-eyebrow">
              {t(issueResult.pendingConfirmation ? 'rgb_asset_issued_unconfirmed' : 'rgb_asset_deployed')}
            </span>
            <h1>{name.trim() || assetTicker}</h1>
            <section className="rgb-issue-section rgb-issue-result-card">
              <ReviewRow label={t('asset_id')} value={issueResult.assetId} copyable />
              <ReviewRow label={t('ticker_label')} value={assetTicker} />
              <ReviewRow label={t('total_supply')} value={displaySupply} />
              <ReviewRow label={t('precision_rgb')} value={precision.trim()} />
              <ReviewRow
                label={t('status')}
                value={issueResult.pendingConfirmation ? t('unconfirmed') : t('rgb_status_confirmed')}
                tone={issueResult.pendingConfirmation ? 'pending' : 'confirmed'}
              />
            </section>
          </main>
        </Content>
        <div className="rgb-issue-bottom-action">
          <button className="rgb-issue-deploy-button" type="button" onClick={() => nav.goBack()}>
            {t('done')}
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
          {insufficientBtcForFunding ? (
            <Text
              text={`${t('not_enough_btc_for_rgb_utxo')} ${t('rgb_utxo_recommended_balance')}`}
              wrap
              size="xs"
              color="danger"
              style={{ marginBottom: 16 }}
            />
          ) : null}
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

            {availableIssueUtxoCount === 0 ? (
              <>
                <div className="rgb-issue-fee-section">
                  <FeeRateBar autoFocus={false} />
                </div>

              </>
            ) : null}
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
