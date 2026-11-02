/**
 * TickBar — 自绘玻璃菜单 GlassMenu（context-menu.md §1 / §2 / §3.2 / §3.3）
 * -----------------------------------------------------------------------------
 * 表现层（与数据源解耦）：接收已构建好的 entries / status，负责玻璃外观 + 键盘导航 + 贴边定位。
 *   - 键盘：↑ / ↓ 移动（跳过禁用项）、Home / End、Enter 执行、Esc 关闭、Tab 移出并关闭。
 *   - 焦点：打开时落在首个可用项；focus-visible 由全局 --focus-ring 提供。
 *   - 玻璃：--menu-bg（94% 板，文字全不透明）+ 1px --line-2 + --shadow-float；
 *     应用内菜单在玻璃范围内（DESIGN §6.4），故启用 backdrop-filter；主小条本体不挂模糊。
 *   - 定位：以触发点左上为锚，贴边向内翻转（不越出工作区）。
 * 行数据 MenuEntry：item / separator / group，支持 danger、disabled、checked、accel。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { CheckIcon, iconStroke, type LucideIcon } from '../../lib/icons';
import { useHoverClose, type HoverCloseOptions } from '../../hooks/useHoverClose';
import { fitBounds } from '../../lib/fitBounds';

export interface MenuItemEntry {
  type: 'item';
  id: string;
  label: string;
  /** 行首图标；不传就只显示文字（如常用事项的置顶行，用户口径：不要图标） */
  icon?: LucideIcon;
  /** 右侧加速键 / 信息位（等宽 11 --ink-4） */
  accel?: string;
  danger?: boolean;
  /** 当前项（右侧 --accent 勾） */
  checked?: boolean;
  disabled?: boolean;
  /**
   * 选中后**保持菜单打开**（V0.3.9 修）：给「切到二级视图」的行用——旧行为是无条件
   * `onClose`，二级视图刚挂载就被卸载，表现为「点了没反应」。
   */
  keepOpen?: boolean;
  onSelect: () => void;
}

export type MenuEntry =
  | MenuItemEntry
  | { type: 'separator'; id: string }
  | { type: 'group'; id: string; label: string };

/** 顶部状态块（计时中 / 暂停时显示；空闲可不传） */
export interface MenuStatus {
  title: string;
  /** 右侧信息位（如起始时刻） */
  meta?: string;
  /** 第二行（如「倒计时 · 剩 07:26」） */
  detail?: string;
  tone?: 'accent' | 'danger';
}

interface GlassMenuProps {
  entries: MenuEntry[];
  status?: MenuStatus | null;
  anchor: { x: number; y: number };
  /**
   * 触发面板的那条「条」的上下沿（布局坐标，可选）。给了它，竖直方向就按条的**外沿**贴：
   * 下方展开贴下沿、翻到上方贴上沿——而不是贴光标（光标在条内部，菜单会盖住条）。
   */
  bar?: { top: number; bottom: number };
  ariaLabel: string;
  onClose: () => void;
  className?: string;
  /** 额外字母键处理（如常用事项的 P 固定）；返回 true 表示已消费 */
  onExtraKey?: (key: string, focusedIndex: number) => boolean;
  /** 离开即收的宽限（V0.3.9）：自动弹出的菜单传 `{ graceMs: 1000, requireEnter: true }`，`false` = 不自动收 */
  hoverClose?: HoverCloseOptions | false;
  /** 菜单底部附加区（如常用事项框右下角的「事项管理」小圆点） */
  footer?: ReactNode;
  /** 打开时是否聚焦首个可用行（默认 true）；与内联输入框同弹时传 false，焦点留给输入框 */
  autoFocus?: boolean;
}

const EDGE = 4;
/** 下沿不足时菜单至少留这么高（再小就只剩滚动条了）；超出部分内部滚动。 */
const MIN_MENU_H = 120;

