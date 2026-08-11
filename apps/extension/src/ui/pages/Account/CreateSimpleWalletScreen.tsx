import { decode } from 'bs58check';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button, Column, Content, Header, Input, Layout, Row, Text } from '@/ui/components';
import { AddressTypeCard } from '@/ui/components/AddressTypeCard';
import { FooterButtonContainer } from '@/ui/components/FooterButtonContainer';
import { TabBar } from '@/ui/components/TabBar';
import { satoshisToAmount } from '@/ui/utils';
import { ADDRESS_TYPES, BUS_METHODS } from '@unisat/wallet-shared';
import { uiEventBus, useI18n, useTools, useWallet } from '@unisat/wallet-state';
import { AddressType } from '@unisat/wallet-types';

import { useNavigate } from '../MainRoute';
import { TabType } from './createHDWalletComponents/types';

function getWifCompression(privateKey: string): boolean | undefined {
  try {
    const decoded = decode(privateKey);
    if (decoded.length === 33) {
      return false;
    }
    if (decoded.length === 34 && decoded[33] === 0x01) {
      return true;
    }
  } catch {
    // Step 1 validates the private key before this screen is shown.
  }

  return undefined;
}

function Step1({
  contextData,
  updateContextData
}: {
  contextData: ContextData;
  updateContextData: (params: UpdateContextDataParams) => void;
}) {
  const [disabled, setDisabled] = useState(true);
  const wallet = useWallet();
  const { t } = useI18n();
  useEffect(() => {
    setDisabled(true);

    if (!contextData.wif) {
      return;
    }

    setDisabled(false);
  }, [contextData.wif]);

  const onChange = (e) => {
    const val = e.target.value;
    updateContextData({ wif: val, step1CreateWordsCompleted: Boolean(val) });
  };

  const tools = useTools();

  const btnClick = async () => {
    try {
      const _res = await wallet.createTmpKeyringWithPrivateKey(contextData.wif, AddressType.P2TR);
      if (_res.accounts.length == 0) {
        throw new Error(t('invalid_privatekey'));
      }
    } catch (e) {
      tools.toastError((e as Error).message);
      return;
    }
    updateContextData({
      tabType: TabType.CHOOSE_ADDRESS_TYPE
    });
  };

  return (
    <Column gap="lg">
      <Text text={t('private_key')} preset="sub" />

      <Input
        placeholder={t('wif_private_key_or_hex_private_key')}
        value={contextData.wif}
        onKeyUp={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if ('Enter' == e.key) {
            btnClick();
          }
        }}
        onChange={onChange}
        autoFocus={true}
        data-testid="private-key-input"
      />
      <FooterButtonContainer>
        <Button
          disabled={disabled}
          text={t('continue')}
          preset="primary"
          onClick={btnClick}
          data-testid="private-key-continue-button"
        />
      </FooterButtonContainer>
    </Column>
  );
}

function Step2({
  contextData,
  updateContextData
}: {
  contextData: ContextData;
  updateContextData: (params: UpdateContextDataParams) => void;
}) {
  const wallet = useWallet();
  const tools = useTools();
  const { t } = useI18n();

  const hdPathOptions = useMemo(() => {
    return ADDRESS_TYPES.filter((v) => {
      if (v.displayIndex < 0) {
        return false;
      }
      if (v.isUnisatLegacy) {
        return false;
      }
      return true;
    })
      .sort((a, b) => a.displayIndex - b.displayIndex)
      .map((v) => {
        return {
          label: v.name,
          hdPath: v.hdPath,
          addressType: v.value,
          isUnisatLegacy: v.isUnisatLegacy
        };
      });
  }, []);

  const [previewAddresses, setPreviewAddresses] = useState<string[]>(hdPathOptions.map(() => ''));

  const [addressAssets, setAddressAssets] = useState<{
    [key: string]: { total_btc: string; satoshis: number; total_inscription: number };
  }>({});

  const selfRef = useRef({
    maxSatoshis: 0,
    recommended: 0,
    count: 0,
    addressBalances: {}
  });
  const self = selfRef.current;
  const wifCompression = useMemo(() => getWifCompression(contextData.wif), [contextData.wif]);

  const addressCandidates = useMemo(
    () =>
      hdPathOptions.flatMap((option) => {
        if (option.addressType === AddressType.P2PKH) {
          if (wifCompression === false) {
            return [
              {
                ...option,
                compressed: false,
                unsupported: true,
                label: `${option.label} (${t('not_supported')})`
              },
              {
                ...option,
                compressed: true,
                unsupported: false,
                label: `${option.label} (compressed)`
              }
            ];
          }

          return [{ ...option, compressed: true, unsupported: false, label: option.label }];
        }

        return [
          {
            ...option,
            compressed: true,
            unsupported: false,
            label: option.label
          }
        ];
      }),
    [hdPathOptions, t, wifCompression]
  );

  const run = async () => {
    const addresses: string[] = [];
    self.maxSatoshis = 0;
    self.recommended = Math.max(
      0,
      addressCandidates.findIndex((candidate) => !candidate.unsupported)
    );
    self.addressBalances = {};
    for (let i = 0; i < addressCandidates.length; i++) {
      const options = addressCandidates[i];
      const keyring = await wallet.createTmpKeyringWithPrivateKey(
        contextData.wif,
        options.addressType,
        options.compressed
      );
      const address = keyring.accounts[0].address;
      addresses.push(address);
    }

    const balances = await wallet.getMultiAddressAssets(addresses.join(','));
    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i];
      const balance = balances[i];
      const satoshis = balance.totalSatoshis;
      self.addressBalances[address] = {
        total_btc: satoshisToAmount(balance.totalSatoshis),
        satoshis,
        total_inscription: balance.inscriptionCount
      };
      if (!addressCandidates[i].unsupported && satoshis > self.maxSatoshis) {
        self.maxSatoshis = satoshis;
        self.recommended = i;
      }

      const recommended = addressCandidates[self.recommended];
      updateContextData({
        addressType: recommended.addressType,
        compressed: recommended.compressed
      });
      setAddressAssets(self.addressBalances);
    }
    setPreviewAddresses(addresses);
  };
  useEffect(() => {
    run();
  }, [addressCandidates, contextData.wif]);

  const pathIndex = useMemo(() => {
    return addressCandidates.findIndex(
      (candidate) =>
        candidate.addressType === contextData.addressType && candidate.compressed === contextData.compressed
    );
  }, [addressCandidates, contextData.addressType, contextData.compressed]);

  const navigate = useNavigate();
  const selectedCandidate = addressCandidates[pathIndex];

  const onNext = async () => {
    if (!selectedCandidate || selectedCandidate.unsupported) {
      return;
    }
    try {
      await wallet.createKeyringWithPrivateKey(
        contextData.wif,
        contextData.addressType,
        undefined,
        contextData.compressed
      );
      updateContextData({ wif: '', step1CreateWordsCompleted: false });
      navigate('MainScreen');
    } catch (e) {
      tools.toastError((e as any).message);
    }
  };
  return (
    <Column gap="lg">
      <Text text={t('address_type')} preset="sub" />
      {addressCandidates.map((item, index) => {
        const address = previewAddresses[index];
        const assets = addressAssets[address] || {
          total_btc: '--',
          satoshis: 0,
          total_inscription: 0
        };
        const hasVault = assets.satoshis > 0;
        if (item.isUnisatLegacy && !hasVault) {
          return null;
        }
        return (
          <AddressTypeCard
            key={index}
            label={item.label}
            address={address}
            assets={assets}
            checked={index == pathIndex && !item.unsupported}
            disabled={item.unsupported}
            onClick={
              item.unsupported
                ? undefined
                : () => {
                    updateContextData({ addressType: item.addressType, compressed: item.compressed });
                  }
            }
            data-testid={`address-type-card-${index}`}
          />
        );
      })}

      <FooterButtonContainer>
        <Button
          disabled={!selectedCandidate || selectedCandidate.unsupported}
          text={t('continue')}
          preset="primary"
          onClick={onNext}
          data-testid="private-key-address-type-continue-button"
        />
      </FooterButtonContainer>
    </Column>
  );
}

