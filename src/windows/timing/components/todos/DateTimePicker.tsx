/**
 * Timing — 待办「开启 / 截止」时间选择浮层（V0.3.9）
 * -----------------------------------------------------------------------------
 * 为什么要自绘：原生 `<input type="datetime-local">` 在 WebView2 里是 Chromium 的原生面板，
 * 既不能在里面加「x 天后」提示，也没法把小时改成上午 / 下午（中文环境固定 24 小时制）。
 * 用户口径三条都只能用自绘实现：
 *   ① 打开时默认停在**今天**（`defaultPickerValue`）；
 *   ② 日历下**额外显示「x 天后」**（`relativeDayLabel`）；
 *   ③ 小时可切**上午 / 下午**，分钟**每 5 分钟一档**（`MINUTE_SLOTS`）。
 *
 * 交互：改动即生效（点日期、切上午下午、改时分都立刻 `onChange`），不设「确定」——
 * 少一次点击；要撤销就点「清除」。点浮层外或按 Esc 收起，已选的值保留。
 * portal 到 body：`.todos` 的 overflow/backdrop 会把绝对定位的子节点裁掉。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  HOUR12_SLOTS,
  MINUTE_SLOTS,
  MINUTE_STEP,
  WEEKDAY_LABELS,
  defaultPickerValue,
  isSameDay,
  monthGrid,
  relativeDayLabel,
  shiftMonth,
  to12h,
  to24h,
  withTimeOfDay,
} from '../../lib/datetime';
import { ChevronLeftIcon, ChevronRightIcon, iconStroke } from '../../lib/icons';
import { pickerBox } from '../../lib/pickerBox';
import type { PickerAnchor } from '../../lib/pickerBox';

interface DateTimePickerProps {
  value: number | null;
  /** 卡片（横向右沿）/ 浮层定位用 */
  anchor: PickerAnchor;
  /** 触发浮层的字段按钮：它自己的 pointerdown 不算「外面」（开合由 onClick 负责） */
  anchorEl?: HTMLElement | null;
  onChange: (ms: number | null) => void;
  onClose: () => void;
}

export function DateTimePicker({ value, anchor, anchorEl, onChange, onClose }: DateTimePickerProps) {
  const now = Date.now();
  const [draft, setDraft] = useState(() => value ?? defaultPickerValue(now));
  const [view, setView] = useState(() => {
    const d = new Date(value ?? defaultPickerValue(now));
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const boxRef = useRef<HTMLDivElement>(null);

  /* 点浮层外面收起；字段按钮自己负责开合，这里放行。
     注意要按**元素身份**放行而不是按 `.dt-field` 类：否则点另一个字段时，
     上一个浮层不会关，会同时挂两个。 */
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && boxRef.current?.contains(t)) return;
      if (t && anchorEl?.contains(t)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [anchorEl, onClose]);

  /* Esc 要「只收浮层」。浮层里的按钮不是输入框，按 Esc 时焦点通常还留在字段按钮上，
     事件根本不经过浮层 —— 只能在 document 捕获阶段拦，并 stopPropagation 挡住
     卡片 / 窗口那两级的 Esc（它们分别会取消新增、关闭窗口）。
     捕获阶段先于 React 根容器的委托，所以这一手是有效的。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const apply = (next: number) => {
    setDraft(next);
    onChange(next);
  };

  const d = new Date(draft);
  const hour24 = d.getHours();
  const { meridiem, hour12 } = to12h(hour24);
  /* 已存值的分钟不一定落在 5 分钟档上（历史数据 / 别的入口写的），取最近档位显示 */
  const minuteSlot = (Math.round(d.getMinutes() / MINUTE_STEP) * MINUTE_STEP) % 60;

  const cells = monthGrid(view.year, view.month);

  return createPortal(
    <div
      ref={boxRef}
      className="dt-pop"
      style={{ ...pickerBox(anchor, window.innerWidth, window.innerHeight), position: 'fixed' }}
      role="dialog"
      aria-label="选择时间"
      /* 浮层虽然在 DOM 里挂在 body，React 事件仍按组件树冒泡到上级组件 ——
         Esc / ↑↓ 必须在这里截住，否则会关掉整个窗口、或把焦点移到底下的行 */
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      /* [V0.3.10] 鼠标事件同理：待办行整行点击 = 勾选完成，不截住的话「点日历上的某一天」
         会同时把这条待办勾成已完成（portal 只改 DOM 位置，不改 React 的冒泡路径）。
         这里是**所有**消费者的统一收口——新增待办卡、行内改时间都靠它。 */
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="dt-pop__head">
        <button
          type="button"
          className="dt-pop__nav"
          aria-label="上个月"
          onClick={() => setView(shiftMonth(view.year, view.month, -1))}
        >
          <ChevronLeftIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        </button>
        <span className="dt-pop__month">
          {view.year}年{view.month + 1}月
        </span>
        <button
          type="button"
          className="dt-pop__nav"
          aria-label="下个月"
          onClick={() => setView(shiftMonth(view.year, view.month, 1))}
        >
          <ChevronRightIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        </button>
      </div>

      <div className="dt-pop__week" aria-hidden>
        {WEEKDAY_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="dt-pop__grid" role="grid">
        {cells.map((cell) => (
          <button
            key={cell.ms}
            type="button"
            className="dt-pop__day"
            role="gridcell"
            data-out={cell.inMonth ? undefined : 'true'}
            data-today={isSameDay(cell.ms, now) ? 'true' : undefined}
            data-sel={isSameDay(cell.ms, draft) ? 'true' : undefined}
            aria-selected={isSameDay(cell.ms, draft)}
            onClick={() => apply(withTimeOfDay(cell.ms, hour24, minuteSlot))}
          >
            {cell.date}
          </button>
        ))}
      </div>

      {/* 用户口径：日历下额外给一行「x 天后」 */}
      <div className="dt-pop__rel">
        <span className="dt-pop__rel-day">{relativeDayLabel(draft, now)}</span>
        <button
          type="button"
          className="dt-pop__clear"
          onClick={() => {
            onChange(null);
            onClose();
          }}
        >
          清除
        </button>
      </div>

      <div className="dt-pop__time">
        <div className="dt-pop__mer">
          <button
            type="button"
            data-on={meridiem === 'am' ? 'true' : undefined}
            onClick={() => apply(withTimeOfDay(draft, to24h('am', hour12), minuteSlot))}
          >
            上午
          </button>
          <button
            type="button"
            data-on={meridiem === 'pm' ? 'true' : undefined}
            onClick={() => apply(withTimeOfDay(draft, to24h('pm', hour12), minuteSlot))}
          >
            下午
          </button>
        </div>

        <select
          className="dt-pop__sel"
          aria-label="小时"
          value={hour12}
          onChange={(e) => apply(withTimeOfDay(draft, to24h(meridiem, Number(e.target.value)), minuteSlot))}
        >
          {HOUR12_SLOTS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="dt-pop__colon">:</span>
        <select
          className="dt-pop__sel"
          aria-label="分钟（每 5 分钟一档）"
          value={minuteSlot}
          onChange={(e) => apply(withTimeOfDay(draft, hour24, Number(e.target.value)))}
        >
          {MINUTE_SLOTS.map((m) => (
            <option key={m} value={m}>
              {m < 10 ? `0${m}` : m}
            </option>
          ))}
        </select>
      </div>
    </div>,
    document.body,
  );
}
