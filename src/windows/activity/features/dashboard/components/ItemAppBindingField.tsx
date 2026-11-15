/**
 * 「绑定应用」一栏（[0.13 fix] 「我启动了燕云，但没开始计时」）。
 *
 * ## 为什么这一栏必须存在
 *
 * 自动接管的规则本身没问题（`useAppBindingAutoTimer`），问题是**没有入口把应用绑到事项上**：
 * 应用视角的入口藏在应用排行卡的双击菜单里（「绑定事项」），事项视角这条腿是缺的。
 * 用户心里的顺序恰恰相反 —— "我要给『燕云』这件事绑上燕云"，于是打开事项编辑，什么也没有。
 * 所以这一栏挂在「编辑事项」弹层里，先选事项、再绑应用。
 *
 * ## 它与「应用排行卡 → 绑定事项」是同一份配置
 *
 * 同一个 1:1 键空间（`__app_item_binding::<exe>` → `{itemId}`，见 `services/appItemBinding.ts`），
 * 所以两边互相看得见。保存那一刻会镜像到宿主 `item_app`（`platform/runtime/itemAppBindingSync.ts`）
 * —— 那才是药丸判断"要不要接管"的表。
 *
 * ## 一条措辞纪律
 *
 * 说明句必须写「切到前台时会**自动开始计时**」，不能只写「绑定应用」：
 * 这一栏的存在价值就是让用户知道"绑了会发生什么"，而 bug 的原始表述正是
 * 「我启动了燕云，但未自动开始」。
 */
import { useMemo } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import QuietSelect from "../../../shared/components/QuietSelect.tsx";
import { APP_BINDING_COPY } from "../copyAppBinding.ts";
import { useItemAppBindings } from "../hooks/useItemAppBindings.ts";

interface Props {
  /** 当前选中的事项；`null` = 还没选事项（整栏不渲染） */
  itemId: number | null;
  /** 弹层是否打开：关着不读，免得每次开工具栏都扫一遍配置表 */
  enabled: boolean;
}

export default function ItemAppBindingField({ itemId, enabled }: Props) {
  const copy = APP_BINDING_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  const state = useItemAppBindings(itemId, enabled);

  /* 候选标签里带上「已绑在『X』」：键空间是 1:1，选它等于把那条绑定挪到本事项过来 ——
     不提示的话用户会以为"又多绑了一个"，回原事项却找不到它。 */
  const options = useMemo(
    () => [
      { value: "", label: copy.pickApp },
      ...state.candidates.map((row) => ({
        value: row.exeName,
        label: row.otherItemName
          ? `${row.appName} · ${copy.boundElsewhere(row.otherItemName)}`
          : row.appName,
      })),
    ],
    [copy, state.candidates],
  );

  if (itemId === null) return null;

  return (
    <div className="at-item-app-binding">
      <p className="at-item-app-binding-hint">
        <span className="at-item-app-binding-title">{copy.boundAppsTitle}</span>
        {" "}
        {copy.boundAppsHint}
      </p>
      <ul className="at-timeline-edit-list" aria-label={copy.boundAppsTitle}>
        {state.bound.map((row) => (
          <li key={row.exeName}>
            <div className="at-timeline-edit-choice">
              <span className="at-timeline-edit-name" title={row.appName}>{row.appName}</span>
              <button
                type="button"
                className="at-link-btn at-timeline-item-action"
                aria-label={`${copy.unbindApp} ${row.appName}`}
                onClick={() => state.unbind(row.exeName)}
              >
                {copy.unbindApp}
              </button>
            </div>
          </li>
        ))}
        {state.loading ? <li className="at-empty">{UI_TEXT.common.loading}</li> : null}
        {!state.loading && state.bound.length === 0 ? (
          <li className="at-empty">{copy.boundAppsEmpty}</li>
        ) : null}
      </ul>
      <div className="at-timeline-item-editor">
        <QuietSelect
          value=""
          options={options}
          onChange={(next) => {
            if (next) state.bind(next);
          }}
          ariaLabel={copy.pickApp}
          density="compact"
          disabled={state.candidates.length === 0}
          className="at-item-app-binding-select"
        />
      </div>
      {state.candidates.length === 0 && !state.appsFailed && !state.loading ? (
        <p className="at-item-app-binding-hint">{copy.appsEmpty}</p>
      ) : null}
      {state.appsFailed ? (
        <p className="at-timeline-manage-issue" role="status">{copy.appsLoadFailed}</p>
      ) : null}
      {state.saveFailed ? (
        <p className="at-timeline-manage-issue" role="status">{copy.saveFailed}</p>
      ) : null}
    </div>
  );
}
