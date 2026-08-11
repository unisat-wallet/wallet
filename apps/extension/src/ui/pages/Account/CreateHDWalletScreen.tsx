import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Content, Header, Layout, Row } from '@/ui/components';
import { TabBar } from '@/ui/components/TabBar';
import { Step_ChooseAddressType } from '@/ui/pages/Account/createHDWalletComponents/Step_ChooseAddressType';
import { Step_ChooseRestoreWallet } from '@/ui/pages/Account/createHDWalletComponents/Step_ChooseRestoreWallet';
import { Step_CreateWords } from '@/ui/pages/Account/createHDWalletComponents/Step_CreateWords';
import { Step_ImportWords } from '@/ui/pages/Account/createHDWalletComponents/Step_ImportWords';
import { Step_VerifyWords } from '@/ui/pages/Account/createHDWalletComponents/Step_VerifyWords';
import { ContextData, TabType, UpdateContextDataParams } from '@/ui/pages/Account/createHDWalletComponents/types';
import { BUS_METHODS, RestoreWalletType, WordsType } from '@unisat/wallet-shared';
import { uiEventBus, useI18n, useWallet } from '@unisat/wallet-state';
import { AddressType } from '@unisat/wallet-types';

import { useNavigate } from '../MainRoute';

export default function CreateHDWalletScreen() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { state } = useLocation();
  const { isImport = false, fromUnlock = false } = (state ?? {}) as {
    isImport?: boolean;
    fromUnlock?: boolean;
  };

  const [contextData, setContextData] = useState<ContextData>({
    mnemonics: '',
    hdPath: '',
    passphrase: '',
    walletName: '',
    addressType: AddressType.P2WPKH,
    step1CreateWordsCompleted: false,
    mnemonicVerified: false,
    tabType: isImport ? TabType.CHOOSE_RESTORE_WALLET : TabType.CREATE_WORDS,
    restoreWalletType: RestoreWalletType.UNISAT,
    isRestore: isImport,
    isCustom: false,
    customHdPath: '',
    addressTypeIndex: 0,
    wordsType: WordsType.WORDS_24
  });

  const updateContextData = useCallback(
    (params: UpdateContextDataParams) => {
      setContextData((previous) => Object.assign({}, previous, params));
    },
    [setContextData]
  );

  const wallet = useWallet();
  const clearSensitiveState = useCallback(() => {
    setContextData((current) => ({
      ...current,
      mnemonics: '',
      passphrase: '',
      walletName: '',
      mnemonicVerified: false,
      step1CreateWordsCompleted: false
    }));
    wallet.removePreMnemonics();
  }, [wallet]);

  // When importing the wallet, the lock time should be extended, at least more than 10 minutes. Keep alive by emitInteractedEvent
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        wallet.setLastActiveTime();
      } catch (e) {
        // ignore
      }
    }, 10 * 1000); // Trigger every 10 seconds

    const timeout = setTimeout(
      () => {
        clearInterval(interval);
      },
      10 * 60 * 1000
    );

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    return () => {
      // Generated phrases are only needed until the HD keyring is persisted.
      wallet.removePreMnemonics();
    };
  }, [wallet]);

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

  const items = useMemo(() => {
    if (contextData.isRestore) {
      if (contextData.restoreWalletType === RestoreWalletType.OW) {
        return [
          {
            key: TabType.CHOOSE_RESTORE_WALLET,
            label: t('choose_wallet'),
            children: <Step_ChooseRestoreWallet contextData={contextData} updateContextData={updateContextData} />
          },
          {
            key: TabType.IMPORT_WORDS,
            label: t('seed_phrase'),
            children: <Step_ImportWords contextData={contextData} updateContextData={updateContextData} />
          }
        ];
      } else {
        return [
          {
            key: TabType.CHOOSE_RESTORE_WALLET,
            label: t('choose_wallet'),
            children: <Step_ChooseRestoreWallet contextData={contextData} updateContextData={updateContextData} />
          },
          {
            key: TabType.IMPORT_WORDS,
            label: t('seed_phrase'),
            children: <Step_ImportWords contextData={contextData} updateContextData={updateContextData} />
          },
          {
            key: TabType.CHOOSE_ADDRESS_TYPE,
            label: t('address_type'),
            children: (
              <Step_ChooseAddressType
                contextData={contextData}
                updateContextData={updateContextData}
                clearSensitiveState={clearSensitiveState}
              />
            )
          }
        ];
      }
    } else {
      return [
        {
          key: TabType.CREATE_WORDS,
          label: t('seed_phrase'),
          children: <Step_CreateWords contextData={contextData} updateContextData={updateContextData} />
        },
        {
          key: TabType.CONFIRM_WORDS,
          label: t('verify_seed_phrase'),
          children: <Step_VerifyWords contextData={contextData} updateContextData={updateContextData} />
        },
        {
          key: TabType.CHOOSE_ADDRESS_TYPE,
          label: t('address_type'),
          children: (
            <Step_ChooseAddressType
              contextData={contextData}
              updateContextData={updateContextData}
              clearSensitiveState={clearSensitiveState}
            />
          )
        }
      ];
    }
  }, [clearSensitiveState, contextData, updateContextData]);

  const currentChildren = useMemo(() => {
    const item = items.find((v) => v.key === contextData.tabType);
    return item?.children;
  }, [items, contextData.tabType]);

  return (
    <Layout>
      <Header
        onBack={() => {
          clearSensitiveState();
          if (fromUnlock) {
            navigate('WelcomeScreen');
          } else {
            window.history.go(-1);
          }
        }}
        title={contextData.isRestore ? t('restore_from_mnemonics') : t('create_a_new_hd_wallet')}
      />
      <Content>
        <Row justifyCenter>
          <TabBar
            preset="number-step"
            progressEnabled
            numberStepList={items.map((v) => v.label)}
            defaultActiveKey={contextData.tabType}
            activeKey={contextData.tabType}
            items={items.map((v, index) => ({
              key: v.key,
              label: `${index + 1}`
            }))}
            onTabClick={(key) => {
              const toTabType = key as TabType;
              if (!contextData.isRestore && contextData.mnemonicVerified && toTabType !== TabType.CHOOSE_ADDRESS_TYPE) {
                return;
              }
              if (toTabType === TabType.CONFIRM_WORDS && !contextData.step1CreateWordsCompleted) {
                return;
              }
              if (toTabType === TabType.CHOOSE_ADDRESS_TYPE) {
                if (!contextData.mnemonicVerified) {
                  return;
                }
              }
              updateContextData({ tabType: toTabType });
            }}
          />
        </Row>

        {currentChildren}
      </Content>
    </Layout>
  );
}
