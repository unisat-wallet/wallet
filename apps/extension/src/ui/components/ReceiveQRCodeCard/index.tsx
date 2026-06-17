import QRCode from 'qrcode.react';
import { ReactNode, useState } from 'react';

import { Column, Icon, Row, Text } from '@/ui/components';
import { sizes } from '@/ui/theme/spacing';
import { copyToClipboard } from '@/ui/utils';
import { useI18n, useTools } from '@unisat/wallet-state';

const GOLD = '#F4B62C';

type ReceiveQRCodeCardProps = {
  title?: string;
  description?: string;
  value: string;
  valueLabel: string;
  copyValue?: string;
  copyText?: string;
  copiedText?: string;
  qrIconSrc?: string;
  qrCenter?: ReactNode;
  accentColor?: string;
};

export function ReceiveQRCodeCard(props: ReceiveQRCodeCardProps) {
  const {
    title,
    description,
    value,
    valueLabel,
    copyValue = value,
    copyText,
    copiedText,
    qrIconSrc,
    qrCenter,
    accentColor = GOLD
  } = props;
  const [copied, setCopied] = useState(false);

  const tools = useTools();
  const { t } = useI18n();
  const resolvedCopyText = copyText || t('copy_to_clipboard');
  const resolvedCopiedText = copiedText || t('copied');
  const onCopy = async () => {
    if (!copyValue) return;
    await copyToClipboard(copyValue);
    tools.toastSuccess(t('copied'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Column
      gap="lg"
      itemsCenter
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: '18px 16px 16px',
        borderRadius: 14,
        border: `1px solid ${accentColor}55`,
        background: 'linear-gradient(135deg, rgba(48,37,16,0.72), rgba(17,11,4,0.92))'
      }}>
      {title || description ? (
        <Column itemsCenter gap="sm" fullX>
          {title ? <Text text={title} color="white" textCenter size="md" /> : null}
          {description ? <Text text={description} color="white_muted2" textCenter size="xs" /> : null}
        </Column>
      ) : null}

      <Column
        itemsCenter
        justifyCenter
        style={{
          marginTop: 12,
          width: sizes.qrcode + 20,
          height: sizes.qrcode + 20,
          background: '#fff',
          border: `4px solid ${accentColor}`,
          borderRadius: 12,
          boxSizing: 'border-box',
          alignSelf: 'center',
          position: 'relative'
        }}>
        <QRCode
          value={value || ''}
          renderAs="svg"
          size={sizes.qrcode}
          level="M"
          includeMargin={false}
          bgColor="#FFFFFF"
          fgColor="#000000"
          imageSettings={
            qrIconSrc
              ? {
                  src: qrIconSrc,
                  width: 30,
                  height: 30,
                  excavate: true
                }
              : undefined
          }
        />
        {qrCenter ? (
          <Column
            itemsCenter
            justifyCenter
            style={{
              position: 'absolute',
              width: 34,
              height: 34,
              borderRadius: '50%',
              overflow: 'hidden'
            }}>
            {qrCenter}
          </Column>
        ) : null}
      </Column>

      <Column
        itemsCenter
        style={{
          marginTop: 12,
          width: '100%',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 8,
          overflow: 'hidden'
        }}>
        <Column itemsCenter gap="sm" style={{ width: '100%', padding: '14px 12px' }}>
          <Text text={valueLabel} size="xs" color="white_muted" textCenter />
          <Text text={value} size="sm" color="white" textCenter wrap selectText />
        </Column>
        <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.12)' }} />
        <Row
          justifyCenter
          itemsCenter
          gap="sm"
          style={{ width: '100%', padding: '12px 0', color: accentColor, cursor: 'pointer' }}
          onClick={onCopy}>
          <Icon icon="copy" size={14} color="gold" />
          <Text text={copied ? resolvedCopiedText : resolvedCopyText} size="sm" style={{ color: accentColor }} />
        </Row>
      </Column>
    </Column>
  );
}
