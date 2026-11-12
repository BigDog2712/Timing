import { useLocale } from "../../../shared/i18n/index.ts";
import { focusSessionCopy } from "../services/focusSessionCopy.ts";

/**
 * [P0-07] 「专注会话 · 不计入时间账」提示。
 *
 * 工具页里的番茄钟与自由专注在数据上是**专注会话**（宿主 `focus_history_groups` /
 * `focus_history_spans`），**不写 `time_records`**，所以既不出现在历史页的「Timing 计时」泳道，
 * 也不进任何时间账统计。而药丸上的倒计时 / 摸鱼 / 正计时是**计时**，写 `time_records`，进账。
 *
 * 两套东西在界面上原本都带「计时」二字，用户点错工具就会「明明坐了两小时，时间账里一分没有」。
 * 这句提示就是 PRD 要求的那句必须说清的话：**这件事到底记不记账**。
 *
 * 两个使用点（番茄钟页签、自由专注页签）各自渲染一份，所以每个页签上恰好有一句、不会叠加。
 * 文案集中在本目录 `../services/focusSessionCopy.ts`，**不动 `src/shared/i18n/generated/locales/**`**
 * （那四个 locale 是按索引对齐的位置数组，改一个位置会整体错位）。
 */
export default function FocusSessionLedgerNote() {
  const copy = focusSessionCopy(useLocale());

  return (
    <p
      className="m-0 flex shrink-0 flex-wrap items-baseline gap-x-2 text-[var(--qp-text-tertiary)]"
      data-tools-ledger="focus-session"
    >
      <span className="qp-weight-emphasis">{copy.ledger}</span>
      <span>{`· ${copy.hint}`}</span>
    </p>
  );
}
