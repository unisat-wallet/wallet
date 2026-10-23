import { useEffect, useState } from 'react';

import { Column, Icon, Row, Text } from '@/ui/components';
import { AddressText } from '@/ui/components/AddressText';
import { RgbAddressBadge } from '@/ui/components/RgbAddressBadge';
import { colors } from '@/ui/theme/colors';
import { typography } from '@/ui/theme/typography';
import { numUtils } from '@unisat/base-utils';
import {
  DecodedPsbt,
  DecodedPsbtInput,
  DecodedPsbtOutput,
  Inscription,
  PsbtActionDetailType,
  TickPriceItem,
  ToSignData
} from '@unisat/wallet-shared';
import { useBTCUnit, useCurrentAddress, useI18n, useWallet } from '@unisat/wallet-state';
import { AssetList } from './AssetList';
import ContractSection from './ContractSection';
import { SighashSingleDetailsPopover } from './SighashSingleDetailsPopover';

export function InputItem(props: {
  index: number;
  inputInfo?: DecodedPsbtInput;
  outputInfo?: DecodedPsbtOutput;
  decodedPsbt: DecodedPsbt;
  toSignData?: ToSignData;
  isSighashSingle?: boolean;
  brc20PriceMap?: Record<string, TickPriceItem>;
  runesPriceMap?: Record<string, TickPriceItem>;
  setContractPopoverData: (data: any) => void;
}) {
  const { index, inputInfo, outputInfo, decodedPsbt, toSignData } = props;
  const currentAddress = useCurrentAddress();
  const wallet = useWallet();
  const btcUnit = useBTCUnit();
  const { t } = useI18n();
  const [rgbFundingAddress, setRgbFundingAddress] = useState('');
  const [showSighashSingleDetails, setShowSighashSingleDetails] = useState(false);
  const itemInfo = (inputInfo || outputInfo)!;

  const isToSign = inputInfo && toSignData!.toSignInputs.find((input) => input.index === index);
  const inscriptions: Inscription[] = [];
  const runes = itemInfo.runes || [];
  const alkanes = itemInfo.alkanes || [];
  const isMyAddress = itemInfo.address === currentAddress;
  const isRgbAddress = Boolean(rgbFundingAddress && itemInfo.address === rgbFundingAddress);
  const actionAddressDetail = toSignData?.action?.details?.find(
    (detail) =>
      detail.labelKey === 'my_rgb_fee_address' &&
      detail.type === PsbtActionDetailType.ADDRESS &&
      detail.value === itemInfo.address
  );
  const actionAddressLabel = actionAddressDetail
    ? actionAddressDetail.labelKey
      ? t(actionAddressDetail.labelKey)
      : actionAddressDetail.label
    : undefined;
  const highLightAddress = isToSign || isMyAddress || isRgbAddress || Boolean(actionAddressLabel);

  useEffect(() => {
    let cancelled = false;
    wallet
      .getRgbFundingAddress()
      .then(({ address }) => {
        if (!cancelled) setRgbFundingAddress(address || '');
      })
      .catch(() => {
        if (!cancelled) setRgbFundingAddress('');
      });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const brc20Array: { tick: string; amt: string; inscriptionNumber: number; preview: string }[] = [];
  itemInfo.inscriptions.forEach((w) => {
    const inscriptionInfo = decodedPsbt.inscriptions[w.inscriptionId];
    if (inscriptionInfo.brc20 && inscriptionInfo.brc20.op == 'transfer') {
      brc20Array.push({
        tick: inscriptionInfo.brc20.tick,
        amt: inscriptionInfo.brc20.amt,
        inscriptionNumber: w.inscriptionNumber,
        preview: inscriptionInfo.preview
      });
    } else {
      inscriptions.push(inscriptionInfo);
    }
  });

  return (
    <Row style={index === 0 ? {} : { borderColor: colors.border, borderTopWidth: 1, paddingTop: 10 }} itemsCenter>
      <Column fullX>
        <Row fullX mb="md">
          {inputInfo && <Icon icon="psbt_input" size={28} />}
          {outputInfo &&
            (outputInfo.address.startsWith('OP') ? (
              <Icon icon="psbt_opreturn" size={28} />
            ) : (
              <Icon icon="psbt_output" size={28} />
            ))}

          <Column style={{ minWidth: 0, flex: 1 }}>
            <Row>
              <Text
                text={`${numUtils.satoshisToAmount(itemInfo.value)} ${btcUnit}`}
                color={highLightAddress ? 'white' : 'textDim'}
              />
            </Row>

            <Row itemsCenter fullX style={{ gap: 4, flexWrap: 'wrap', minWidth: 0 }}>
              <AddressText address={itemInfo.address} color={highLightAddress ? 'ticker_color2' : 'textDim'} />

              {isRgbAddress && <RgbAddressBadge />}

              {actionAddressLabel && (
                <Row style={{ padding: '2px 4px', backgroundColor: 'rgba(37,160,121,0.15)', borderRadius: 4 }}>
                  <Text text={actionAddressLabel} style={{ color: '#25a079' }} size="xxs" />
                </Row>
              )}

              {isMyAddress && (
                <Row style={{ padding: 2, backgroundColor: colors.bg2, borderRadius: 5 }}>
                  <Text text={t('my_address')} color="white_muted2" size="xxs" />
                </Row>
              )}
              {itemInfo.contract && (
                <ContractSection contract={itemInfo.contract} setContractPopoverData={props.setContractPopoverData} />
              )}

              {isToSign && (
                <Row justifyEnd>
                  <Row style={{ borderWidth: 1, borderColor: 'gold', borderRadius: 5, padding: 2 }}>
                    <Text text={t('to_sign')} color="gold" size="xxs" />
                  </Row>
                </Row>
              )}
              {inputInfo && props.isSighashSingle && (
                <button
                  type="button"
                  onClick={() => setShowSighashSingleDetails(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '2px 4px',
                    backgroundColor: 'rgba(244, 182, 44, 0.15)',
                    border: 0,
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontFamily: typography.primary.regular,
                    fontSize: 10,
                    lineHeight: 'normal'
                  }}>
                  <span style={{ color: colors.warning }}>
                    {`SIGHASH_SINGLE${(inputInfo.sighashType & 0x80) !== 0 ? '|ANYONECANPAY' : ''}`}
                  </span>
                </button>
              )}
            </Row>
          </Column>
        </Row>

        <AssetList
          inscriptions={inscriptions.filter((v) => {
            return !(v.brc20 && v.brc20.op == 'transfer');
          })}
          brc20List={brc20Array}
          runes={runes}
          decodedPsbt={decodedPsbt}
          alkanes={alkanes as any}
          isToSign={!!isToSign}
          isMyAddress={currentAddress === itemInfo.address}
          runesPriceMap={props.runesPriceMap}
          brc20PriceMap={props.brc20PriceMap}
        />
      </Column>
      {showSighashSingleDetails && inputInfo && (
        <SighashSingleDetailsPopover
          hasAnyoneCanPay={(inputInfo.sighashType & 0x80) !== 0}
          onClose={() => setShowSighashSingleDetails(false)}
        />
      )}
    </Row>
  );
}
