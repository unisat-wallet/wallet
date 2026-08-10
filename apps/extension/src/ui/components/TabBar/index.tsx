/* eslint-disable indent */
import { useState } from 'react';

import { colors } from '@/ui/theme/colors';

import { Column } from '../Column';
import { Icon } from '../Icon';
import { Row } from '../Row';
import { Text } from '../Text';
import './index.less';

interface TabProps {
  key: string | number;
  label: string;
  hidden?: boolean;
}

interface TabBarProps {
  defaultActiveKey?: string | number;
  activeKey?: string | number;
  items: TabProps[];
  onTabClick: (string) => void;
  progressEnabled?: boolean;
  preset?: 'number-page' | 'number-step' | 'default' | 'style1' | 'style2' | 'style3';
  numberStepList?: string[];
}

export function TabBar(props: TabBarProps) {
  const { items, defaultActiveKey, activeKey, onTabClick, progressEnabled, preset, numberStepList } = props;
  const [uncontrolledTabKey, setUncontrolledTabKey] = useState(defaultActiveKey);
  const tabKey = activeKey ?? uncontrolledTabKey;
  const progress = items.findIndex((v) => v.key === tabKey);

  const selectTab = (key: string | number) => {
    if (activeKey === undefined) {
      setUncontrolledTabKey(key);
    }
    onTabClick(key as string);
  };

  if (preset == 'number-page') {
    return (
      <Row>
        {items.map((v) => {
          const isSelected = v.key === tabKey;
          const reach = isSelected; //index <= (tabKey as number);
          return (
            <Column
              key={v.key}
              style={Object.assign(
                { width: 20, height: 20 },
                reach
                  ? {
                      backgroundColor: colors.gold
                    }
                  : {
                      backgroundColor: colors.bg2
                    }
              )}
              justifyCenter
              itemsCenter
              onClick={() => {
                selectTab(v.key);
              }}
            >
              <Text text={v.label} color={'white'} />
            </Column>
          );
        })}
      </Row>
    );
  }

  if (preset == 'number-step') {
    return (
      <Row gap="zero" style={{ paddingBottom: numberStepList ? 35 : 0 }}>
        {items.map((v, index) => {
          const isCurrent = index === progress;
          const isCompleted = index < progress;
          const stepLabel = numberStepList?.[index];

          return (
            <Row key={v.key} gap="zero" itemsCenter>
              <Column itemsCenter style={{ width: 64, position: 'relative', flexShrink: 0 }}>
                <Column
                  justifyCenter
                  itemsCenter
                  onClick={() => {
                    selectTab(v.key);
                  }}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    boxSizing: 'border-box',
                    borderWidth: isCurrent ? 6 : 1,
                    borderColor: isCurrent ? 'rgba(255, 255, 255, 0.2)' : colors.light,
                    background: isCurrent ? 'linear-gradient(135deg, #EBB94C 0%, #E97E00 100%)' : 'transparent',
                    backgroundClip: isCurrent ? 'padding-box' : undefined
                  }}
                  data-testid={`number-step-${v.key}`}
                >
                  {isCompleted ? (
                    <Icon icon="check" size={16} color="white" />
                  ) : (
                    <Text text={v.label} color={isCurrent ? 'white' : 'textDim'} />
                  )}
                </Column>
                {stepLabel && (
                  <Text
                    text={stepLabel}
                    size="xxs"
                    textCenter
                    color={isCurrent ? 'white' : 'textDim'}
                    style={{ position: 'absolute', width: 64, top: 45, left: 0 }}
                  />
                )}
              </Column>

              {index < items.length - 1 && (
                <Column
                  style={{
                    width: 30,
                    height: 1,
                    flexShrink: 0,
                    backgroundColor: isCurrent ? colors.gold : colors.light
                  }}
                />
              )}
            </Row>
          );
        })}
      </Row>
    );
  }

  if (preset == 'style1') {
    return (
      <Row gap={'xl'} style={{ borderBottomWidth: 1, paddingBottom: 0, borderColor: colors.border }}>
        {items.map((v, index) => {
          const isSelected = v.key === tabKey;
          if (progressEnabled && index > progress) {
            return (
              <Column key={v.key}>
                <Text text={v.label} color={'textDim'} />
              </Column>
            );
          } else {
            return (
              <Column
                key={v.key}
                itemsCenter
                onClick={() => {
                  selectTab(v.key);
                }}
              >
                <Text
                  text={v.label}
                  size={'md'}
                  preset={isSelected ? 'bold' : 'regular'}
                  color={isSelected ? 'gold' : 'textDim'}
                />
                <Row
                  style={{
                    width: 40,
                    height: 2,
                    backgroundColor: isSelected ? 'gold' : 'transparent'
                  }}
                />
              </Column>
            );
          }
        })}
      </Row>
    );
  }

  // tabbar
  if (preset == 'style2') {
    return (
      <Row>
        {items.map((v, index) => {
          if (v.hidden) return null;
          const isSelected = v.key === tabKey;
          if (progressEnabled && index > progress) {
            return (
              <Column key={v.key}>
                <Text text={v.label} color={'textDim'} />
              </Column>
            );
          } else {
            return (
              <Column
                key={v.key}
                itemsCenter
                justifyCenter
                px="lg"
                style={{
                  height: 32,
                  borderRadius: 16,
                  borderWidth: 0,
                  backgroundColor: isSelected ? '#322D1F' : 'rgba(255, 255, 255, 0.08)'
                }}
                onClick={() => {
                  selectTab(v.key);
                }}
              >
                <Text text={v.label} size="xs" color={isSelected ? 'gold' : 'white_muted'} />
              </Column>
            );
          }
        })}
      </Row>
    );
  }

  if (preset == 'style3') {
    return (
      <Row gap="lg">
        {items.map((v) => {
          const isSelected = v.key === tabKey;
          return (
            <Column
              key={v.key}
              onClick={() => {
                selectTab(v.key);
              }}
            >
              <Text text={v.label} color={isSelected ? 'white' : 'textDim'} />
            </Column>
          );
        })}
      </Row>
    );
  }
  return (
    <Row>
      {items.map((v, index) => {
        const isSelected = v.key === tabKey;
        if (progressEnabled && index > progress) {
          return (
            <Column key={v.key}>
              <Text text={v.label} color={'textDim'} />
            </Column>
          );
        } else {
          return (
            <Column
              key={v.key}
              classname={isSelected ? 'selected-tab' : ''}
              onClick={() => {
                selectTab(v.key);
              }}
            >
              <Text text={v.label} color={isSelected ? 'gold' : 'white'} />
            </Column>
          );
        }
      })}
    </Row>
  );
}
