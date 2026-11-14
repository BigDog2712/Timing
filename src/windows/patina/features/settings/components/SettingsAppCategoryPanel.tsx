/**
 * 设置页「应用分类候选」面板。
 *
 * ## 这一屏在解决什么
 *
 * 旧界面只能给一个应用**绑一个**分类（`__app_override::<exe>` 是单值）。新模型的
 * 需求是「chrome 既是学习工具也是娱乐工具」—— 一个应用属于多个分类，实际落到哪个
 * 由**所在事项的分类**决定；事项分类不在候选集里时才退回首位。
 *
 * 所以这一屏的核心不是「增删改查」，而是**顺序**：第一个就是兜底答案。界面上必须
 * 把它标出来（首位徽章），否则用户改顺序时不知道自己改了什么。
 *
 * ## 文案为什么是中文常量
 *
 * 与 `settingsGroups.ts` 同一策略：这一屏的锚点标题已经是中文常量进 `SETTINGS_GROUPS`，
 * 且 `i18n/generated/contract.ts` 没有余量加 key。四语言覆盖留到文案包统一扩行。
 */
import { useState } from "react";
import { Tags } from "lucide-react";

import QuietButton from "../../../shared/components/QuietButton";
import SettingsPanelHeader from "./SettingsPanelHeader";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "./SettingsPreferenceLayout";
import { useAppCategories } from "../hooks/useAppCategories.ts";
import type { AppCategoryRow } from "../../../platform/persistence/attributionGateway.ts";

const COPY = {
  title: "应用分类候选",
  hint: "一个应用可以属于多个分类。事项分类命中其中之一时按事项分类记；都不命中时记第一个。",
  empty: "还没有任何应用绑定分类。下方添加第一条，或先在「应用分类」页保存一次（旧配置会自动迁移过来）。",
  appPlaceholder: "应用（如 chrome.exe）",
  categoryPlaceholder: "分类（如 学习 / 摸鱼）",
  add: "添加",
  firstBadge: "首位",
  moveUp: "前移",
  moveDown: "后移",
  removeLabel: "移除",
  loading: "正在读取…",
} as const;

function CategoryChip({
  row,
  isFirst,
  isLast,
  disabled,
  onMove,
  onRemove,
}: {
  row: AppCategoryRow;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  return (
    <span className="settings-app-category-chip" data-first={isFirst || undefined}>
      <span className="settings-app-category-chip-label">{row.categoryKey}</span>
      {isFirst ? <span className="settings-app-category-chip-badge">{COPY.firstBadge}</span> : null}
      {/* 前移/后移是两个独立按钮而不是拖拽：拖拽在触控板上的落点判定很难做对，
          而这里真正要表达的只有「谁排第一」这一个意图。 */}
      <button
        type="button"
        className="settings-app-category-chip-action"
        aria-label={`${COPY.moveUp} ${row.categoryKey}`}
        disabled={disabled || isFirst}
        onClick={() => onMove("up")}
      >
        ←
      </button>
      <button
        type="button"
        className="settings-app-category-chip-action"
        aria-label={`${COPY.moveDown} ${row.categoryKey}`}
        disabled={disabled || isLast}
        onClick={() => onMove("down")}
      >
        →
      </button>
      <button
        type="button"
        className="settings-app-category-chip-action"
        aria-label={`${COPY.removeLabel} ${row.categoryKey}`}
        disabled={disabled}
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  );
}

export default function SettingsAppCategoryPanel({ id }: { id?: string }) {
  const { groups, loading, error, savingAppKey, add, move, remove } = useAppCategories();
  const [appInput, setAppInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("");

  const submit = async () => {
    if (!appInput.trim() || !categoryInput.trim()) return;
    await add(appInput, categoryInput);
    setCategoryInput("");
  };

  return (
    <div id={id}>
      <section className="qp-panel p-5 md:p-6">
        <SettingsPanelHeader
          icon={<Tags size={16} className="text-[var(--qp-accent-default)]" />}
          title={COPY.title}
        />
        <p className="mt-2 text-[var(--qp-text-tertiary)]" style={{ fontSize: "var(--qp-font-size-caption)" }}>
          {COPY.hint}
        </p>

        {error ? (
          <p className="mt-3 settings-app-category-error" role="alert">{error}</p>
        ) : null}

        <SettingsPreferenceGroup title="添加绑定">
          <SettingsPreferenceRow title="" stacked>
            <div className="settings-app-category-form">
              <input
                className="settings-app-category-input"
                value={appInput}
                onChange={(event) => setAppInput(event.target.value)}
                placeholder={COPY.appPlaceholder}
                aria-label={COPY.appPlaceholder}
                spellCheck={false}
              />
              <input
                className="settings-app-category-input"
                value={categoryInput}
                onChange={(event) => setCategoryInput(event.target.value)}
                placeholder={COPY.categoryPlaceholder}
                aria-label={COPY.categoryPlaceholder}
                spellCheck={false}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                }}
              />
              <QuietButton
                onClick={() => void submit()}
                disabled={!appInput.trim() || !categoryInput.trim()}
              >
                {COPY.add}
              </QuietButton>
            </div>
          </SettingsPreferenceRow>
        </SettingsPreferenceGroup>

        {loading ? (
          <p className="mt-3 text-[var(--qp-text-tertiary)]" style={{ fontSize: "var(--qp-font-size-caption)" }}>
            {COPY.loading}
          </p>
        ) : null}

        {!loading && groups.size === 0 ? (
          <p className="mt-3 text-[var(--qp-text-tertiary)]" style={{ fontSize: "var(--qp-font-size-caption)" }}>
            {COPY.empty}
          </p>
        ) : null}

        <ul className="settings-app-category-list">
          {[...groups.entries()].map(([appKey, rows]) => {
            const busy = savingAppKey === appKey;
            return (
              <li key={appKey} className="settings-app-category-row">
                <span className="settings-app-category-app" title={appKey}>{appKey}</span>
                <span className="settings-app-category-chips">
                  {rows.map((row, index) => (
                    <CategoryChip
                      key={row.categoryKey}
                      row={row}
                      isFirst={index === 0}
                      isLast={index === rows.length - 1}
                      disabled={busy}
                      onMove={(direction) => void move(appKey, row.categoryKey, direction)}
                      onRemove={() => void remove(appKey, row.categoryKey)}
                    />
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
