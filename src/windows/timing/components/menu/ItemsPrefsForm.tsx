/**
 * Timing — 常用事项管理卡 · 新增 / 编辑表单 ItemsPrefsForm（V0.3.9；[0.14] 加分类选用）
 * -----------------------------------------------------------------------------
 * 新增与编辑共用一张表单（与摸鱼管理同一形态）：名称 + 分类 + 默认倒计时分钟数。
 * **分钟留空 = 正计时**——不填就是「点它起正计时」，不额外给一个模式开关。
 * **分类用原生 `<select>`**（先例 `components/records/RecordRow.tsx:53`）：
 * 药丸窗不引 patina 的 QuietSelect（跨窗 import 被 L9 挡住），原生控件够用。
 * 「未分类」哨兵 value=""，出口翻 `null`（意图层的三态语义是 `null` 不是空串）。
 * 纯展示组件：取值 / 校验 / 落库全在 `ItemsPrefsMenu`。
 */
import type { FormEvent } from 'react';
import { ITEM_TIMER_MAX_MINUTES, ITEM_TIMER_MIN_MINUTES } from '../../lib/commonItems';
import type { ItemCategoryOption } from '../../hooks/useItemCategoryCatalog';

export interface ItemsPrefsFormProps {
  editing: boolean;
  name: string;
  minutes: string;
  /** [0.14] 分类候选（共享 builder 出的清单，不含 other；控件自己补「未分类」哨兵） */
  categoryOptions: ItemCategoryOption[];
  /** 当前选中的分类键；null = 未分类（哨兵 ""） */
  categoryValue: string | null;
  /** 目录还在取时下拉不可选（候选空着选了也白选） */
  categoryLoading: boolean;
  busy: boolean;
  onName: (value: string) => void;
  onMinutes: (value: string) => void;
  /** next = null（选「未分类」）| 分类键。三态判据在容器：没动过就不带字段。 */
  onCategoryChange: (next: string | null) => void;
  onSubmit: (event: FormEvent) => void;
  /** 编辑态 = 取消编辑；新增态 = 关闭管理卡 */
  onCancel: () => void;
}

export function ItemsPrefsForm({
  editing,
  name,
  minutes,
  categoryOptions,
  categoryValue,
  categoryLoading,
  busy,
  onName,
  onMinutes,
  onCategoryChange,
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
      {/* [0.14] 分类选用：当前值不在候选（分类刚被删掉）时由容器用 withCurrentValueOption 兜底， */}
      {/* 这里只负责渲染 —— 兜底项跟着 options 一起传进来，本组件不做第二次合并。 */}
      <label className="items-prefs__category">
        <span>分类</span>
        <select
          className="common-items__input items-prefs__category-select"
          value={categoryValue ?? ''}
          disabled={busy || categoryLoading}
          onChange={(event) => onCategoryChange(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">未分类</option>
          {categoryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
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
