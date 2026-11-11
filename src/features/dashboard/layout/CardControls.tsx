/**
 * [A 批 · 0.12.x] 卡片工具条：一颗 ⋯ + 弹出菜单。
 *
 * 为什么从 6 颗图标收成 1 颗：20px 高的卡头里挤 6 个 12px 图标，hover 才显形 ——
 * 常隐只是把噪音藏起来，不是消除（读屏用户仍要全部 Tab 穿过去）。收敛后卡头右槽
 * = meta(读数在前) + ⋯(操作在后)，「看」与「动」各占一个位置。
 *
 * 菜单容器复用共享的 `QuietAnchoredPopover`（portal + 定位 + Esc/outside/scroll
 * 关闭），菜单项全部接既有回调（onMove/onTier/onToggleSpan/onRemove）——零新增
 * 业务 API。「移除卡片」**不用 danger 色**：它可逆（能从加卡目录加回），danger
 * 只留给不可逆动作。
 */
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { MoreHorizontal } from "lucide-react";
import QuietAnchoredPopover from "../../../shared/components/QuietAnchoredPopover.tsx";
import { COLS, type CardId, type CardTier } from "./contract";

interface Props {
  id: CardId;
  tier: CardTier;
  /** 当前占宽（格） */
  w: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  label: string;
  onMove: (direction: -1 | 1) => void;
  onTier: (tier: CardTier) => void;
  /** 设占宽（1..COLS），吸附整数格 */
  onWidth: (w: number) => void;
  onRemove: () => void;
}

/** 档位三段 radio 直接选 S/M/L。 */
const TIERS: readonly CardTier[] = ["S", "M", "L"];
const TIER_LABEL: Record<CardTier, string> = { S: "小", M: "中", L: "大" };
/** 占宽档位：1..COLS 格。 */
const WIDTHS: readonly number[] = Array.from({ length: COLS }, (_, i) => i + 1);

export default function CardControls({
  id,
  tier,
  w,
  canMoveUp,
  canMoveDown,
  label,
  onMove,
  onTier,
  onWidth,
  onRemove,
}: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  /* Esc 关闭后焦点必须回 ⋯：菜单 portal 到 body，不回去的话焦点掉到 body。 */
  const handleClose = (reason: "outside" | "escape" | "scroll") => {
    setOpen(false);
    if (reason === "escape") triggerRef.current?.focus();
  };

  /* QuietAnchoredPopover 只管 Tab 循环与 Esc；menu 语义要求的 ↑/↓ 在这里补。 */
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"], [role="menuitemcheckbox"]',
      ),
    );
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : items.length - 1;
    items[(at + step) % items.length]?.focus();
  };

  return (
    <span className="qp-card-controls" data-card-controls={id}>
      <button
        ref={triggerRef}
        type="button"
        className="qp-card-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${label} 布局菜单`}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      <QuietAnchoredPopover
        open={open}
        anchor={triggerRef.current}
        id={menuId}
        ariaLabel={`${label} 布局菜单`}
        onClose={handleClose}
        /* 右缘对齐：ratio=1 让面板右缘贴 ⋯ 右缘（否则出窗） */
        horizontalAlign="center"
        horizontalAnchorRatio={1}
      >
        <div role="menu" aria-label={`${label} 布局`} className="qp-card-menu" onKeyDown={onMenuKeyDown}>
          <button
            type="button"
            role="menuitem"
            className="qp-card-menu-item"
            aria-disabled={!canMoveUp || undefined}
            onClick={canMoveUp ? run(() => onMove(-1)) : undefined}
          >
            上移
          </button>
          <button
            type="button"
            role="menuitem"
            className="qp-card-menu-item"
            aria-disabled={!canMoveDown || undefined}
            onClick={canMoveDown ? run(() => onMove(1)) : undefined}
          >
            下移
          </button>
          <hr className="qp-card-menu-sep" />
          <div role="group" aria-label="卡片档位" className="qp-card-menu-tiers">
            {TIERS.map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={value === tier}
                className="qp-card-menu-item qp-card-menu-tier"
                onClick={run(() => onTier(value))}
              >
                {TIER_LABEL[value]}
              </button>
            ))}
          </div>
          <hr className="qp-card-menu-sep" />
          <div role="group" aria-label="卡片占宽" className="qp-card-menu-tiers">
            {WIDTHS.map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={value === w}
                className="qp-card-menu-item qp-card-menu-tier"
                onClick={run(() => onWidth(value))}
              >
                {value} 格
              </button>
            ))}
          </div>
          <hr className="qp-card-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="qp-card-menu-item"
            onClick={run(onRemove)}
          >
            移除卡片
          </button>
        </div>
      </QuietAnchoredPopover>
    </span>
  );
}
