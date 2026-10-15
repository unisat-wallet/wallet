import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { colors } from '@/ui/theme/colors';
import { spacing, spacingGap } from '@/ui/theme/spacing';

import { Column } from '../Column';
import { Row } from '../Row';
import { Text } from '../Text';
import './index.less';

interface TabItem {
  key: string;
  label: React.ReactNode;
  children: React.ReactNode;
}

interface TabsProps {
  defaultActiveKey: string;
  activeKey: string;
  items: TabItem[];
  preset?: string;
  tabBar?: React.ReactNode;
  trailingAction?: React.ReactNode;
  hideScrollbar?: boolean;
  scrollActiveIntoView?: boolean;
  contentGap?: number;
  onTabClick: (key: string) => void;
}

export function Tabs({ preset, items, defaultActiveKey, activeKey, onTabClick, trailingAction, hideScrollbar, scrollActiveIntoView, contentGap }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultActiveKey);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tabOrder = items.map((item) => item.key).join('|');

  const renderedTabs = useRef<Set<string>>(new Set([defaultActiveKey]));

  useEffect(() => {
    setActiveTab(activeKey);
    renderedTabs.current.add(activeKey);
  }, [activeKey]);

  useLayoutEffect(() => {
    if (!scrollActiveIntoView || preset === 'style2') return;
    const container = scrollContainerRef.current;
    const selected = Array.from(container?.children || []).find(
      (item) => item.getAttribute('data-testid') === `tab-item-${activeTab}`
    );
    if (!container || !selected) return;
    const viewport = container.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    if (tab.left < viewport.left) container.scrollLeft -= viewport.left - tab.left;
    if (tab.right > viewport.right) container.scrollLeft += tab.right - viewport.right;
  }, [activeTab, tabOrder, preset, scrollActiveIntoView]);

  const tabBar = useMemo(() => {
    if (preset == 'style2') {
      return (
        <Row
          style={{
            flexWrap: 'wrap',
            gap: 8,
            rowGap: 8,
            alignItems: 'flex-start'
          }}
        >
          {items.map((item) => {
            const isActiveItem = item.key === activeTab;

            return (
              <Column
                key={item.key}
                itemsCenter
                justifyCenter
                style={{
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 16,
                  boxSizing: 'border-box',
                  flexShrink: 0,
                  backgroundColor: isActiveItem ? '#322D1F' : 'rgba(255, 255, 255, 0.08)',
                  border: isActiveItem ? `1px solid ${colors.gold}` : '1px solid transparent',
                  cursor: 'pointer'
                }}
                onClick={() => onTabClick(item.key)}
                data-testid={`tab-item-${item.key}`}>
                {typeof item.label === 'string' ? (
                  <Text
                    text={item.label}
                    style={{
                      fontSize: 13,
                      color: isActiveItem ? colors.gold : 'rgba(255, 255, 255, 0.65)'
                    }}
                  />
                ) : (
                  item.label
                )}
              </Column>
            );
          })}
        </Row>
      );
    } else {
      const bleedStyle = {
        marginLeft: -spacing.medium,
        marginRight: -spacing.medium,
        width: `calc(100% + ${spacing.medium * 2}px)`,
        boxSizing: 'border-box' as const
      };

      return (
        <Column
          gap="zero"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            backgroundColor: '#070606',
            ...bleedStyle
          }}>
          <Row style={{ height: 50, gap: 0, alignItems: 'stretch' }}>
            <div
              ref={scrollContainerRef}
              className={hideScrollbar ? 'tabs-hidden-scrollbar' : undefined}
              style={{ display: 'flex', flex: 1, minWidth: 0, gap: spacing.medium, paddingLeft: spacing.medium, paddingRight: trailingAction ? 0 : spacing.medium, overflowX: 'auto', scrollbarWidth: hideScrollbar ? 'none' : undefined }}>
              {items.map((item) => {
                const isActiveItem = item.key === activeTab;
                return (
                  <Row key={item.key} style={{ flexShrink: 0 }} onClick={() => onTabClick(item.key)} data-testid={`tab-item-${item.key}`}>
                    <Column gap="zero" justifyCenter itemsCenter>
                      {typeof item.label === 'string' ? (
                        <Text text={item.label} color={isActiveItem ? 'gold' : 'textDim'} size="md" />
                      ) : (
                        item.label
                      )}
                      <Row
                        style={{
                          width: '100%',
                          borderBottomWidth: 2,
                          paddingBottom: 10,
                          borderColor: isActiveItem ? colors.gold : colors.transparent
                        }}
                      />
                    </Column>
                  </Row>
                );
              })}
            </div>
            {trailingAction ? <Row style={{ flexShrink: 0, alignItems: 'center', paddingLeft: 8, paddingRight: spacing.medium, backgroundColor: '#070606' }}>{trailingAction}</Row> : null}
          </Row>
          <div
            style={{
              height: 1,
              backgroundColor: colors.line,
              marginTop: -10,
              width: '100%'
            }}
          />
        </Column>
      );
    }
  }, [items, activeTab, onTabClick, preset, trailingAction, hideScrollbar]);

  return (
    <Column gap="zero">
      {/* Tab Bar */}
      {tabBar}

      {/* Content */}
      <Column style={{ marginTop: contentGap ?? (spacingGap.sm + spacingGap.md) }}>
        {items.map((item) => {
          if (!renderedTabs.current.has(item.key)) return null;

          const isActive = item.key === activeTab;

          return (
            <Column
              key={item.key}
              style={{
                position: isActive ? 'relative' : 'absolute',
                top: isActive ? 0 : -9999,
                zIndex: isActive ? 1 : 0,
                opacity: isActive ? 1 : 0,
                height: isActive ? 'auto' : 0,
                pointerEvents: isActive ? 'auto' : 'none'
              }}>
              {item.children}
            </Column>
          );
        })}
      </Column>
    </Column>
  );
}
