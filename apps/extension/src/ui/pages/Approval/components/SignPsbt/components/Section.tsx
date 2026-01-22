import { Column, Row, Text } from '@/ui/components';
import React from 'react';

export function SignPsbtSection({
  title,
  children,
  extra
}: {
  title: string;
  children?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <Column gap="sm">
      <Row justifyBetween>
        <Text text={title} size="md" my="sm" />
        {extra}
      </Row>
      {children}
    </Column>
  );
}
