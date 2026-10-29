import { type ReactNode, useState } from 'react';
import { Buffer } from 'buffer';

import { Button, Card, Column, Content, Footer, Header, Icon, Layout, Row, Text } from '@/ui/components';
import { CopyableAddress } from '@/ui/components/CopyableAddress';
import WebsiteBar from '@/ui/components/WebsiteBar';
import KeystoneSignScreen from '@/ui/pages/Wallet/KeystoneSignScreen';
import { KeyringType, KeystoneSignEnum } from '@unisat/keyring-service/types';
import { useApproval, useCurrentAccount, useI18n, useWallet } from '@unisat/wallet-state';
import type { CosmosDirectSignSummary } from '@unisat/babylon-service';

interface Props {
  params: {
    method: 'cosmos_signDirect' | 'cosmos_signArbitrary' | 'cosmosSignDirect' | 'cosmosSignArbitrary';
    data: {
      chainId: string;
      signerAddress: string;
      signDoc?: any;
      data?: any;
      dataType?: string;
      signBytesHex: string;
      summary?: CosmosDirectSignSummary;
    };
    session: {
      origin: string;
      icon: string;
      name: string;
    };
  };
  origin?: string;
  requestDefer?: any;
  previewOnly?: boolean;
  previewNotice?: string;
  onPreviewClose?: () => void;
}

export default function CosmosSign({
  params: { method, data, session },
  previewOnly,
  previewNotice,
  onPreviewClose
}: Props) {
  const { resolveApproval, rejectApproval } = useApproval();
  const account = useCurrentAccount();
  const [isKeystoneSigning, setIsKeystoneSigning] = useState(false);
  const { t } = useI18n();

  const isKeystone = account.type === KeyringType.KeystoneKeyring;

  const wallet = useWallet();

  const isDirect = method === 'cosmos_signDirect' || method === 'cosmosSignDirect';
  const isArbitrary = method === 'cosmos_signArbitrary' || method === 'cosmosSignArbitrary';
  const isSupportedMethod = isDirect || isArbitrary;
  const hasVerifiedDisplayData = !isDirect || Boolean(data.summary);
  const canSign = isSupportedMethod && hasVerifiedDisplayData;
  const keystoneSignType = isDirect ? KeystoneSignEnum.COSMOS_DIRECT : KeystoneSignEnum.COSMOS_ARBITRARY;

  const handleCancel = () => {
    if (previewOnly) {
      onPreviewClose?.();
      return;
    }
    rejectApproval();
  };

  const handleConfirm = async () => {
    if (!isSupportedMethod) return;
    if (isKeystone) {
      setIsKeystoneSigning(true);
    } else if (isDirect) {
      const result = await wallet.cosmosSignDirect({
        chainId: data.chainId,
        signerAddress: data.signerAddress,
        signDoc: data.signDoc
      });
      resolveApproval(result);
    } else {
      const result = await wallet.cosmosSignArbitrary({
        chainId: data.chainId,
        signerAddress: data.signerAddress,
        dataType: data.dataType || '',
        data: data.data
      });
      resolveApproval(result);
    }
  };

  if (isKeystoneSigning) {
    return (
      <KeystoneSignScreen
        type={keystoneSignType}
        data={data.signBytesHex}
        onSuccess={(result) => {
          resolveApproval(result);
          setIsKeystoneSigning(false);
        }}
        onBack={() => {
          setIsKeystoneSigning(false);
        }}
      />
    );
  }

  return (
    <Layout>
      <Header>
        <WebsiteBar session={session} />
      </Header>
      <Content>
        <Column mt="lg" gap="md">
          <Text text={t('cosmos_sign_request')} preset="title-bold" textCenter />
          <Text
            text={
              isDirect
                ? 'Review the decoded transaction before signing.'
                : 'Review the message this site wants you to sign.'
            }
            preset="sub"
            textCenter
          />

          <Card style={{ display: 'block' }}>
            <Row justifyBetween itemsCenter gap="md" fullX>
              <Row itemsCenter gap="md" style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    flex: '0 0 44px',
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(235, 185, 76, 0.14)'
                  }}>
                  <Icon icon="baby" size={28} />
                </div>
                <Column gap="xs" style={{ minWidth: 0 }}>
                  <Text text={isDirect ? 'Cosmos transaction' : 'ADR-36 message'} preset="bold" />
                  <Text text={data.chainId} size="xs" color="textDim" style={{ wordBreak: 'break-all' }} />
                </Column>
              </Row>
              <div
                style={{
                  padding: '6px 9px',
                  borderRadius: 8,
                  flex: '0 0 auto',
                  background: isDirect ? 'rgba(235, 185, 76, 0.14)' : 'rgba(255,255,255,0.08)'
                }}>
                <Text text={isDirect ? 'DIRECT' : 'ADR-36'} size="xxs" color={isDirect ? 'gold' : 'textDim'} />
              </div>
            </Row>
          </Card>

          {previewOnly && previewNotice && <CosmosNotice text={previewNotice} />}
          {!isSupportedMethod && (
            <CosmosNotice text="Unsupported Cosmos signing method. Signing is disabled." danger />
          )}
          {isDirect && !data.summary && (
            <CosmosNotice text="Verified transaction details are unavailable. Signing is disabled." danger />
          )}

          {isDirect && data.summary ? <CosmosDirectDetails summary={data.summary} /> : null}
          {isArbitrary ? <CosmosArbitraryDetails data={data} /> : null}

          <Card style={{ display: 'block', background: 'rgba(255,255,255,0.04)' }}>
            <Row itemsCenter gap="sm">
              <Icon icon="warning" color="warning" size={17} />
              <Text
                text={t('only_sign_if_you_fully_understand_the_content_and_')}
                size="xs"
                color="textDim"
                style={{ flex: 1, lineHeight: '17px' }}
              />
            </Row>
          </Card>
        </Column>
      </Content>

      <Footer>
        {previewOnly ? (
          <Button text="Back to Test Screen" full preset="primary" onClick={handleCancel} />
        ) : (
          <Row full>
            <Button text={t('reject')} full preset="default" onClick={handleCancel} />
            <Button text={t('sign')} full preset="primary" disabled={!canSign} onClick={handleConfirm} />
          </Row>
        )}
      </Footer>
    </Layout>
  );
}

