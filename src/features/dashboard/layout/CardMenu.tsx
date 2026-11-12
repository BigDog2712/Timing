/**
 * [v3] 卡头 `⋯` 菜单：**改名 / 尺寸档 / 复制 / 移除**。
 *
 * 相比 v2 的 `CardControls`，去掉了「上移 / 下移」——自由摆位下「顺序」不再决定位置，
 * 那两个按钮会变成「点了界面不动」的死键；补上的是**标题**与**复制一份**：
 *   · 标题：同一种组件可以放多张，没有自定义名就只能靠位置认人；
 *   · 复制：摆好一张卡再要一张同款时，不用从「添加」重来一遍再拖到原位。
 *
 * 「移除」**不用 danger 色**：它可逆（能从添加里加回来），danger 只留给不可逆动作。
 */
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { MoreHorizontal } from "lucide-react";
import QuietAnchoredPopover from "../../../shared/components/QuietAnchoredPopover.tsx";
import type { BoardCopy } from "./boardCopy";
import type { CardTier } from "./contract";

const TIERS: readonly CardTier[] = ["S", "M", "L"];

interface Props {
  label: string;
  title: string;
  tier: CardTier;
  copy: BoardCopy;
  onTier: (tier: CardTier) => void;
  onRename: (title: string | null) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export default function CardMenu({
  label, title, tier, copy, onTier, onRename, onDuplicate, onRemove,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(title);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  const openMenu = () => {
    setDraft(title);
    setOpen(true);
  };

  const close = (reason: "outside" | "escape" | "scroll") => {
    setOpen(false);
    if (reason === "escape") triggerRef.current?.focus();
  };

  const commitTitle = () => {
    const next = draft.trim();
    onRename(next.length > 0 ? next : null);
  };

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  /* 菜单是 `role="menu"`：↑/↓ 必须在项间移动（QuietAnchoredPopover 只管 Tab 环与 Esc）。 */
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"], input',
      ),
    );
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : items.length - 1;
    items[(at + step) % items.length]?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="qp-card-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={copy.more(label)}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" />
      </button>

      <QuietAnchoredPopover
        open={open}
        anchor={triggerRef.current}
        id={menuId}
        ariaLabel={copy.more(label)}
        onClose={close}
      >
        <div className="qp-card-menu" role="menu" aria-label={copy.more(label)} onKeyDown={onMenuKeyDown}>
          <label className="qp-card-menu-field">
            <span className="qp-card-menu-label">{copy.rename}</span>
            <input
              className="qp-card-menu-input"
              value={draft}
              placeholder={copy.renamePlaceholder}
              maxLength={24}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitTitle();
                  setOpen(false);
                  triggerRef.current?.focus();
                }
                event.stopPropagation();
              }}
            />
          </label>

          <hr className="qp-card-menu-sep" />

          <div className="qp-card-menu-tiers" role="radiogroup" aria-label={copy.size}>
            {TIERS.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={item === tier}
                className="qp-card-menu-item qp-card-menu-tier"
                onClick={run(() => onTier(item))}
              >
                {copy.sizes[item]}
              </button>
            ))}
          </div>

          <hr className="qp-card-menu-sep" />

          <button type="button" role="menuitem" className="qp-card-menu-item" onClick={run(onDuplicate)}>
            {copy.duplicate}
          </button>
          <button type="button" role="menuitem" className="qp-card-menu-item" onClick={run(onRemove)}>
            {copy.remove}
          </button>
        </div>
      </QuietAnchoredPopover>
    </>
  );
}
