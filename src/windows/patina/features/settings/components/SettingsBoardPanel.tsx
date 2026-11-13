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
import { LayoutGrid, Plus } from "lucide-react";
import { useLocale } from "../../../shared/i18n/index.ts";
import QuietButton from "../../../shared/components/QuietButton";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import { BOARD_COPY } from "../../dashboard/layout/boardCopy.ts";
import AddCardDialog from "../../dashboard/layout/AddCardDialog.tsx";
import { FACTORY_LAYOUT_ID } from "../../dashboard/layout/library.ts";
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
      <SettingsPanelHeader icon={<LayoutGrid size={16} aria-hidden="true" />} title={copy.boardPanelTitle} />

      {/* 与同页其它面板同构：`qp-panel` 不带内边距，组间距靠 `mt-5 space-y-5`。 */}
      <div className="mt-5 space-y-5">
        <p className="settings-board-hint">{copy.boardPanelHint}</p>

        <SettingsPreferenceGroup title={`${copy.onBoard(cards.length)}`} headerAside={(
          <QuietButton size="compact" onClick={() => setAddOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            {copy.addTitle}
          </QuietButton>
        )}>
          {cards.length === 0 ? (
            <p className="settings-board-empty">{copy.boardPanelEmpty}</p>
          ) : (
            <ul className="settings-board-list">
              {cards.map((card) => {
                const name = displayTitle(card, labels);
                return (
                  <li key={card.uid} className="settings-board-row">
                    <span className="settings-board-name">{name}</span>
                    <span className="settings-board-kind">{KIND_SPECS[card.kind].label}</span>
                    <span className="settings-board-size" role="group" aria-label={copy.sizeNamed(name)}>
                      {TIERS.map((tier) => (
                        <button
                          key={tier}
                          type="button"
                          className="settings-board-tier"
                          aria-pressed={card.tier === tier}
                          disabled={layout.locked}
                          onClick={() => layout.setTier(card.uid, tier)}
                        >
                          {copy.sizes[tier]}
                        </button>
                      ))}
                    </span>
                    <QuietButton
                      size="compact"
                      tone="secondary"
                      aria-label={copy.removeNamed(name)}
                      disabled={layout.locked}
                      onClick={() => layout.remove(card.uid)}
                    >
                      {copy.remove}
                    </QuietButton>
                  </li>
                );
              })}
            </ul>
          )}
        </SettingsPreferenceGroup>

        <SettingsPreferenceGroup title={copy.manageLayout}>
          <SettingsPreferenceRow
            title={copy.snapTitle}
            hint={copy.snapHint}
          >
            <QuietSwitch
              checked={layout.layout.snap}
              ariaLabel={copy.snapTitle}
              onChange={layout.setSnap}
            />
          </SettingsPreferenceRow>
          <SettingsPreferenceRow
            title={copy.tidy}
            hint={copy.tidyHint}
          >
            <span className="settings-board-actions">
              <QuietButton size="compact" disabled={layout.locked} onClick={layout.tidy}>{copy.tidy}</QuietButton>
            </span>
          </SettingsPreferenceRow>
          <SettingsPreferenceRow
            title={copy.layoutLibTitle}
            hint={copy.layoutLibHint}
          >
            <span className="settings-board-actions">
              <QuietButton
                size="compact"
                disabled={cards.length === 0 || layout.locked}
                onClick={() => layout.createLayout(copy.layoutName(layout.library.items.length + 1))}
              >
                {copy.newLayout}
              </QuietButton>
              <QuietButton
                size="compact"
                disabled={layout.locked}
                onClick={() => layout.switchToLayout(layout.library.activeId)}
              >
                {copy.restoreSaved}
              </QuietButton>
              <QuietButton
                size="compact"
                disabled={layout.locked}
                onClick={() => layout.switchToLayout(FACTORY_LAYOUT_ID)}
              >
                {copy.factoryLayoutName}
              </QuietButton>
            </span>
          </SettingsPreferenceRow>
        </SettingsPreferenceGroup>
      </div>

      {addOpen ? (
        <AddCardDialog
          copy={copy}
          countOf={layout.countOf}
          locked={layout.locked}
          onAdd={layout.add}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </section>
  );
}
