/**
 * Timing — 单个手柄（三形态共用一套视觉语言）
 * -----------------------------------------------------------------------------
 * `full` 的 path 是原 `NoteHandle.tsx:75` 那条**逐字搬过来**的（用户已经看惯的长括号）；
 * `half` 是同一支弧线压短到中间 4.8px（**不是等比压缩**：拱起量单独收到 1.05px，
 * 否则短弧在高 4.8px 里显得像半个圆圈，见下方 GLYPH_PATH 注释）；`dot` 用 ⌀6 实心圆。三者共用
 * `viewBox="0 0 12 22"` / `strokeWidth 2.5` / `strokeLinecap round` 与同一个
 * `--pill-grip-ink` —— 形态是**形状**差异，不是布局差异（N5）。
 *
 * 关掉的手柄仍然渲染（D1）：`data-enabled="false"` + CSS `display:none`。不"不渲染"的理由是
 * H-02 的判据写的是"该节点 `offsetWidth === 0`"，节点不存在会让断言退化成"测不到"。
 *
 * 锚点在**派发瞬间**取 `getBoundingClientRect()`：250ms 的待定单击会晚一帧才派发，
 * 提前量好的坐标在药丸被 auto-fit 平移后就是错的。
 */
import { useRef } from 'react';
import { useHandleGesture } from '../../hooks/useHandleGesture';
import {
  HANDLE_FORM_LABELS,
  HANDLE_SLOTS,
  HANDLE_SLOT_LABELS,
  findHandleAction,
} from '../../lib/handleCatalog';
import type { HandleForm, HandleSlot } from '../../lib/handleCatalog';
import { dispatchHandleAction } from '../../services/handleActions/dispatch';
import type { HandleActionCtx } from '../../services/handleActions/guards';

export interface HandleButtonProps {
  form: HandleForm;
  enabled: boolean;
  slots: Record<HandleSlot, string | null>;
  /** 除 `anchor` 外的全部派发上下文（`anchor` 只有手柄自己知道，见下） */
  baseCtx: Omit<HandleActionCtx, 'anchor'>;
}

/** 两种括号形态的 path（圆点不用 path） */
const GLYPH_PATH: Record<Exclude<HandleForm, 'dot'>, string> = {
  /* [0.12.1 末] 控制点 x 7.8 → 7：原来在 4.8px 高度里拱出 1.65px，曲率是长手柄的两倍，
     看起来像「半个圆圈」；压到 1.05px 之后与 full 同一种「浅浅一道弧」的语感（用户口径：
     弧度太大、要小一点、像最右边那条）。高度与端点不动，只动拱起量。 */
  half: 'M5.6 8.6 C7 10.4, 7 11.6, 5.6 13.4',
  full: 'M5.6 3.6 C9 6.6, 9 15.4, 5.6 18.4',
};

/** 把当前绑定说成人话（H-05：`title` 必须随绑定重算，不能写死旧文案） */
function boundSummary(slots: Record<HandleSlot, string | null>): string {
  const parts: string[] = [];
  for (const slot of HANDLE_SLOTS) {
    const id = slots[slot];
    if (id == null) continue;
    parts.push(`${HANDLE_SLOT_LABELS[slot]}：${findHandleAction(id)?.label ?? '无'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '未绑定';
}

export function HandleButton({ form, enabled, slots, baseCtx }: HandleButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const summary = boundSummary(slots);

  const gesture = useHandleGesture({
    slots,
    fire: (slot: HandleSlot) => {
      const rect = buttonRef.current?.getBoundingClientRect();
      /* 锚点与既有便利贴手柄逐字一致（原 NoteHandle.tsx:36）：手柄左下 + 向下 4px */
      dispatchHandleAction(slots[slot], {
        ...baseCtx,
        anchor: () => (rect ? { x: rect.left - 6, y: rect.bottom + 4 } : { x: 0, y: 0 }),
      });
    },
  });

  return (
    <button
      ref={buttonRef}
      type="button"
      className="pill__handle"
      data-handle={form}
      data-enabled={enabled ? 'true' : 'false'}
      aria-label={`${HANDLE_FORM_LABELS[form]}手柄 · ${summary}`}
      title={summary}
      {...gesture}
    >
      <svg
        width="12"
        height="22"
        viewBox="0 0 12 22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        aria-hidden
      >
        {form === 'dot' ? (
          <circle cx="6" cy="11" r="3" fill="currentColor" stroke="none" />
        ) : (
          <path d={GLYPH_PATH[form]} />
        )}
      </svg>
    </button>
  );
}
