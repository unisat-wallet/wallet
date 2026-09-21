import React, { CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button, Column, Icon, Image, Row, Text } from '@/ui/components';
import { RefreshButton } from '@/ui/components/RefreshButton';
import { RgbFeatureActivationModal } from '@/ui/pages/RGB/components/RgbFeatureActivationModal';
import {
  WalletView,
  uiActions,
  useAppDispatch,
  useBalanceCardDetailExpanded,
  useChain,
  useI18n,
  useRGBListLogic,
  useRGBUsdtBalanceCardLogic,
  useSupportedAssets,
  useToggleBalanceCardDetailExpanded,
  useTools,
  useWallet,
  useWalletView
} from '@unisat/wallet-state';
import { ChainType } from '@unisat/wallet-types';

import { useNavigate } from '../../../MainRoute';
import { BalanceCard } from './BalanceCard';

/** Adjacent card peek + gap. Peek is intentionally tighter than Figma's ~40px so the active card reads wider. */
const CARD_GAP = 12;
const CARD_PEEK = 24;
const SWIPE_THRESHOLD = 50;
const DRAG_START_THRESHOLD = 10;
const EXPANDED_CARD_MIN_HEIGHT = 180;
const COLLAPSED_CARD_MIN_HEIGHT = 118;

const carouselContainerStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  overflow: 'hidden'
};

const carouselTrackStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: CARD_GAP,
  transition: 'transform 0.35s ease-out',
  touchAction: 'pan-y pinch-zoom',
  willChange: 'transform',
  userSelect: 'none'
};

const rgbBadgeStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 4px',
  borderRadius: 4,
  backgroundColor: '#65ddb7'
};

function UsdtAmountDisplay({
  mainPart,
  subPart,
  hideBalance
}: {
  mainPart: string;
  subPart: string;
  hideBalance?: boolean;
}) {
  if (hideBalance) {
    return (
      <Row itemsEnd gap="zero">
        <Text
          text="****"
          preset="title-bold"
          style={{
            fontSize: 28,
            color: '#000'
          }}
        />
        <Text
          text="USDT"
          preset="title-bold"
          style={{
            fontSize: 18,
            color: '#000',
            marginLeft: 4,
            marginBottom: 2
          }}
        />
      </Row>
    );
  }

  return (
    <Row itemsEnd gap="zero">
      <Text text={mainPart} preset="title-bold" style={{ fontSize: 28, color: '#000' }} />
      {subPart ? (
        <Text
          text={subPart}
          preset="title-bold"
          style={{
            fontSize: 18,
            color: 'rgba(0, 0, 0, 0.45)',
            marginBottom: 2
          }}
        />
      ) : null}
      <Text
        text="USDT"
        preset="title-bold"
        style={{
          fontSize: 18,
          color: '#000',
          marginLeft: 4,
          marginBottom: 2
        }}
      />
    </Row>
  );
}

