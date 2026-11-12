/**
 * 主界面设置 ·「主界面组件」面板（v3 自由摆位）
 * -----------------------------------------------------------------------------
 * 这是**主界面板上那张清单的另一个入口**：板子上直接拖更方便，但两件事只有这里能做——
 *   · 一次看到全部组件（板上几张、各是什么尺寸），不必挨个点 `⋯`；
 *   · 默认布局（保存 / 恢复）/ 关掉 8px 吸附（板子上没有位置放这几个「全局」开关）。
 *
 * 数据源与主界面是**同一个 store**（`useDashboardLayout` → `boardStore`）：这里删一张卡，
 * 回主界面它就没了；不存在「设置里改了、主界面没动」的第二份状态。
 *
 * 写路径全部即时生效、没有保存按钮：这是观感配置，不是表单草稿（与本页其它卡同口径）。
 */
import { useState } from "react";
import { LayoutGrid, Plus, RotateCcw } from "lucide-react";
import { useLocale } from "../../../shared/i18n/index.ts";
import QuietButton from "../../../shared/components/QuietButton";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import { BOARD_COPY } from "../../dashboard/layout/boardCopy.ts";
import AddCardDialog from "../../dashboard/layout/AddCardDialog.tsx";
import {
  displayTitle,
  KIND_SPECS,
  type CardTier,
} from "../../dashboard/layout/contract.ts";
import { useDashboardLayout } from "../../dashboard/layout/useDashboardLayout.ts";
import { DASHBOARD_COPY } from "../../dashboard/copy.ts";
import SettingsPanelHeader from "./SettingsPanelHeader";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "./SettingsPreferenceLayout";

const TIERS: readonly CardTier[] = ["S", "M", "L"];

export default function SettingsBoardPanel({ id }: { id?: string }) {
  const locale = useLocale();
  const copy = BOARD_COPY[locale];
  const labels = DASHBOARD_COPY[locale].cardLabels;
  const layout = useDashboardLayout();
  const [addOpen, setAddOpen] = useState(false);

  const cards = layout.layout.cards;

  return (
    <section className="qp-panel p-5 md:p-6 settings-board" id={id}>
      <SettingsPanelHeader icon={<LayoutGrid size={16} aria-hidden="true" />} title="主界面组件" />

      {/* 与同页其它面板同构：`qp-panel` 不带内边距，组间距靠 `mt-5 space-y-5`。 */}
      <div className="mt-5 space-y-5">
        <p className="settings-board-hint">
          组件板是自由摆位：在主界面拖卡头挪位置、拖右缘下缘改尺寸，位置会记住。这里管的是
          <strong>有哪些组件</strong>与<strong>全局手感</strong>。
        </p>

        <SettingsPreferenceGroup title={`板上组件 · ${cards.length} 张`} headerAside={(
          <QuietButton size="compact" onClick={() => setAddOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            添加组件
          </QuietButton>
        )}>
          {cards.length === 0 ? (
            <p className="settings-board-empty">板子是空的。点右上「添加组件」放一张，主界面才有内容。</p>
          ) : (
            <ul className="settings-board-list">
              {cards.map((card) => {
                const name = displayTitle(card, labels);
                return (
                  <li key={card.uid} className="settings-board-row">
                    <span className="settings-board-name">{name}</span>
                    <span className="settings-board-kind">{KIND_SPECS[card.kind].label}</span>
                    <span className="settings-board-size" role="group" aria-label={`${name} 尺寸`}>
                      {TIERS.map((tier) => (
                        <button
                          key={tier}
                          type="button"
                          className="settings-board-tier"
                          aria-pressed={card.tier === tier}
                          onClick={() => layout.setTier(card.uid, tier)}
                        >
                          {copy.sizes[tier]}
                        </button>
                      ))}
                    </span>
                    <QuietButton
                      size="compact"
                      tone="secondary"
                      aria-label={`移除「${name}」`}
                      onClick={() => layout.remove(card.uid)}
                    >
                      移除
                    </QuietButton>
                  </li>
                );
              })}
            </ul>
          )}
        </SettingsPreferenceGroup>

        <SettingsPreferenceGroup title="布局与手感">
          <SettingsPreferenceRow
            title="8px 对齐"
            hint="拖动与缩放时吸附到 8px 网格。关掉后按 1px 精度移动，适合卡着像素对齐。"
          >
            <QuietSwitch
              checked={layout.layout.snap}
              ariaLabel="8px 对齐"
              onChange={layout.setSnap}
            />
          </SettingsPreferenceRow>
          <SettingsPreferenceRow
            title="整理"
            hint="把现有组件按三列重新排紧凑（exe 的装箱算法）。"
          >
            <span className="settings-board-actions">
              <QuietButton size="compact" onClick={layout.tidy}>整理</QuietButton>
            </span>
          </SettingsPreferenceRow>
          <SettingsPreferenceRow
            title="默认布局"
            hint="「保存布局」把当前排布存为默认，此后「恢复默认」回到这一版；没存过时回出厂排布。「出厂布局」不动已存的默认版。"
          >
            <span className="settings-board-actions">
              <QuietButton
                size="compact"
                onClick={() => layout.saveAsDefault()}
                disabled={cards.length === 0}
              >
                保存布局
              </QuietButton>
              <QuietButton size="compact" onClick={layout.reset}>
                <RotateCcw size={14} aria-hidden="true" />
                恢复默认
              </QuietButton>
              {layout.customDefault ? (
                <QuietButton size="compact" onClick={layout.resetToFactory}>
                  出厂布局
                </QuietButton>
              ) : null}
            </span>
          </SettingsPreferenceRow>
        </SettingsPreferenceGroup>
      </div>

      {addOpen ? (
        <AddCardDialog
          copy={copy}
          countOf={layout.countOf}
          onAdd={layout.add}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </section>
  );
}
