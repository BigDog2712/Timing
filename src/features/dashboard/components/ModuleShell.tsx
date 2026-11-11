import { useId, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

/**
 * 四张卡共用的外壳：卡头（20 高 + 8 距）/ 四态 / 滚动区。
 *
 * 为什么要它（01 §4.7）：卡头的标题、空态、骨架、错误块**一字不差**，写四遍就是四处会
 * 各自漂移的地方（比如某天有人只给其中一张加了 `aria-busy`）。这里写一次。
 *
 * 四态口径（`02 §14`）：
 *   · `loading` → 骨架（`aria-busy`，骨架本身 `aria-hidden`，读屏只听到"忙碌"）
 *   · `empty`   → 一句 `emptyText`（`<p>` + `qp-empty`，不是空 div）
 *   · `error`   → **E2**：卡内一块 + 重试键，`data-error-layer="module"`
 *   · `ready`   → `children`
 *
 * `refreshErrorText` 是**另一个层**（E3）：有数据、但刷新失败 —— 只在卡头挂一个 12px 图标，
 * 不占版面、不动卡高。它和 `state` 不互斥地"另算一遍"：调用方从**同一个 status** 派生
 * （`status === "error" && hasData` 才有图标），这里只负责画。
 *
 * 卡头右侧只能二选一：`action`（可点）或 `meta`（只读读数）。两者同时给会让 20 高的
 * 卡头挤成两行，而卡头高是几何表锁死的值。
 */
export type ModuleState = "ready" | "empty" | "loading" | "error";

/**
 * `02 §14.4` 那个谓词的**唯一实现**（四张卡共用，别在卡里再写一遍）。
 *
 * 顺序不能改：E3（有数据但刷新失败）先于 E2（读失败且无数据）。
 *   ① status === "error" && !refreshError        → E2（卡内一块 + 重试）
 *   ② status === "error" &&  refreshError        → E3（卡头小图标），内容照旧画
 *   ③ status === "loading"                       → 骨架
 *   ④ 空                                          → 空态
 *   ⑤ 其它                                        → ready
 */
export function moduleState(status: LoadStatus, refreshError: boolean, isEmpty: boolean): ModuleState {
  if (status === "error") return refreshError ? (isEmpty ? "empty" : "ready") : "error";
  if (status === "loading") return "loading";
  return isEmpty ? "empty" : "ready";
}

/** 骨架条高取哪一条 `--qp-row-*`：不传 = `--qp-row-readout`（计时卡的 5 条读数） */
export type SkeletonRow = "items" | "app" | "todo";

interface Props {
  /** 与卡头 `<h2>` 的 id 配对，`section[aria-labelledby]` 靠它 */
  id: string;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  state: ModuleState;
  emptyText: string;
  skeletonRows?: number;
  /** 骨架条高必须等于该卡真实行高（见 `dashboard.css` 的骨架注释） */
  skeletonRow?: SkeletonRow;
  /** E2 的文案。**没有新 i18n 键**：复用 `UI_TEXT.common.readFailed` */
  errorText?: string;
  /** E2 的重试键文案（`UI_TEXT.common.retry`） */
  retryLabel?: string;
  /** 重试进行中：用 `aria-disabled`，**不用 `disabled`** —— 禁用会丢焦点 */
  retryBusy?: boolean;
  onRetry?: () => void;
  /** E3：有数据但刷新失败，卡头挂一个小图标 */
  refreshErrorText?: string;
  /** 需要额外定位上下文（待办卡的撤销条）时传进来 */
  className?: string;
  children: ReactNode;
}

export default function ModuleShell({
  id,
  title,
  meta,
  action,
  state,
  emptyText,
  skeletonRows = 5,
  skeletonRow,
  errorText,
  retryLabel,
  retryBusy,
  onRetry,
  refreshErrorText,
  className,
  children,
}: Props) {
  const errorId = useId();
  return (
    <section
      className={className ? `qp-card ${className}` : "qp-card"}
      aria-labelledby={id}
      aria-busy={state === "loading" || undefined}
      data-state={state}
    >
      <div className="qp-card-head">
        <h2 id={id} className="qp-card-title">{title}</h2>
        {/* 右槽只在 ready 渲染（R9 收口）：empty 的数是废话（空态文案已经说了）、
         *  error 的数不可信、loading 的数还没有。门控收在这里，四张卡就不可能再
         *  各写一遍然后漏一张（ItemsModule 那次漏掉 empty 印出「今日 0 项」就是
         *  散写守卫的必然结果）。h2 标题保持恒在（M12/M13）。 */}
        <span className="qp-card-head-right">
          {state === "ready" ? (
            <>
              {/* E3 只在这一层出现：条件渲染，不常驻空容器（常驻的 role=alert 挂载时就有内容，
                  读屏不会"出现即播报"）。refreshError 时 moduleState() 恰好返回 ready，所以
                  放进 ready 分支不会漏。 */}
              {refreshErrorText ? (
                <span className="qp-refresh-error" data-error-layer="refresh" role="alert" title={refreshErrorText}>
                  <AlertCircle size={12} strokeWidth={2} aria-hidden="true" />
                  <span className="sr-only">{refreshErrorText}</span>
                </span>
              ) : null}
              {action ?? (meta ? <span className="qp-card-meta">{meta}</span> : null)}
            </>
          ) : null}
        </span>
      </div>
      {state === "loading" ? (
        /* `data-row` 只决定条高（CSS）；**条数**由 tiers.css 的档位规则裁，不在这里读断点 */
        <div className="qp-skeleton" data-row={skeletonRow} aria-hidden="true">
          {Array.from({ length: skeletonRows }, (_, index) => <span key={index} />)}
        </div>
      ) : state === "error" ? (
        /* E2 同样**条件渲染**：错误块只在 error 时挂上，出现即播报 */
        <div
          className="qp-module-error"
          role="alert"
          data-error-layer="module"
          aria-labelledby={`${id} ${errorId}`}
        >
          <p id={errorId} className="qp-module-error-text">{errorText}</p>
          {onRetry ? (
            <button
              type="button"
              className="qp-link-btn"
              aria-disabled={retryBusy || undefined}
              onClick={retryBusy ? undefined : onRetry}
            >
              {retryLabel}
            </button>
          ) : null}
        </div>
      ) : state === "empty" ? (
        <p className="qp-empty">{emptyText}</p>
      ) : children}
    </section>
  );
}