function RGBUsdtBalanceCard({
  isDetailExpanded,
  onExpandToggle,
  suppressClickRef,
  rgbList
}: {
  isDetailExpanded: boolean;
  onExpandToggle: () => void;
  suppressClickRef: React.MutableRefObject<boolean>;
  rgbList: ReturnType<typeof useRGBListLogic>;
}) {
  const {
    mainPart,
    subPart,
    usdValue,
    isBalanceHidden,
    handleHiddenToggle,
    refreshBalance,
    chain
  } = useRGBUsdtBalanceCardLogic(rgbList);

  const stopCardToggle = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  return (
    <Column
      fullX
      style={{
        background: 'linear-gradient(131deg, #4ee8b8 1.38%, #2bb7ac 47.46%, #147a5a 94.19%)',
        borderRadius: 16,
        padding: '12px 12px 16px',
        position: 'relative',
        overflow: 'hidden',
        minHeight: isDetailExpanded ? EXPANDED_CARD_MIN_HEIGHT : COLLAPSED_CARD_MIN_HEIGHT,
        height: '100%',
        boxSizing: 'border-box',
        justifyContent: 'space-between'
      }}
      onClick={(event) => {
        if (suppressClickRef.current) {
          return;
        }
        if (isCardActionTarget(event.target)) {
          return;
        }
        onExpandToggle();
      }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          borderRadius: 16,
          zIndex: 0
        }}>
        <img
          src="./images/icons/artifacts/balance-bg-rgb-lines.png"
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            maxWidth: 'none',
            objectFit: 'cover',
            opacity: 0.03
          }}
        />
      </div>
      <Image
        src="./images/icons/protocol/usdt.png"
        size={65}
        style={{ position: 'absolute', top: 0, right: 8, opacity: 0.35, pointerEvents: 'none', zIndex: 1 }}
      />

      <Column style={{ flex: 1, position: 'relative', zIndex: 1 }} gap="md">
        <Row itemsCenter gap="md">
          <Row itemsCenter gap="sm">
            <Text size="sm" text="USDT" style={{ color: 'rgba(0,0,0,0.55)', fontWeight: 600 }} />
            <div style={rgbBadgeStyle}>
              <Icon icon="rgb" size={14} />
              <Text text="RGB" size="xs" style={{ color: 'rgba(0,0,0,0.55)', fontWeight: 600 }} />
            </div>
          </Row>
          <div data-card-action="true">
            <Row itemsCenter gap="sm">
              <Row
                style={{ padding: 6, margin: -6, cursor: 'pointer' }}
                onClick={(event) => {
                  stopCardToggle(event);
                  handleHiddenToggle();
                }}>
                <Icon color="black_muted" icon={isBalanceHidden ? 'balance-eyes-closed' : 'balance-eyes'} size={20} />
              </Row>
              <RefreshButton onClick={refreshBalance as any} hideText />
            </Row>
          </div>
        </Row>

        <Row itemsCenter>
          <UsdtAmountDisplay mainPart={mainPart} subPart={subPart} hideBalance={isBalanceHidden} />
          <Icon color="black_muted" size={16} icon={isDetailExpanded ? 'up' : 'down'} />
        </Row>

        {chain.showPrice ? (
          <Text
            text={isBalanceHidden ? '****' : `$${usdValue}`}
            style={{ color: 'rgba(0,0,0,0.45)', fontSize: 14, fontWeight: 600, letterSpacing: 0.28 }}
          />
        ) : null}
      </Column>

    </Column>
  );
}

function RGBAssetsBalanceCard({
  isDetailExpanded,
  onExpandToggle,
  suppressClickRef,
  rgbList
}: {
  isDetailExpanded: boolean;
  onExpandToggle: () => void;
  suppressClickRef: React.MutableRefObject<boolean>;
  rgbList: ReturnType<typeof useRGBListLogic>;
}) {
  const {
    assetCount,
    isBalanceHidden,
    handleHiddenToggle,
    refreshBalance,
    t
  } = useRGBUsdtBalanceCardLogic(rgbList);

  const stopCardToggle = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  return (
    <Column
      fullX
      style={{
        background: 'linear-gradient(131deg, #7467E8 1.38%, #584AC7 47.46%, #342E80 94.19%)',
        borderRadius: 16,
        padding: '12px 12px 16px',
        position: 'relative',
        overflow: 'hidden',
        minHeight: isDetailExpanded ? EXPANDED_CARD_MIN_HEIGHT : COLLAPSED_CARD_MIN_HEIGHT,
        height: '100%',
        boxSizing: 'border-box',
        justifyContent: 'space-between'
      }}
      onClick={(event) => {
        if (suppressClickRef.current || isCardActionTarget(event.target)) return;
        onExpandToggle();
      }}>
      <Column style={{ flex: 1, position: 'relative', zIndex: 1 }} gap="md">
        <Row itemsCenter justifyBetween gap="sm">
          <Row itemsCenter gap="sm">
            <Text size="sm" text={t('rgb_assets')} style={{ color: 'rgba(255,255,255,0.72)', fontWeight: 600 }} />
            <div style={{ ...rgbBadgeStyle, backgroundColor: 'rgba(255,255,255,0.16)' }}>
              <Icon icon="rgb" size={14} color="white" />
              <Text text="RGB" size="xs" style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 600 }} />
            </div>
          </Row>
          <div data-card-action="true">
            <Row itemsCenter gap="sm">
              <Row
                style={{ padding: 6, margin: -6, cursor: 'pointer' }}
                onClick={(event) => {
                  stopCardToggle(event);
                  handleHiddenToggle();
                }}>
                <Icon color="white" icon={isBalanceHidden ? 'balance-eyes-closed' : 'balance-eyes'} size={20} />
              </Row>
              <RefreshButton onClick={refreshBalance as any} hideText iconColor="rgba(255,255,255,0.8)" />
            </Row>
          </div>
        </Row>

        <Row itemsCenter>
          <Row itemsCenter>
            <Text
              text={isBalanceHidden ? '****' : String(assetCount)}
              preset="title-bold"
              style={{ fontSize: 28, color: '#fff' }}
            />
            <Text
              text={t('assets')}
              preset="title-bold"
              style={{ fontSize: 18, color: 'rgba(255,255,255,0.72)', marginLeft: 4, marginBottom: 2 }}
            />
          </Row>

          <Icon color="white" size={16} icon={isDetailExpanded ? 'up' : 'down'} />
        </Row>
      </Column>

    </Column>
  );
}

