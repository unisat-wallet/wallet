import { useEffect, useState, type ReactNode } from 'react';

import { IMAGE_SOURCE_MAP } from '@/shared/constant';
import InscriptionPreview from '@/ui/components/InscriptionPreview';
import { BottomModal } from '@/ui/components/BottomModal';
import { BottomSheetHeader } from '@/ui/components/BottomSheetHeader';
import { CopyableAddress } from '@/ui/components/CopyableAddress';
import type { AddressHistorySummaryItem, AddressHistoryTxDetail, Inscription } from '@unisat/wallet-shared';
import { useChain, useCurrentAddress, useI18n, useNavigation, useWallet } from '@unisat/wallet-state';

import styles from './history.module.less';
import { getHistoryAssetChanges } from './historyAssetView';
import { HistoryTokenIcon } from './HistoryTokenIcon';

function formatHistoryDateTime(timestamp: number) {
  if (!timestamp) return '—';
  const date = new Date(timestamp * 1000);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.detailSummaryRow}>
      <span className={styles.detailSummaryLabel}>{label}</span>
      <span className={styles.detailSummaryValue}>{children}</span>
    </div>
  );
}

/** Shows the selected address transaction using the coin or inscription detail design. */
export function HistoryDetailSheet({ summary, onClose }: { summary: AddressHistorySummaryItem; onClose: () => void }) {
  const nav = useNavigation();
  const chain = useChain();
  const address = useCurrentAddress();
  const wallet = useWallet();
  const { t } = useI18n();
  const [detail, setDetail] = useState<AddressHistoryTxDetail>();
  const [inscription, setInscription] = useState<Inscription>();
  const txid = summary.txid;

  useEffect(() => {
    let active = true;
    if (!address) return;
    wallet
      .getAddressHistoryDetail({ address, txid })
      .then((result) => {
        if (active && result?.summary && Array.isArray(result.inputs) && Array.isArray(result.outputs)) {
          setDetail(result);
        }
      })
      .catch(() => {
        // The summary remains usable when transaction details are unavailable.
      });
    return () => {
      active = false;
    };
  }, [address, txid, wallet]);

  const resolvedSummary = detail?.summary || summary;
  const { changes } = getHistoryAssetChanges(resolvedSummary);
  const primary = changes[0];
  const isInscription = primary?.asset.kind === 'inscription';
  const inscriptionId = isInscription ? primary.asset.assetId : undefined;

  useEffect(() => {
    let active = true;
    setInscription(undefined);
    if (inscriptionId) {
      wallet
        .getInscriptionInfo(inscriptionId)
        .then((result) => {
          if (active) setInscription(result);
        })
        .catch(() => {
          // The inscription ID can still be displayed if its preview cannot load.
        });
    }
    return () => {
      active = false;
    };
  }, [inscriptionId, wallet]);

  const isReceive = primary?.sign === '+';
  const isCoin = primary?.asset.kind === 'coin';
  const counterparty = isReceive
    ? detail?.inputs.find((input) => !input.isMine)?.address || detail?.inputs[0]?.address
    : detail?.outputs.find((output) => !output.isMine)?.address || detail?.outputs[0]?.address;
  const fee = detail?.fee ?? (resolvedSummary.feeSatoshis / 100_000_000).toFixed(8);
  const coinUnit = chain.unit;
  const assetLabel = isCoin
    ? coinUnit
    : primary?.asset.displayName || primary?.asset.symbol || primary?.asset.kind || '';
  const inscriptionNumber = inscription?.inscriptionNumber || primary?.asset.displayName?.match(/#?\d+/)?.[0];

  return (
    <BottomModal onClose={onClose} bodyStyle={{ padding: 0 }} borderRadius="20px 20px 0 0">
      <div className={styles.detailSheet}>
        <BottomSheetHeader
          title={t(isReceive ? 'receive' : 'send')}
          onClose={onClose}
          height={60}
          inset={16}
          bottomSpacing={0}
          dividerColor="transparent"
          style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}
        />
        <div className={styles.detailSheetBody}>
          {isInscription ? (
            <div className={styles.detailInscriptionHero}>
              <div className={styles.detailInscriptionPreview}>
                {inscription ? (
                  <InscriptionPreview data={inscription} preset="small" />
                ) : (
                  <div className={styles.detailInscriptionFallback} title={inscriptionId}>
                    {inscriptionNumber ? `#${String(inscriptionNumber).replace('#', '')}` : primary?.asset.displayName || 'Inscription'}
                  </div>
                )}
              </div>
              <div className={styles.detailInscriptionAmount}>
                {primary.sign}1 Inscription{inscriptionNumber ? ` #${String(inscriptionNumber).replace('#', '')}` : ''}
              </div>
            </div>
          ) : (
            <div className={styles.detailCoinHero}>
              {isCoin ? (
                <img src={IMAGE_SOURCE_MAP[chain.icon]} alt="" className={styles.detailCoinIcon} />
              ) : (
                primary ? <HistoryTokenIcon asset={primary.asset} className={styles.detailCoinIcon} fallback={<span className={styles.detailOtherAssetIcon} aria-hidden="true">
                  {(primary?.asset.symbol || primary?.asset.kind || '?').slice(0, 2).toUpperCase()}
                </span>} /> : null
              )}
              <span>
                {primary?.sign || ''}{primary?.asset.amount || '0'} {assetLabel}
              </span>
            </div>
          )}

          <div className={styles.detailSummary}>
            <SummaryRow label={t('date')}>{formatHistoryDateTime(resolvedSummary.timestamp)}</SummaryRow>
            <SummaryRow label={t('status')}>
              <span className={resolvedSummary.status === 'confirmed' ? styles.detailConfirmed : styles.detailPending}>
                {t(resolvedSummary.status === 'confirmed' ? 'history_confirmed' : 'history_pending')}
              </span>
            </SummaryRow>
            <SummaryRow label={t(isReceive ? 'from' : 'to')}>
              {counterparty ? (
                <span className={styles.detailAddress}>
                  <CopyableAddress address={counterparty} copyPosition="after" len={8} color="text" />
                </span>
              ) : '—'}
            </SummaryRow>
            {!isReceive && !isInscription && detail && (
              <SummaryRow label={t('outputs')}>
                {detail.totalOutputValue} <span className={styles.detailUnit}>{chain.unit}</span>
              </SummaryRow>
            )}
            <SummaryRow label={t('network_fee')}>
              {fee} <span className={styles.detailUnit}>{chain.unit}</span>
            </SummaryRow>
          </div>
        </div>
        <div className={styles.detailFooter}>
          <button type="button" className={styles.detailExplorerButton} onClick={() => nav.navToExplorerTx(txid)}>
            {t('view_on_uniscan')}
          </button>
        </div>
      </div>
    </BottomModal>
  );
}
