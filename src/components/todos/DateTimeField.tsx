/**
 * Timing — 待办「开启 / 截止」时间字段（V0.3.9）
 * -----------------------------------------------------------------------------
 * 一行 = 左标签 + 右按钮；按钮上只显示读数（`今天 21:30`），点开由 `DateTimePicker` 接管。
 * 未设值时显示灰字「今天（未设）」——用户口径「默认今天」，但**不落值**：
 * 待办的两项时间本来就是可留空的，没点过就不写 `remind_at` / `planned_at`。
 */
import { useRef, useState } from 'react';
import { formatFieldLabel } from '../../lib/datetime';
import type { PickerAnchor } from '../../lib/pickerBox';
import { DateTimePicker } from './DateTimePicker';

interface DateTimeFieldProps {
  label: string;
  value: number | null;
  onChange: (ms: number | null) => void;
}

/** 未设值时的灰字：说明默认日期，但不暗示已经设好 */
const EMPTY_TEXT = '今天（未设）';

export function DateTimeField({ label, value, onChange }: DateTimeFieldProps) {
  const [anchor, setAnchor] = useState<PickerAnchor | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = (btn: HTMLButtonElement) => {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = btn.getBoundingClientRect();
    /* 横向对齐到卡片右沿（不是对齐按钮）：面板只有 252 宽，对齐按钮会把浮层顶出窗口。
       纵向锚在**卡片**上而不是字段上：浮层 240 高，贴字段向上会盖住标题输入框，
       贴卡片向上则只盖住上面的记录列表，正在填的表单始终看得见。 */
    const card = btn.closest('.todos-compose')?.getBoundingClientRect();
    setAnchor({
      top: card?.top ?? rect.top,
      bottom: card?.bottom ?? rect.bottom,
      right: card?.right ?? rect.right,
      width: card?.width ?? rect.width,
    });
  };

  const text = formatFieldLabel(value, Date.now());

  return (
    <div className="todos-compose__row">
      <span>{label}</span>
      <button
        ref={btnRef}
        type="button"
        className="dt-field"
        data-empty={text === '' ? 'true' : undefined}
        aria-haspopup="dialog"
        aria-expanded={anchor != null}
        onClick={(e) => toggle(e.currentTarget)}
      >
        {text === '' ? EMPTY_TEXT : text}
      </button>

      {anchor && (
        <DateTimePicker
          value={value}
          anchor={anchor}
          anchorEl={btnRef.current}
          onChange={onChange}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  );
}