interface ContextData {
  wif: string;
  addressType: AddressType;
  compressed?: boolean;
  step1CreateWordsCompleted: boolean;
  tabType: TabType;
}

interface UpdateContextDataParams {
  wif?: string;
  addressType?: AddressType;
  compressed?: boolean;
  step1CreateWordsCompleted?: boolean;
  tabType?: TabType;
}

export default function CreateSimpleWalletScreen() {
  const [contextData, setContextData] = useState<ContextData>({
    wif: '',
    addressType: AddressType.P2WPKH,
    compressed: true,
    step1CreateWordsCompleted: false,
    tabType: TabType.IMPORT_WORDS
  });
  const { t } = useI18n();
  const navigate = useNavigate();
  const updateContextData = useCallback(
    (params: UpdateContextDataParams) => {
      setContextData(Object.assign({}, contextData, params));
    },
    [contextData, setContextData]
  );
  const clearSensitiveState = useCallback(() => {
    setContextData((current) => ({
      ...current,
      wif: '',
      step1CreateWordsCompleted: false
    }));
  }, []);

  useEffect(() => {
    const handleLocked = () => {
      clearSensitiveState();
      navigate('WelcomeScreen');
    };

    uiEventBus.addEventListener(BUS_METHODS.LOCKED, handleLocked);
    return () => {
      uiEventBus.removeEventListener(BUS_METHODS.LOCKED, handleLocked);
    };
  }, [clearSensitiveState, navigate]);

  const items = [
    {
      key: TabType.IMPORT_WORDS,
      label: t('private_key'),
      children: <Step1 contextData={contextData} updateContextData={updateContextData} />
    },
    {
      key: TabType.CHOOSE_ADDRESS_TYPE,
      label: t('address_type'),
      children: <Step2 contextData={contextData} updateContextData={updateContextData} />
    }
  ];

  const renderChildren = items.find((v) => v.key == contextData.tabType)?.children;

  return (
    <Layout>
      <Header
        onBack={() => {
          clearSensitiveState();
          window.history.go(-1);
        }}
        title={t('create_single_wallet')}
      />
      <Content>
        <Row justifyCenter>
          <TabBar
            preset="number-step"
            progressEnabled
            numberStepList={items.map((v) => v.label)}
            defaultActiveKey={TabType.IMPORT_WORDS}
            activeKey={contextData.tabType}
            items={items.map((v, index) => ({
              key: v.key,
              label: `${index + 1}`
            }))}
            onTabClick={(key) => {
              const toTabType = key as TabType;
              if (toTabType === TabType.CHOOSE_ADDRESS_TYPE) {
                if (!contextData.step1CreateWordsCompleted) {
                  setTimeout(() => {
                    updateContextData({ tabType: contextData.tabType });
                  }, 200);
                  return;
                }
              }
              updateContextData({ tabType: toTabType });
            }}
          />
        </Row>

        {renderChildren}
      </Content>
    </Layout>
  );
}
