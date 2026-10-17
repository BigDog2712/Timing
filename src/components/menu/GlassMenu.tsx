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
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { CheckIcon, iconStroke, type LucideIcon } from '../../lib/icons';
import { useHoverClose } from '../../hooks/useHoverClose';

export interface MenuItemEntry {
  type: 'item';
  id: string;
  label: string;
  icon: LucideIcon;
  /** 右侧加速键 / 信息位（等宽 11 --ink-4） */
  accel?: string;
  danger?: boolean;
  /** 当前项（右侧 --accent 勾） */
  checked?: boolean;
  disabled?: boolean;
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
  ariaLabel: string;
  onClose: () => void;
  className?: string;
  /** 额外字母键处理（如常用事项的 P 固定）；返回 true 表示已消费 */
  onExtraKey?: (key: string, focusedIndex: number) => boolean;
}

const EDGE = 4;

export function GlassMenu({ entries, status, anchor, ariaLabel, onClose, className, onExtraKey }: GlassMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /* [V0.2.7] 指针离开浮层（且不在小条上）就自动收起，见 useHoverClose */
  useHoverClose(onClose);
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
    if (idx >= 0) itemRefs.current[idx]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 以 signature 代表 entries 结构
  }, [signature]);

  /* 量测尺寸用于贴边钳制（首次与内容变化时） */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
  }, [signature, status]);

  const pos = useMemo(() => {
    const maxX = Math.max(EDGE, window.innerWidth - size.w - EDGE);
    const maxY = Math.max(EDGE, window.innerHeight - size.h - EDGE);
    return {
      x: Math.min(Math.max(anchor.x, EDGE), maxX),
      y: Math.min(Math.max(anchor.y, EDGE), maxY),
    };
  }, [anchor.x, anchor.y, size.w, size.h]);

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

  const style: CSSProperties = { left: `${pos.x}px`, top: `${pos.y}px` };

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
              onClose();
            }}
            onMouseEnter={() => setFocused(index)}
          >
            <Icon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            <span className="menu__label">{entry.label}</span>
            {entry.accel && <span className="menu__accel">{entry.accel}</span>}
            {entry.checked && <CheckIcon size={16} strokeWidth={iconStroke(16)} className="menu__check" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