function CosmosDirectDetails({ summary }: { summary: CosmosDirectSignSummary }) {
  return (
    <>
      {summary.messages.map((message, index) => (
        <Card key={`${message.type}-${index}`} style={{ display: 'block' }}>
          <Column gap="md" fullX>
            <Row justifyBetween itemsCenter gap="md" fullX>
              <Column gap="xs" style={{ minWidth: 0 }}>
                <Text text={getCosmosMessageTitle(message)} size="sm" color="textDim" />
                {message.amounts?.length ? (
                  <Text text={formatCosmosAmounts(message.amounts)} size="xl" preset="title-bold" />
                ) : (
                  <Text text={getCosmosMessageHeadline(message)} preset="bold" />
                )}
              </Column>
              <Icon icon={message.recipient ? 'send' : 'baby-staking'} size={26} />
            </Row>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.10)' }} />
            {message.signer ? <CosmosAddressRow label="From" address={message.signer} /> : null}
            {message.recipient ? <CosmosAddressRow label="To" address={message.recipient} /> : null}
            {message.validator ? <CosmosAddressRow label="Validator" address={message.validator} /> : null}
            {message.sourceValidator ? (
              <CosmosAddressRow label="Source validator" address={message.sourceValidator} />
            ) : null}
            {message.destinationValidator ? (
              <CosmosAddressRow label="Destination validator" address={message.destinationValidator} />
            ) : null}
            {message.rewardType ? <CosmosDetailRow label="Reward type" value={message.rewardType} /> : null}
            {message.withdrawAddress ? (
              <CosmosAddressRow label="New reward address" address={message.withdrawAddress} />
            ) : null}
            {message.creationHeight ? (
              <CosmosDetailRow label="Original unbonding height" value={message.creationHeight} />
            ) : null}
            <CosmosDetailRow label="Message type" value={message.type} />
          </Column>
        </Card>
      ))}

      <Card style={{ display: 'block' }}>
        <Column gap="md" fullX>
          <Text text="Transaction details" preset="bold" />
          <CosmosDetailRow label="Chain ID" value={summary.chainId} />
          <CosmosDetailRow label="Account number" value={summary.accountNumber} />
          <CosmosDetailRow label="Sequence" value={summary.sequence} />
          <CosmosDetailRow
            label="Network fee"
            value={summary.fee.amounts.length ? formatCosmosAmounts(summary.fee.amounts) : 'No fee'}
          />
          <CosmosDetailRow label="Gas limit" value={summary.fee.gasLimit} />
          <CosmosDetailRow
            label="Timeout height"
            value={summary.timeoutHeight === '0' ? 'None' : summary.timeoutHeight}
          />
          {summary.fee.payer ? <CosmosAddressRow label="Fee payer" address={summary.fee.payer} /> : null}
          {summary.fee.granter ? <CosmosAddressRow label="Fee granter" address={summary.fee.granter} /> : null}
          <CosmosDetailRow label="Memo" value={summary.memo || 'None'} />
        </Column>
      </Card>
    </>
  );
}

