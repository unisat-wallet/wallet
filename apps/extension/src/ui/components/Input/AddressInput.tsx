import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Icon, Row, Text } from '@/ui/components';
import { isValidAddress } from '@/ui/utils/bitcoin-utils';
import { openSafeUrl } from '@/ui/utils/openSafeUrl';
import { namesUtils } from '@unisat/base-utils';
import { Inscription } from '@unisat/wallet-shared';
import { SAFE_DOMAIN_CONFIRMATION } from '@unisat/wallet-shared';
import { useChain, useI18n, useWallet } from '@unisat/wallet-state';

import { $baseContainerStyle, $baseTextareaStyle, InputProps } from '.';
import { AccordingInscription } from '../AccordingInscription';
import { Column } from '../Column';
import { ContactsModal } from '../ContactsModal';
import { CopyableAddress } from '../CopyableAddress';
import { sendInputContainerStyle } from '../TransferAmountCard';

export const AddressInput = (props: InputProps) => {
  const { t } = useI18n();
  const {
    placeholder,
    onAddressInputChange,
    addressInputData,
    style: $inputStyleOverride,
    networkType: propsNetworkType,
    recipientLabel,
    containerStyle,
    ...rest
  } = props;

  if (!addressInputData || !onAddressInputChange) {
    return <div />;
  }

  const [showContactsModal, setShowContactsModal] = useState(false);
  const [validAddress, setValidAddress] = useState(addressInputData.address || '');
  const [parseName, setParseName] = useState<boolean>(false);
  const [parseAddress, setParseAddress] = useState(addressInputData.domain ? addressInputData.address : '');
  const [parseError, setParseError] = useState('');
  const [formatError, setFormatError] = useState('');
  const [inscription, setInscription] = useState<Inscription>();
  const [inputVal, setInputVal] = useState(addressInputData.domain || addressInputData.address || '');
  const [searching, setSearching] = useState(false);
  const [addressTip, setAddressTip] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isWrapped, setIsWrapped] = useState(false);

  const syncTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }

    el.style.height = '22px';
    const nextHeight = Math.max(22, el.scrollHeight);
    el.style.height = `${nextHeight}px`;
    setIsWrapped(nextHeight > 24);
  }, []);

  useEffect(() => {
    syncTextareaHeight();
  }, [inputVal, syncTextareaHeight]);

  const wallet = useWallet();
  const chain = useChain();
  const networkType = propsNetworkType || chain.enum;

  let SUPPORTED_DOMAINS = ['sats', 'unisat', 'x', 'btc'];
  let inputAddressPlaceholder = props.addressPlaceholder || t('address_or_name_sats_unisat_etc');
  if (chain.isFractal) {
    SUPPORTED_DOMAINS = ['fb'];
    inputAddressPlaceholder = t('address_or_name_fb');
  }

  useEffect(() => {
    onAddressInputChange({
      address: validAddress,
      domain: parseAddress ? inputVal : '',
      inscription
    });

    setAddressTip('');
  }, [validAddress]);

  const resetState = () => {
    if (parseError) {
      setParseError('');
    }
    if (parseAddress) {
      setParseAddress('');
    }
    if (formatError) {
      setFormatError('');
    }

    if (validAddress) {
      setValidAddress('');
    }

    if (inscription) {
      setInscription(undefined);
    }
    setParseName(false);
  };

  const handleInputAddress = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const inputAddress = e.target.value.trim();
    setInputVal(inputAddress);

    resetState();

    const teststr = inputAddress.toLowerCase();
    const satsname = namesUtils.getSatsName(teststr);
    if (satsname) {
      if (SUPPORTED_DOMAINS.includes(satsname.suffix)) {
        setSearching(true);
        wallet
          .queryDomainInfo(encodeURIComponent(inputAddress))
          .then((inscription) => {
            resetState();
            if (!inscription) {
              setParseError(`${inputAddress} ${t('does_not_exist')}`);
              return;
            }
            setInscription(inscription);
            if (inscription.utxoConfirmation < SAFE_DOMAIN_CONFIRMATION) {
              setParseError(
                `${t('this_domain_has_been_transferred_or_inscribed_recently_please_wait_for_block_confirmations')} (${
                  inscription.utxoConfirmation
                }/${SAFE_DOMAIN_CONFIRMATION}).`
              );
              return;
            }

            const address = inscription.address || '';
            setParseAddress(address);
            setValidAddress(address);
            setParseName(true);
          })
          .catch(() => {
            setParseError(`${inputAddress} ${t('does_not_exist')}`);
          })
          .finally(() => {
            setSearching(false);
          });
      } else {
        return;
      }
    } else {
      if (!inputAddress) {
        return;
      }

      const isValid = isValidAddress(inputAddress);
      if (!isValid) {
        return;
      }
      setValidAddress(inputAddress);
    }
  };

  const onAddressBlur = () => {
    setFormatError('');
    const inputAddress = inputVal;
    if (inputAddress == '') return;

    if (!validAddress) {
      const teststr = inputAddress.toLowerCase();
      const satsname = namesUtils.getSatsName(teststr);
      if (satsname && SUPPORTED_DOMAINS.includes(satsname.suffix)) {
        return;
      }
      if (parseError || searching) {
        return;
      }
      setFormatError(t('recipient_address_is_invalid'));
    }
  };

  const addressFieldStyle = Object.assign({}, $baseTextareaStyle, {
    padding: 0,
    margin: 0,
    minHeight: 22,
    lineHeight: '22px',
    alignSelf: 'center',
    flex: 'none',
    width: '100%',
    display: 'block',
    boxSizing: 'border-box' as const
  }, $inputStyleOverride);

  return (
    <div style={{ alignSelf: 'stretch' }}>
      <Row justifyBetween itemsCenter style={{ marginTop: 20, marginBottom: 12 }}>
        {recipientLabel || <Text text={t('recipient')} preset="regular" />}
        <Row itemsCenter clickable onClick={() => setShowContactsModal(true)} style={{ cursor: 'pointer', gap: 0 }}>
          <Text text={t('address_book_placeholder')} color="yellow" style={{ fontSize: '14px' }} />
          <Icon icon="right" color="yellow" size={16} style={{ marginLeft: 4 }} />
        </Row>
      </Row>
      <div
        style={Object.assign({}, $baseContainerStyle, sendInputContainerStyle, {
          flexDirection: 'column',
          paddingTop: 0,
          paddingBottom: 0
        }, containerStyle)}>
        <div
          style={{
            minHeight: 56,
            display: 'flex',
            alignItems: isWrapped ? 'flex-start' : 'center',
            width: '100%',
            paddingTop: isWrapped ? 8 : 0,
            paddingBottom: isWrapped ? 8 : 0,
            boxSizing: 'border-box'
          }}>
          <textarea
            ref={textareaRef}
            placeholder={inputAddressPlaceholder}
            style={addressFieldStyle}
            onChange={(e) => {
              handleInputAddress(e);
              requestAnimationFrame(syncTextareaHeight);
            }}
            onBlur={onAddressBlur}
            value={inputVal}
            rows={1}
            autoCorrect="off"
            autoComplete="off"
            {...rest}
            spellCheck={false}
          />
        </div>

        {searching && (
          <Row full mt="sm">
            <Text preset="sub" text={t('loading')} />
          </Row>
        )}
        {inscription && (
          <Row full itemsCenter mb="md">
            <CopyableAddress address={parseAddress} />
            <AccordingInscription inscription={inscription} />
          </Row>
        )}
      </div>

      {parseName ? (
        <Row mt="md" gap="sm" itemsCenter>
          <Text preset="sub" size="sm" text={t('name_recognized_and_resolved')} />
          <Text
            preset="link"
            color="yellow"
            text={t('more_details')}
            onClick={() => {
              openSafeUrl('https://docs.unisat.io/unisat-wallet/name-recognized-and-resolved');
            }}
          />
        </Row>
      ) : null}
      {parseError && <Text text={parseError} preset="regular" color="error" mt="md" />}
      {addressTip && (
        <Column
          py={'lg'}
          px={'md'}
          mt="md"
          gap={'lg'}
          style={{
            borderRadius: 12,
            border: '1px solid rgba(245, 84, 84, 0.35)',
            background: 'rgba(245, 84, 84, 0.08)'
          }}>
          <Text text={addressTip} preset="regular" color="warning" />
        </Column>
      )}
      {formatError ? <Text text={formatError} preset="regular" color="error" mt="md" /> : null}

      {showContactsModal && (
        <ContactsModal
          onClose={() => setShowContactsModal(false)}
          onSelect={(contact) => {
            setInputVal(contact.address);
            resetState();
            const addressValue = contact.address.trim();

            if (isValidAddress(addressValue)) {
              setValidAddress(addressValue);
            } else {
              setFormatError(t('recipient_address_is_invalid'));
            }

            setShowContactsModal(false);
            requestAnimationFrame(syncTextareaHeight);
          }}
          selectedNetworkFilter={networkType}
        />
      )}
    </div>
  );
};
