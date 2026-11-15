/**
 * Timing — 常用事项管理卡 · 「显示最近事项」开关行 ItemsPrefsRecentRow
 * -----------------------------------------------------------------------------
 * [0.14] 从 `ItemsPrefsMenu` 拆出：那边 299 行已经顶到 300 门禁的边，加「分类选用」
 * 必须先腾行数。只搬**展示与钳位**（条数 1..10、非法回落 5），落库（`patchSettings`）
 * 仍由容器回调 —— 拆出去的是行，不是设置语义。
 */
import type { KeyboardEvent } from 'react';

/** 默认条数（非法输入回落到它）；钳位范围 1..10，与容器 settings 侧同值 */
export const RECENT_DEFAULT = 5;
export const RECENT_MIN = 1;
export const RECENT_MAX = 10;

interface ItemsPrefsRecentRowProps {
  showRecent: boolean;
  count: string;
  onCountChange: (value: string) => void;
  /** 失焦 / 回车提交：参数是**钳位后**的条数（非法回落 RECENT_DEFAULT） */
  onCommitCount: (clamped: number) => void;
  onToggle: () => void;
}

/** 表单值 → 合法条数；留空 / 非法 = RECENT_DEFAULT，越界钳 1..10 */
function clampCount(raw: string): number {
  const parsed = Math.round(Number(raw));
  if (!Number.isFinite(parsed)) return RECENT_DEFAULT;
  return Math.min(RECENT_MAX, Math.max(RECENT_MIN, parsed));
}

export function ItemsPrefsRecentRow({
  showRecent,
  count,
  onCountChange,
  onCommitCount,
  onToggle,
}: ItemsPrefsRecentRowProps) {
  const commit = () => onCommitCount(clampCount(count));
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  };
  return (
    <div className="items-prefs__recent">
      <button
        type="button"
        className="items-prefs__toggle"
        data-on={showRecent}
        aria-pressed={showRecent}
        onClick={onToggle}
      >
        显示最近事项
      </button>
      <input
        type="number"
        className="items-prefs__count"
        aria-label="最近事项条数"
        min={RECENT_MIN}
        max={RECENT_MAX}
        step={1}
        value={count}
        disabled={!showRecent}
        onChange={(event) => onCountChange(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
      />
    </div>
  );
}