export function GlassMenu({
  entries,
  status,
  anchor,
  bar,
  ariaLabel,
  onClose,
  className,
  onExtraKey,
  hoverClose,
  footer,
  autoFocus = true,
}: GlassMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /* [V0.2.7] 指针离开浮层（且不在小条上）就自动收起，见 useHoverClose；
     [V0.3.9] 自动弹出的菜单可要求「先移入再移出」。 */
  useHoverClose(onClose, hoverClose !== false, hoverClose === false ? undefined : hoverClose);
  const [size, setSize] = useState({ w: 0, h: 0 });

  /** 首个未禁用项下标（-1 = 全禁用） */
  const firstEnabled = useMemo(() => entries.findIndex((e) => e.type === 'item' && !e.disabled), [entries]);
  const [focused, setFocused] = useState(firstEnabled);

  /* 行结构签名：仅在菜单内容真正变化时重定位焦点 / 重测尺寸（避免无关重渲染抢焦点） */
  const signature = useMemo(() => entries.map((e) => e.id).join('|'), [entries]);

  /* 打开 / 行变化：聚焦首个可用项 */
  useEffect(() => {
    const idx = entries.findIndex((e) => e.type === 'item' && !e.disabled);
    setFocused(idx);
    if (autoFocus && idx >= 0) itemRefs.current[idx]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 以 signature 代表 entries 结构
  }, [signature]);

  /* 量测「自然尺寸」，供下方翻转 / 贴边钳制使用（首次与内容变化时）。
     必须先按自然高度量：上一帧算出的 maxHeight 已经写在元素上，被压扁后再量，h 永远
     「放得下」，下边空间不足时就不会翻到上方。这里临时摘掉 maxHeight 量完立刻还回去，
     用 useLayoutEffect 保证在绘制前完成，不会闪一帧。 */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = el.style.maxHeight;
    el.style.maxHeight = 'none';
    const r = el.getBoundingClientRect();
    el.style.maxHeight = prev;
    setSize((s) =>
      Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height },
    );
  }, [signature, status]);

  const pos = useMemo(() => {
    /* [ADR-020] 贴边钳制按「显示器工作区」算，不按当前窗口：主窗没有画布了，
       读 window.innerWidth 会把菜单硬挤到胶囊上。fitBounds() 非主窗回落真实视口；
       主窗返回的是**层坐标**下的工作区（x/y 为负），所以右/下边界是 x + w、y + h。

       竖直方向：默认**向下**展开（顶边贴「条」的下沿 + EDGE），下方放不下就**翻到上方**
       （底边贴「条」的上沿 - EDGE）；两边都放不下时留在空间大的一侧，maxHeight 收到该侧
       可用高度内部滚动。上/左边界取工作区的上沿与左沿（主窗是负的），所以翻到上方时
       内容可以落在层坐标 < 0 处——窗口会跟着向上长，不会裁掉（见 lib/autoFit.ts 的
       BoundsSize.x/y）。 */
    const viewport = fitBounds();
    const leftEdge = viewport.x + EDGE;
    const topEdge = viewport.y + EDGE;
    const maxX = Math.max(leftEdge, viewport.x + viewport.w - size.w - EDGE);
    const bottomEdge = viewport.y + viewport.h - EDGE;
    /* 竖直贴的是「条」的外沿（有 bar 时），否则退回光标锚点 */
    const barTop = bar?.top ?? anchor.y;
    const barBottom = bar?.bottom ?? anchor.y;
    const spaceBelow = bottomEdge - (barBottom + EDGE);
    const spaceAbove = barTop - EDGE - topEdge;

    let y: number;
    let maxH: number;
    if (size.h <= spaceBelow) {
      /* 默认：条下方完整展开 */
      y = barBottom + EDGE;
      maxH = spaceBelow;
    } else if (size.h <= spaceAbove) {
      /* 下方不够、上方够：翻上去，菜单下沿贴条的上沿 */
      y = barTop - EDGE - size.h;
      maxH = spaceAbove;
    } else if (spaceBelow >= spaceAbove) {
      /* 都放不下：留在下方滚动 */
      y = barBottom + EDGE;
      maxH = spaceBelow;
    } else {
      /* 都放不下且上方更大：贴上沿（工作区上沿），上方滚动 */
      y = topEdge;
      maxH = spaceAbove;
    }
    return {
      x: Math.min(Math.max(anchor.x, leftEdge), maxX),
      y: Math.max(topEdge, y),
      maxH: Math.max(MIN_MENU_H, maxH),
    };
  }, [anchor.x, anchor.y, bar?.top, bar?.bottom, size.w, size.h]);

  const moveFocus = (delta: number) => {
    const total = entries.length;
    for (let step = 1; step <= total; step += 1) {
      const next = (focused + delta * step + total * step) % total;
      const entry = entries[next];
      if (entry?.type === 'item' && !entry.disabled) {
        setFocused(next);
        itemRefs.current[next]?.focus();
        return;
      }
    }
  };

  const focusEdge = (fromEnd: boolean) => {
    const order = fromEnd ? [...entries.keys()].reverse() : [...entries.keys()];
    for (const idx of order) {
      const entry = entries[idx];
      if (entry?.type === 'item' && !entry.disabled) {
        setFocused(idx);
        itemRefs.current[idx]?.focus();
        return;
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(-1);
        break;
      case 'Home':
        e.preventDefault();
        focusEdge(false);
        break;
      case 'End':
        e.preventDefault();
        focusEdge(true);
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'Tab':
        /* 移出菜单并关闭（焦点交还触发元素由调用方/浏览器接管） */
        onClose();
        break;
      default:
        /* 额外字母键（如 P 固定）交由调用方处理 */
        if (onExtraKey && e.key.length === 1 && onExtraKey(e.key, focused)) e.preventDefault();
        break;
    }
  };

  const style: CSSProperties = { left: `${pos.x}px`, top: `${pos.y}px`, maxHeight: `${pos.maxH}px` };

  return (
    <div
      ref={ref}
      className={className ? `menu ${className}` : 'menu'}
      role="menu"
      aria-label={ariaLabel}
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {status && (
        <div className="menu__status" data-tone={status.tone ?? 'accent'}>
          <div className="menu__status-row">
            <span className="menu__status-dot" aria-hidden />
            <span className="menu__status-title">{status.title}</span>
            {status.meta && <span className="menu__status-meta">{status.meta}</span>}
          </div>
          {status.detail && <div className="menu__status-detail">{status.detail}</div>}
        </div>
      )}

      {entries.map((entry, index) => {
        if (entry.type === 'separator') return <div key={entry.id} className="menu__sep" role="separator" />;
        if (entry.type === 'group') {
          return (
            <div key={entry.id} className="menu__group" role="presentation">
              {entry.label}
            </div>
          );
        }
        const Icon = entry.icon;
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            className="menu__item"
            data-danger={entry.danger ? 'true' : 'false'}
            data-current={entry.checked ? 'true' : 'false'}
            disabled={entry.disabled}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            onClick={() => {
              if (entry.disabled) return;
              entry.onSelect();
              /* 二级视图（keepOpen）由调用方自己决定何时关：这里关就等于把刚挂上的视图一起卸了 */
              if (!entry.keepOpen) onClose();
            }}
            onMouseEnter={() => setFocused(index)}
          >
            {Icon && <Icon size={16} strokeWidth={iconStroke(16)} aria-hidden />}
            <span className="menu__label">{entry.label}</span>
            {entry.accel && <span className="menu__accel">{entry.accel}</span>}
            {entry.checked && <CheckIcon size={16} strokeWidth={iconStroke(16)} className="menu__check" aria-hidden />}
          </button>
        );
      })}

      {footer && <div className="menu__footer">{footer}</div>}
    </div>
  );
}