function UnsupportedRGBBalanceCard({
  suppressClickRef,
  onSwitchWallet,
  generic = false
}: {
  suppressClickRef: React.MutableRefObject<boolean>;
  onSwitchWallet: () => void;
  generic?: boolean;
}) {
  const { t } = useI18n();

  return (
    <Column
      fullX
      style={{
        background: generic
          ? 'linear-gradient(131deg, #7467E8 1.38%, #584AC7 47.46%, #342E80 94.19%)'
          : 'linear-gradient(131deg, #4ee8b8 1.38%, #2bb7ac 47.46%, #147a5a 94.19%)',
        borderRadius: 16,
        padding: 12,
        position: 'relative',
        overflow: 'hidden',
        minHeight: COLLAPSED_CARD_MIN_HEIGHT,
        height: '100%',
        boxSizing: 'border-box',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 0,
        cursor: 'pointer'
      }}
      onClick={() => {
        if (suppressClickRef.current) return;
        onSwitchWallet();
      }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          borderRadius: 16,
          zIndex: 0
        }}>
        <img
          src="./images/icons/artifacts/balance-bg-rgb-lines.png"
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            maxWidth: 'none',
            objectFit: 'cover',
            opacity: 0.03
          }}
        />
      </div>
      {generic ? (
        <Icon
          icon="rgb"
          color="white"
          size={72}
          style={{ position: 'absolute', top: -2, right: 8, opacity: 0.18, pointerEvents: 'none', zIndex: 1 }}
        />
      ) : (
        <Image
          src="./images/icons/protocol/usdt.png"
          size={65}
          style={{ position: 'absolute', top: 0, right: 8, opacity: 0.35, pointerEvents: 'none', zIndex: 1 }}
        />
      )}

      <Row itemsCenter gap="sm" style={{ position: 'absolute', top: 12, left: 12, zIndex: 1 }}>
        <Text
          size="sm"
          text={generic ? t('rgb_assets') : 'USDT'}
          style={{ color: generic ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.55)', fontWeight: 600 }}
        />
        <div style={{ ...rgbBadgeStyle, ...(generic ? { backgroundColor: 'rgba(255,255,255,0.16)' } : {}) }}>
          <Icon icon="rgb" size={14} color={generic ? 'white' : undefined} />
          <Text
            text="RGB"
            size="xs"
            style={{ color: generic ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.55)', fontWeight: 600 }}
          />
        </div>
      </Row>

      {/* Centered in the full card bounds (header/watermark are absolute overlays). */}
      <Column
        itemsCenter
        justifyCenter
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          gap: 4,
          pointerEvents: 'none',
          // Optical nudge: true geometric center reads a bit high under the USDT/RGB header.
          transform: 'translateY(8px)'
        }}>
        <Text
          text={t('not_supported_in_this_wallet')}
          textCenter
          style={{
            color: generic ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.45)',
            fontSize: 13,
            fontWeight: 600,
            lineHeight: '20px'
          }}
        />
        <Row itemsCenter style={{ pointerEvents: 'auto', gap: 6 }}>
          <Text
            text={t('switch_to_hd_wallet')}
            style={{
              color: generic ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.65)',
              fontSize: 13,
              fontWeight: 600,
              lineHeight: '20px'
            }}
          />
          {generic ? (
            <Icon icon="right" color="white" size={11} />
          ) : (
            <img
              src="./images/icons/nav/right-sm.svg"
              alt=""
              width={6}
              height={11}
              style={{ display: 'block', flexShrink: 0 }}
            />
          )}
        </Row>
      </Column>
    </Column>
  );
}