function CosmosArbitraryDetails({
  data
}: {
  data: Props['params']['data'];
}) {
  const display = decodeCosmosArbitraryDisplay(data);
  return (
    <>
      {display.warning ? <CosmosNotice text={display.warning} danger /> : null}
      <Card style={{ display: 'block' }}>
        <Column gap="md" fullX>
          <Row itemsCenter gap="sm">
            <Icon icon="singer-info" color="gold" size={20} />
            <Text text="Message to sign" preset="bold" />
          </Row>
          {display.isBinary ? (
            <>
              {display.utf8Text !== undefined ? (
                <Column gap="xs" fullX>
                  <Text text="UTF-8" size="xs" color="textDim" />
                  <CosmosMessageBlock text={display.utf8Text || '(empty message)'} />
                </Column>
              ) : null}
              <Column gap="xs" fullX>
                <Text text="Hex" size="xs" color="textDim" />
                <CosmosMessageBlock text={display.hex || '0x'} />
              </Column>
            </>
          ) : (
            <CosmosMessageBlock text={display.text} />
          )}
        </Column>
      </Card>
      <Card style={{ display: 'block' }}>
        <Column gap="md" fullX>
          <Text text="Signing details" preset="bold" />
          <CosmosDetailRow label="Chain ID" value={data.chainId} />
          <CosmosAddressRow label="Signer" address={data.signerAddress} />
          <CosmosDetailRow label="Format" value="ADR-36 (domain-separated)" />
          <CosmosDetailRow label="Data encoding" value={data.dataType || 'Unknown'} />
          {display.isBinary ? <CosmosDetailRow label="Byte length" value={String(display.byteLength)} /> : null}
        </Column>
      </Card>
    </>
  );
}

function CosmosMessageBlock({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        background: 'rgba(255,255,255,0.05)',
        userSelect: 'text',
        maxHeight: 220,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: '20px'
      }}>
      {text}
    </div>
  );
}

function decodeCosmosArbitraryDisplay(data: Props['params']['data']): {
  isBinary: boolean;
  text: string;
  utf8Text?: string;
  hex?: string;
  byteLength?: number;
  warning?: string;
} {
  if (data.dataType !== 'Uint8Array') {
    return {
      isBinary: false,
      text: data.data === '' || data.data === undefined ? '(empty message)' : String(data.data)
    };
  }

  if (typeof data.data !== 'string') {
    return {
      isBinary: true,
      text: '',
      hex: '',
      byteLength: 0,
      warning: 'This binary message could not be decoded. Do not sign unless you can verify the exact data.'
    };
  }

  const bytes = Buffer.from(data.data, 'base64');
  if (bytes.toString('base64') !== data.data) {
    return {
      isBinary: true,
      text: '',
      hex: '',
      byteLength: bytes.length,
      warning: 'This binary message has invalid Base64 encoding. Signing is unsafe.'
    };
  }

  const hex = `0x${bytes.toString('hex')}`;
  try {
    const utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const containsInvisibleControls = hasInvisibleOrControlCharacters(utf8Text);
    return {
      isBinary: true,
      text: '',
      utf8Text,
      hex,
      byteLength: bytes.length,
      warning: containsInvisibleControls
        ? 'This binary message contains invisible or control characters. Verify the Hex data before signing.'
        : undefined
    };
  } catch {
    return {
      isBinary: true,
      text: '',
      hex,
      byteLength: bytes.length,
      warning: 'This binary message is not valid UTF-8 and cannot be interpreted as readable text. Verify the Hex data before signing.'
    };
  }
}

