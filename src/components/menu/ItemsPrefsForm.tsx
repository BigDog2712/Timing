/**
 * Timing — 常用事项管理卡 · 新增 / 编辑表单 ItemsPrefsForm（V0.3.9）
 * -----------------------------------------------------------------------------
 * 新增与编辑共用一张表单（与摸鱼管理同一形态）：名称 + 默认倒计时分钟数。
 * **分钟留空 = 正计时**——不填就是「点它起正计时」，不额外给一个模式开关。
 * 纯展示组件：取值 / 校验 / 落库全在 `ItemsPrefsMenu`。
 */
import type { FormEvent } from 'react';
import { ITEM_TIMER_MAX_MINUTES, ITEM_TIMER_MIN_MINUTES } from '../../lib/commonItems';

export interface ItemsPrefsFormProps {
  editing: boolean;
  name: string;
  minutes: string;
  busy: boolean;
  onName: (value: string) => void;
  onMinutes: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  /** 编辑态 = 取消编辑；新增态 = 关闭管理卡 */
  onCancel: () => void;
}

export function ItemsPrefsForm({
  editing,
  name,
  minutes,
  busy,
  onName,
  onMinutes,
  onSubmit,
  onCancel,
}: ItemsPrefsFormProps) {
  return (
    <form className="items-prefs__form" onSubmit={onSubmit}>
      <div className="menu__group">{editing ? '编辑事项' : '新增事项'}</div>
      <input
        type="text"
        className="common-items__input"
        placeholder="事项名称"
        maxLength={40}
        value={name}
        onChange={(event) => onName(event.target.value)}
      />
      <label className="items-prefs__minutes">
        <input
          type="number"
          className="common-items__input"
          min={ITEM_TIMER_MIN_MINUTES}
          max={ITEM_TIMER_MAX_MINUTES}
          step={1}
          placeholder="正计时"
          value={minutes}
          onChange={(event) => onMinutes(event.target.value)}
        />
        <span>分钟</span>
      </label>
      <div className="items-prefs__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {editing ? '取消' : '返回'}
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy || name.trim().length === 0}
        >
          {editing ? '保存' : '添加'}
        </button>
      </div>
    </form>
  );
}