function InactiveRGBBalanceCard({
  suppressClickRef,
  onEnable
}: {
  suppressClickRef: React.MutableRefObject<boolean>;
  onEnable: () => void;
}) {
  const { t } = useI18n();
  return (
    <Column
      fullX
      style={{
        background: 'linear-gradient(131deg, #7467E8 1.38%, #584AC7 47.46%, #342E80 94.19%)',
        borderRadius: 16,
        padding: 12,
        position: 'relative',
        overflow: 'hidden',
        minHeight: COLLAPSED_CARD_MIN_HEIGHT,
        height: '100%',
        boxSizing: 'border-box',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8
      }}
      onClick={(event) => {
        if (suppressClickRef.current) return;
        event.stopPropagation();
        onEnable();
      }}>
      <Icon
        icon="rgb"
        color="white"
        size={72}
        style={{ position: 'absolute', top: -2, right: 8, opacity: 0.18, pointerEvents: 'none' }}
      />
      <Row itemsCenter gap="sm" style={{ position: 'absolute', top: 12, left: 12 }}>
        <Text text={t('rgb_assets')} size="sm" style={{ color: 'rgba(255,255,255,0.72)', fontWeight: 600 }} />
        <div style={{ ...rgbBadgeStyle, backgroundColor: 'rgba(255,255,255,0.16)' }}>
          <Icon icon="rgb" size={14} color="white" />
          <Text text="RGB" size="xs" style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 600 }} />
        </div>
      </Row>
      <Text text="Enable RGB to manage RGB assets" textCenter size="sm" style={{ color: 'rgba(255,255,255,0.78)', fontWeight: 600 }} />
      <div onClick={(event) => event.stopPropagation()}>
        <Button text="Enable RGB" preset="primary" onClick={onEnable} />
      </div>
    </Column>
  );
}

function isCardActionTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('[data-card-action]'));
}

function useSwipeCarousel(activeIndex: number, onIndexChange: (index: number) => void, snapStride: number) {
  const pointerStartXRef = useRef(0);
  const pointerStartYRef = useRef(0);
  const pointerDeltaXRef = useRef(0);
  const isPointerDownRef = useRef(false);
  const isDraggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);

  const resetDrag = useCallback(() => {
    isPointerDownRef.current = false;
    isDraggingRef.current = false;
    activePointerIdRef.current = null;
    pointerDeltaXRef.current = 0;
    setDragOffset(0);
  }, []);

  const commitSwipe = useCallback(() => {
    const delta = pointerDeltaXRef.current;
    const didDrag = isDraggingRef.current;
    resetDrag();

    if (!didDrag) return;

    // Swallow only the synthetic click that follows this drag gesture.
    // Auto-clear so the next intentional tap (eye / expand) is not blocked.
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    if (delta < -SWIPE_THRESHOLD && activeIndex === 0) {
      onIndexChange(1);
      return;
    }
    if (delta > SWIPE_THRESHOLD && activeIndex === 1) {
      onIndexChange(0);
    }
  }, [activeIndex, onIndexChange, resetDrag]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isCardActionTarget(event.target)) return;

    pointerStartXRef.current = event.clientX;
    pointerStartYRef.current = event.clientY;
    pointerDeltaXRef.current = 0;
    isPointerDownRef.current = true;
    isDraggingRef.current = false;
    activePointerIdRef.current = event.pointerId;
    setDragOffset(0);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current || activePointerIdRef.current !== event.pointerId) return;

    const deltaX = event.clientX - pointerStartXRef.current;
    const deltaY = event.clientY - pointerStartYRef.current;
    pointerDeltaXRef.current = deltaX;

    if (!isDraggingRef.current) {
      if (Math.abs(deltaX) < DRAG_START_THRESHOLD) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        resetDrag();
        return;
      }
      isDraggingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const maxDrag = snapStride || 0;
    if (activeIndex === 0 && deltaX > 0) {
      setDragOffset(Math.min(deltaX * 0.2, 24));
      return;
    }
    if (activeIndex === 1 && deltaX < 0) {
      setDragOffset(Math.max(deltaX * 0.2, -24));
      return;
    }

    const clamped = Math.max(-maxDrag, Math.min(maxDrag, deltaX));
    setDragOffset(clamped);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    commitSwipe();
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resetDrag();
  };

  return {
    dragOffset,
    suppressClickRef,
    carouselHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel
    }
  };
}

