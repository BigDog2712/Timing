import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";

import type { QuickClassificationItemBinding } from "../types.ts";

/**
 * 快捷分类弹层里的第二栏：**「绑定事项」**（0.12.1 补回应用级交互）。
 *
 * 位置与形态刻意与「改分类」那一条的二级菜单同构（`quick-classification-menu` +
 * `quick-classification-category-menu`），因为它就是同一个弹层里的同一种东西：
 *   · 触发键是根菜单里的一个 `menuitem`（`aria-haspopup="menu"`）；
 *   · 二级菜单绝对定位在触发键右侧，放不下就翻到左侧（与分类子菜单同一套算法，
 *     常量也照抄 —— 那三个数是布局口径，不是巧合）。
 *
 * 三条边界：
 *   1. **只存配置**：选中就写一条 KV，然后关菜单回焦到触发键。不开始计时、
 *      不改追踪、不动记录（下一轮再说）。
 *   2. **清单读不到只降级这一栏**：菜单项照旧能点开，展开后显示一句
 *      「暂时读不到事项」，分类/改名两条路径完全不受影响。
 *   3. **保存失败必须说出来**：走 `onError`（弹层的 toast/内联提示由调用方决定），
 *      静默失败会让用户以为存上了。
 */
interface Props {
  binding: QuickClassificationItemBinding;
  /** 分类/改名正在保存时也把它按住，避免同一次交互里两条写路径并发 */
  disabled: boolean;
  onError: (message: string) => void;
}

const MENU_MARGIN = 12;
const SUBMENU_GAP = 2;
const OPTION_SELECTOR = "[role='menuitemradio']:not([disabled])";

export default function QuickClassificationItemBindingMenu({ binding, disabled, onError }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [position, setPosition] = useState({ left: MENU_MARGIN, top: MENU_MARGIN });
  const { items, loadFailed, labels, itemId } = binding;

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerBounds = trigger.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    const opensLeft = triggerBounds.right + SUBMENU_GAP + bounds.width + MENU_MARGIN > window.innerWidth;
    setPosition({
      left: opensLeft
        ? Math.max(MENU_MARGIN, triggerBounds.left - SUBMENU_GAP - bounds.width)
        : Math.min(window.innerWidth - bounds.width - MENU_MARGIN, triggerBounds.right + SUBMENU_GAP),
      top: Math.max(
        MENU_MARGIN,
        Math.min(triggerBounds.top, window.innerHeight - bounds.height - MENU_MARGIN),
      ),
    });
  }, [open, items.length, loadFailed]);

  /* 打开后把焦点送进清单：落在**当前选中**那一项上（未绑定时就是「不绑定」），
     这样连按两次 Enter 不会把绑定换到别的键上。清单为空时把焦点给菜单本体，
     否则 Esc 之后焦点会落回 body。 */
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const options = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(OPTION_SELECTOR) ?? []);
      if (!options.length) {
        menuRef.current?.focus();
        return;
      }
      const checkedIndex = options.findIndex((option) => option.getAttribute("aria-checked") === "true");
      options[checkedIndex >= 0 ? checkedIndex : 0]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const closeAndFocusTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const pick = async (nextItemId: number | null) => {
    if (savingRef.current) return;
    if (nextItemId === itemId) {
      closeAndFocusTrigger();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await binding.onSave(nextItemId);
      closeAndFocusTrigger();
    } catch {
      onErrorRef.current(labels.saveFailed);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    /* Esc / ← 只关这一层，别冒泡到根菜单（根菜单的 Esc 是「整层关掉」）。 */
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocusTrigger();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(OPTION_SELECTOR) ?? []);
    if (!options.length) return;
    const currentIndex = options.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : currentIndex < 0
          ? 0
          : (currentIndex + step + options.length) % options.length;
    options[nextIndex]?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="quick-classification-menu-item"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <span>{labels.entry}</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="quick-classification-menu quick-classification-category-menu qp-scroll-region"
          role="menu"
          aria-label={labels.menuLabel}
          tabIndex={-1}
          style={{ left: position.left, top: position.top }}
          onKeyDown={handleMenuKeyDown}
          onContextMenu={(event) => event.preventDefault()}
        >
          {loadFailed ? (
            /* 降级文案用**禁用态菜单项**而不是新元素：`.quick-classification-menu-item:disabled`
               已经把「灰字 + not-allowed」画好了，而 `classification.css` 冻结在 404 行
               （单文件 300 行硬限的棘轮），为一句提示新起一个类会顶穿它。
               禁用的菜单项也不会被方向键的 `:not([disabled])` 选中，键盘序不受影响。 */
            <button type="button" className="quick-classification-menu-item" role="menuitem" disabled>
              {labels.loadFailed}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="quick-classification-menu-item quick-classification-category-item"
                role="menuitemradio"
                aria-checked={itemId === null}
                disabled={saving}
                onClick={() => void pick(null)}
              >
                <span className="quick-classification-menu-check" aria-hidden="true">
                  {itemId === null ? <Check size={14} /> : null}
                </span>
                <span>{labels.none}</span>
              </button>
              {items.length === 0 ? (
                <button type="button" className="quick-classification-menu-item" role="menuitem" disabled>
                  {labels.empty}
                </button>
              ) : items.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="quick-classification-menu-item quick-classification-category-item"
                  role="menuitemradio"
                  aria-checked={option.id === itemId}
                  disabled={saving}
                  onClick={() => void pick(option.id)}
                >
                  <span className="quick-classification-menu-check" aria-hidden="true">
                    {option.id === itemId ? <Check size={14} /> : null}
                  </span>
                  <span>{option.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