function hasInvisibleOrControlCharacters(text: string) {
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      (codePoint >= 0x00 && codePoint <= 0x08) ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2060 && codePoint <= 0x206f) ||
      codePoint === 0xfeff
    ) {
      return true;
    }
  }
  return false;
}

function CosmosAddressRow({ label, address }: { label: string; address: string }) {
  return <CosmosDetailRow label={label} value={<CopyableAddress address={address} copyPosition="after" len={10} />} />;
}

function CosmosDetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Row justifyBetween itemsCenter gap="md" fullX>
      <Text text={label} size="xs" color="textDim" />
      {typeof value === 'string' ? (
        <Text
          text={value}
          size="sm"
          preset="bold"
          style={{ maxWidth: '68%', textAlign: 'right', wordBreak: 'break-word' }}
        />
      ) : (
        value
      )}
    </Row>
  );
}

function CosmosNotice({ text, danger }: { text: string; danger?: boolean }) {
  return (
    <Card
      style={{
        display: 'block',
        padding: 12,
        background: danger ? 'rgba(237, 51, 75, 0.12)' : 'rgba(235, 185, 76, 0.10)'
      }}>
      <Row itemsCenter gap="sm">
        <Icon icon="warning" color={danger ? 'red' : 'warning'} size={18} />
        <Text
          text={text}
          size="xs"
          color={danger ? 'red' : 'warning'}
          style={{ flex: 1, lineHeight: '17px' }}
        />
      </Row>
    </Card>
  );
}

function formatCosmosAmounts(amounts: Array<{ amount: string; denom: string }>) {
  return amounts.map((amount) => `${amount.amount} ${amount.denom}`).join(' + ');
}

function getCosmosMessageHeadline(message: CosmosDirectSignSummary['messages'][number]) {
  switch (message.type) {
    case '/babylon.incentive.MsgWithdrawReward':
    case '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward':
      return 'All available rewards';
    case '/babylon.incentive.MsgSetWithdrawAddress':
      return 'No token transfer';
    default:
      return 'No token amount';
  }
}

function getCosmosMessageTitle(message: CosmosDirectSignSummary['messages'][number]) {
  if (
    message.type === '/cosmos.bank.v1beta1.MsgSend' &&
    message.signer &&
    message.recipient &&
    message.signer === message.recipient
  ) {
    return 'Self transfer';
  }

  switch (message.type) {
    case '/cosmos.bank.v1beta1.MsgSend':
      return 'Send tokens';
    case '/cosmos.staking.v1beta1.MsgDelegate':
    case '/babylon.epoching.v1.MsgWrappedDelegate':
      return 'Delegate tokens';
    case '/cosmos.staking.v1beta1.MsgUndelegate':
    case '/babylon.epoching.v1.MsgWrappedUndelegate':
      return 'Undelegate tokens';
    case '/cosmos.staking.v1beta1.MsgBeginRedelegate':
    case '/babylon.epoching.v1.MsgWrappedBeginRedelegate':
      return 'Redelegate tokens';
    case '/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation':
    case '/babylon.epoching.v1.MsgWrappedCancelUnbondingDelegation':
      return 'Cancel unbonding';
    case '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward':
      return 'Withdraw staking rewards';
    case '/babylon.incentive.MsgWithdrawReward':
      return 'Claim Babylon rewards';
    case '/babylon.incentive.MsgSetWithdrawAddress':
      return 'Change reward address';
    default:
      return 'Cosmos message';
  }
}
