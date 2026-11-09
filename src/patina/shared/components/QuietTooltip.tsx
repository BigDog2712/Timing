import {
  useCallback,
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type QuietTooltipPlacement = "top" | "right" | "bottom" | "left";

interface Props {
  children: ReactElement<{ "aria-describedby"?: string }>;
  label?: ReactNode | null;
  placement?: QuietTooltipPlacement;
  disabled?: boolean;
  className?: string;
  tooltipClassName?: string;
  style?: CSSProperties;
  hideOnPointerDown?: boolean;
}

interface TooltipPosition {
  top: number;
  left: number;
}

const TOOLTIP_GAP = 8;
const VIEWPORT_PADDING = 8;
const POINTER_SHOW_DELAY_MS = 300;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolvePlacement(
  anchorRect: DOMRect,
  tooltipWidth: number,
  tooltipHeight: number,
  preferredPlacement: QuietTooltipPlacement,
) {
  const availableTop = anchorRect.top;
  const availableRight = window.innerWidth - anchorRect.right;
  const availableBottom = window.innerHeight - anchorRect.bottom;
  const availableLeft = anchorRect.left;

  if (preferredPlacement === "top" && availableTop < tooltipHeight + TOOLTIP_GAP && availableBottom > availableTop) {
    return "bottom";
  }

  if (
    preferredPlacement === "bottom"
    && availableBottom < tooltipHeight + TOOLTIP_GAP
    && availableTop > availableBottom
  ) {
    return "top";
  }

  if (preferredPlacement === "right" && availableRight < tooltipWidth + TOOLTIP_GAP && availableLeft > availableRight) {
    return "left";
  }

  if (preferredPlacement === "left" && availableLeft < tooltipWidth + TOOLTIP_GAP && availableRight > availableLeft) {
    return "right";
  }

  return preferredPlacement;
}

function resolvePosition(
  anchorRect: DOMRect,
  tooltipWidth: number,
  tooltipHeight: number,
  placement: QuietTooltipPlacement,
): TooltipPosition {
  const resolvedPlacement = resolvePlacement(anchorRect, tooltipWidth, tooltipHeight, placement);
  let top = anchorRect.top + (anchorRect.height - tooltipHeight) / 2;
  let left = anchorRect.left + (anchorRect.width - tooltipWidth) / 2;

  if (resolvedPlacement === "top") {
    top = anchorRect.top - tooltipHeight - TOOLTIP_GAP;
  } else if (resolvedPlacement === "right") {
    left = anchorRect.right + TOOLTIP_GAP;
  } else if (resolvedPlacement === "bottom") {
    top = anchorRect.bottom + TOOLTIP_GAP;
  } else {
    left = anchorRect.left - tooltipWidth - TOOLTIP_GAP;
  }

  return {
    top: clamp(top, VIEWPORT_PADDING, window.innerHeight - tooltipHeight - VIEWPORT_PADDING),
    left: clamp(left, VIEWPORT_PADDING, window.innerWidth - tooltipWidth - VIEWPORT_PADDING),
  };
}

export default function QuietTooltip({
  children,
  label,
  placement = "top",
  disabled = false,
  className,
  tooltipClassName,
  style,
  hideOnPointerDown = true,
}: Props) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const suppressFocusTooltipRef = useRef(false);
  const pointerShowTimerRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const tooltipId = useId();
  const canShow = Boolean(label) && !disabled;
  const childAriaDescribedBy = children.props["aria-describedby"];
  const describedChild = cloneElement(children, {
    "aria-describedby": visible && canShow
      ? [childAriaDescribedBy, tooltipId].filter(Boolean).join(" ")
      : childAriaDescribedBy,
  });

  const clearPointerShowTimer = useCallback(() => {
    if (pointerShowTimerRef.current !== null) {
      window.clearTimeout(pointerShowTimerRef.current);
      pointerShowTimerRef.current = null;
    }
  }, []);

  const hideTooltip = useCallback(() => {
    clearPointerShowTimer();
    setVisible(false);
    setPosition(null);
  }, [clearPointerShowTimer]);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    setPosition(resolvePosition(anchorRect, tooltipRect.width, tooltipRect.height, placement));
  }, [placement]);

  useLayoutEffect(() => {
    if (!visible || !canShow) {
      return undefined;
    }

    updatePosition();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(updatePosition);
    if (anchorRef.current) resizeObserver.observe(anchorRef.current);
    if (tooltipRef.current) resizeObserver.observe(tooltipRef.current);
    return () => resizeObserver.disconnect();
  }, [canShow, updatePosition, visible]);

  useEffect(() => {
    if (!canShow && visible) {
      hideTooltip();
    }
  }, [canShow, hideTooltip, visible]);

  useEffect(() => clearPointerShowTimer, [clearPointerShowTimer]);

  useEffect(() => {
    if (!visible || !canShow) {
      return undefined;
    }

    const handleViewportChange = () => updatePosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [canShow, updatePosition, visible]);

  const showTooltip = () => {
    clearPointerShowTimer();
    if (canShow && !suppressFocusTooltipRef.current) {
      setVisible(true);
    }
  };

  const showTooltipFromPointer = () => {
    suppressFocusTooltipRef.current = false;
    clearPointerShowTimer();
    if (canShow) {
      pointerShowTimerRef.current = window.setTimeout(() => {
        pointerShowTimerRef.current = null;
        setVisible(true);
      }, POINTER_SHOW_DELAY_MS);
    }
  };

  const hideTooltipAfterPointerDown = () => {
    suppressFocusTooltipRef.current = true;
    hideTooltip();
  };

  const hideTooltipAfterBlur = () => {
    suppressFocusTooltipRef.current = false;
    hideTooltip();
  };

  const hideTooltipAfterPointerLeave = () => {
    suppressFocusTooltipRef.current = false;
    hideTooltip();
  };

  const hideTooltipFromKeyboard = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "Escape" || !visible) return;
    event.preventDefault();
    event.stopPropagation();
    hideTooltip();
  };

  return (
    <>
      <span
        ref={anchorRef}
        className={`qp-tooltip-anchor ${className ?? ""}`.trim()}
        style={style}
        onFocus={showTooltip}
        onBlur={hideTooltipAfterBlur}
        onKeyDownCapture={hideTooltipFromKeyboard}
        onMouseEnter={showTooltipFromPointer}
        onMouseLeave={hideTooltipAfterPointerLeave}
        onPointerDownCapture={hideOnPointerDown ? hideTooltipAfterPointerDown : undefined}
        onClickCapture={hideOnPointerDown ? hideTooltipAfterPointerDown : undefined}
      >
        {describedChild}
      </span>

      {visible && canShow && typeof document !== "undefined" && createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className={`qp-tooltip ${tooltipClassName ?? ""}`.trim()}
          style={{
            top: position ? `${position.top}px` : 0,
            left: position ? `${position.left}px` : 0,
            visibility: position ? "visible" : "hidden",
          }}
        >
          {label}
        </div>,
        document.body,
      )}
    </>
  );
}