function SyncedBalanceCard({
  isDetailExpanded,
  suppressClickRef
}: {
  isDetailExpanded: boolean;
  suppressClickRef: React.MutableRefObject<boolean>;
}) {
  return (
    <div
      style={{
        minHeight: isDetailExpanded ? EXPANDED_CARD_MIN_HEIGHT : COLLAPSED_CARD_MIN_HEIGHT,
        height: '100%',
        width: '100%'
      }}
      onClickCapture={(event) => {
        if (!suppressClickRef.current) return;
        // Never block eye / refresh / unlock — only the post-drag ghost click on the card body.
        if (isCardActionTarget(event.target)) return;
        event.stopPropagation();
        event.preventDefault();
      }}>
      <BalanceCard />
    </div>
  );
}

export function BalanceCardCarousel({
  rgbList,
  rgbFeatureEnabled,
  onRgbFeatureEnabled
}: {
  rgbList: ReturnType<typeof useRGBListLogic>;
  rgbFeatureEnabled: boolean;
  onRgbFeatureEnabled: () => void;
}) {
  const supportedAssets = useSupportedAssets();
  const chain = useChain();
  const walletView = useWalletView();
  const dispatch = useAppDispatch();
  const wallet = useWallet();
  const tools = useTools();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [unsupportedPreviewIndex, setUnsupportedPreviewIndex] = useState(0);
  const [activationOpen, setActivationOpen] = useState(false);
  const [activationLoading, setActivationLoading] = useState(false);
  // Avoid animating from BTC → USDT when remounting after navigation back.
  const [enableTransition, setEnableTransition] = useState(false);

  const isDetailExpanded = useBalanceCardDetailExpanded();
  const toggleDetailExpanded = useToggleBalanceCardDetailExpanded();

  const isRgbFullySupported = supportedAssets.assets.rgb;
  // Preserve a previously selected RGB view while the feature status is being
  // restored asynchronously after returning to the wallet tab.
  const isRgbFeatureActive = isRgbFullySupported && (rgbFeatureEnabled || walletView === WalletView.RGB);
  const canShowRgbCard = supportedAssets.assets.rgbCard;
  const isUnsupportedRgbCard = canShowRgbCard && !isRgbFullySupported;
  const isInactiveRgbCard = canShowRgbCard && isRgbFullySupported && !rgbFeatureEnabled;
  const useGenericRgbCard = chain.enum !== ChainType.BITCOIN_MAINNET;
  const activeIndex = isRgbFeatureActive ? (walletView === WalletView.RGB ? 1 : 0) : unsupportedPreviewIndex;

  const setActiveIndex = useCallback(
    (index: number) => {
      if (isRgbFeatureActive) {
        dispatch(uiActions.setWalletView(index === 1 ? WalletView.RGB : WalletView.BITCOIN));
        return;
      }
      // Single / non-HD wallets keep BTC actions + asset list while previewing the USDT card.
      setUnsupportedPreviewIndex(index);
    },
    [dispatch, isRgbFeatureActive]
  );

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const updateWidth = () => setContainerWidth(el.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [canShowRgbCard]);

  useLayoutEffect(() => {
    if (containerWidth <= 0) {
      setEnableTransition(false);
      return undefined;
    }

    // Paint the correct snap offset first, then allow swipe transitions.
    const frameId = requestAnimationFrame(() => {
      setEnableTransition(true);
    });
    return () => cancelAnimationFrame(frameId);
  }, [containerWidth]);

  const slideWidth = containerWidth > 0 ? Math.max(containerWidth - CARD_GAP - CARD_PEEK, 0) : 0;
  const snapStride = slideWidth > 0 ? slideWidth - CARD_PEEK : 0;
  const slideFlex = slideWidth > 0 ? `0 0 ${slideWidth}px` : `0 0 calc(100% - ${CARD_GAP + CARD_PEEK}px)`;
  const { dragOffset, suppressClickRef, carouselHandlers } = useSwipeCarousel(activeIndex, setActiveIndex, snapStride);

  // Network changes can toggle this component between the single BTC card
  // and the carousel. Keep these hooks above that conditional render so the
  // hook order remains stable across the transition.
  const handlePeekCardClickCapture = useCallback(
    (index: number) => (event: React.MouseEvent) => {
      // Active card keeps expand/collapse; peek card switches like a swipe.
      if (index === activeIndex) return;
      if (suppressClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(index);
    },
    [activeIndex, setActiveIndex, suppressClickRef]
  );

  const onSwitchWallet = useCallback(() => {
    navigate('SwitchKeyringScreen');
  }, [navigate]);

  const onEnableRgb = useCallback(async () => {
    setActivationLoading(true);
    try {
      await wallet.enableRgbFeature();
      setActivationOpen(false);
      onRgbFeatureEnabled();
    } catch (error) {
      tools.toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setActivationLoading(false);
    }
  }, [onRgbFeatureEnabled, tools, wallet]);

  useEffect(() => {
    if (!canShowRgbCard) {
      setUnsupportedPreviewIndex(0);
    }
  }, [canShowRgbCard]);

  if (!canShowRgbCard) {
    return <BalanceCard />;
  }

  const snapOffset = activeIndex === 0 ? 0 : snapStride;
  const translateX = containerWidth > 0 ? -(snapOffset - dragOffset) : 0;

  return (
    <>
      <div ref={containerRef} style={carouselContainerStyle}>
      <div
        style={{
          ...carouselTrackStyle,
          transform: `translateX(${translateX}px)`,
          cursor: dragOffset !== 0 ? 'grabbing' : 'grab',
          // Skip transition until width is measured so remounting on USDT does not animate BTC → USDT.
          transition: !enableTransition || dragOffset !== 0 ? 'none' : carouselTrackStyle.transition,
          visibility: containerWidth > 0 ? 'visible' : 'hidden'
        }}
        {...carouselHandlers}>
        <div
          style={{
            flex: slideFlex,
            width: slideWidth || undefined,
            minWidth: 0,
            display: 'flex',
            cursor: activeIndex === 0 ? undefined : 'pointer'
          }}
          onClickCapture={handlePeekCardClickCapture(0)}>
          <SyncedBalanceCard isDetailExpanded={isDetailExpanded} suppressClickRef={suppressClickRef} />
        </div>
        <div
          style={{
            flex: slideFlex,
            width: slideWidth || undefined,
            minWidth: 0,
            display: 'flex',
            cursor: activeIndex === 1 ? undefined : 'pointer'
          }}
          onClickCapture={handlePeekCardClickCapture(1)}>
          {isInactiveRgbCard ? (
            <InactiveRGBBalanceCard
              suppressClickRef={suppressClickRef}
              onEnable={() => setActivationOpen(true)}
            />
          ) : isUnsupportedRgbCard ? (
            <UnsupportedRGBBalanceCard
              suppressClickRef={suppressClickRef}
              onSwitchWallet={onSwitchWallet}
              generic={useGenericRgbCard}
            />
          ) : useGenericRgbCard ? (
            <RGBAssetsBalanceCard
              isDetailExpanded={isDetailExpanded}
              onExpandToggle={toggleDetailExpanded}
              suppressClickRef={suppressClickRef}
              rgbList={rgbList}
            />
          ) : (
            <RGBUsdtBalanceCard
              isDetailExpanded={isDetailExpanded}
              onExpandToggle={toggleDetailExpanded}
              suppressClickRef={suppressClickRef}
              rgbList={rgbList}
            />
          )}
        </div>
      </div>
      </div>
      {activationOpen ? (
        <RgbFeatureActivationModal
          loading={activationLoading}
          onClose={() => setActivationOpen(false)}
          onEnable={() => void onEnableRgb()}
        />
      ) : null}
    </>
  );
}
