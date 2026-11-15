import { useId, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import { useBoardInstance, withInstance } from "../layout/instanceContext.ts";

/**
 * 四张卡共用的外壳：卡头（20 高 + 8 距）/ 四态 / 滚动区。
 *
 * 为什么要它（01 §4.7）：卡头的标题、空态、骨架、错误块**一字不差**，写四遍就是四处会
 * 各自漂移的地方（比如某天有人只给其中一张加了 `aria-busy`）。这里写一次。
 *
 * 四态口径（`02 §14`）：
 *   · `loading` → 骨架（`aria-busy`，骨架本身 `aria-hidden`，读屏只听到"忙碌"）
 *   · `empty`   → 一句 `emptyText`（`<p>` + `at-empty`，不是空 div）
 *   · `error`   → **E2**：卡内一块 + 重试键，`data-error-layer="module"`
 *   · `ready`   → `children`
 *
 * `refreshErrorText` 是**另一个层**（E3）：有数据、但刷新失败 —— 只在卡头挂一个 12px 图标，
 * 不占版面、不动卡高。它和 `state` 不互斥地"另算一遍"：调用方从**同一个 status** 派生
 * （`status === "error" && hasData` 才有图标），这里只负责画。
 *
 * 卡头右侧只能二选一：`action`（可点）或 `meta`（只读读数）。两者同时给会让 20 高的
 * 卡头挤成两行，而卡头高是几何表锁死的值。
 *
 * ## 卡头右槽**没有**"常驻操作槽"（`headAction` 已下线）
 *
 * 上一版给待办卡加过一个 `headAction`：卡头右槽最左侧、四态常驻。它已经随「新建待办」
 * 搬到卡头下方那条通栏窄行（`subhead`）而下线 —— 右槽要同时摆「N 条待办」读数与 `⋯`
 * 控件，20px 高的头里再挤一颗文字键，读数就被压窄了（`TodosModule` 的原始理由）。
 * 现在全仓零调用点，留着这个 prop 就是"哪天有人顺手用回去"的入口，所以整段删掉：
 *
 *   · 想放**常驻**入口 → `subhead`（四态都在，卡头之下一整行）；
 *   · 想放**只在 ready** 出现的操作 → `action`；
 *   · 想放布局工具条 → `controls`。
 * 判据（渲染级 + 类型级）：`ModuleShellHeadSlot.test.tsx`。
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

/** 骨架条高取哪一条 `--at-row-*`：不传 = `--at-row-readout`（计时卡的 5 条读数） */
export type SkeletonRow = "items" | "app" | "todo";

interface Props {
  /** 与卡头 `<h2>` 的 id 配对，`section[aria-labelledby]` 靠它 */
  id: string;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  /** 卡头**下方**的独立一行（通栏、四态常驻）。
   *  为什么不是 `children`：`children` **只在 ready 渲染**，而「今天还没有待办」正是最该
   *  看到新建入口的时刻（待办卡的那条设计理由）。所以要一个"四态都在"、又在卡头之下的槽。
   *  不传 → 逐字等于旧形态（其余卡片一个像素都不变）。 */
  subhead?: ReactNode;
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
  /** [P1 · 0.12.1] 卡头右侧的布局工具条（上移/下移/切档/移除）。壳只提供位置，按钮在 layout/CardControls。 */
  controls?: ReactNode;
  /** 需要额外定位上下文（待办卡的撤销条）时传进来 */
  className?: string;
  /** [本轮] 四态之外的**常驻**底条：empty / error 时也要在场。
   *  为什么不在 `children` 里：`children` 只在 `ready` 渲染，而"今天还没有计时"正是
   *  最需要「＋ 新建事项」的时刻（时间线卡）。不传 → 逐字等于旧形态（其余五张卡）。
   *
   *  ⚠️ 底条里的入口若要**开弹层**，那些弹层必须挂在 `children` **之外**（兄弟位置）。
   *  挂在 children 里 = 空态下点得到、状态也改了，但消费它的组件没挂载：零报错零提示。
   *  时间线卡 0.13 · 1.6 就踩了这一脚（判据 `TimelineCardEntry.test.tsx`）。 */
  footer?: ReactNode;
  /** [0.13 · F2] 空态里**额外**渲染的视觉锚点（如计时分布卡的环底圈）。
   *  为什么要有：只渲染一句 `at-empty` 的话，"卡片是空的还是坏了"分不出来 ——
   *  一圈底环 + 「今日 0m」说的是"今天真的什么都没记"，而不是"卡挂了"。 */
  emptyVisual?: ReactNode;
  children: ReactNode;
}

export default function ModuleShell({
  id,
  title,
  meta,
  action,
  subhead,
  state,
  emptyText,
  skeletonRows = 5,
  skeletonRow,
  errorText,
  retryLabel,
  retryBusy,
  onRetry,
  refreshErrorText,
  controls,
  className,
  footer,
  emptyVisual,
  children,
}: Props) {
  const errorId = useId();
  /* [v3] 同一组件可以放多张：卡内 id 加实例后缀，否则两份 `t-todos` 会让
   * aria-labelledby 指到先出现的那张（改名后读屏就念错）。 */
  const instance = useBoardInstance();
  const domId = withInstance(id, instance);
  return (
    <section
      className={className ? `at-card ${className}` : "at-card"}
      aria-labelledby={domId}
      aria-busy={state === "loading" || undefined}
      data-state={state}
    >
      <div className="at-card-head">
        {/* [A 批] grip 是装饰层：pointer-events:none，不参与排版也不可点。
            本批不接 tabIndex/role=button —— 键盘锚点等拖拽批次一起做，
            现在给了就是一颗「能聚焦但按了没反应」的键。 */}
        <span className="at-card-grip" aria-hidden="true" />
        <h2 id={domId} className="at-card-title">{title}</h2>
        {/* 右槽只在 ready 渲染（R9 收口）：empty 的数是废话（空态文案已经说了）、
         *  error 的数不可信、loading 的数还没有。门控收在这里，四张卡就不可能再
         *  各写一遍然后漏一张（ItemsModule 那次漏掉 empty 印出「今日 0 项」就是
         *  散写守卫的必然结果）。h2 标题保持恒在（M12/M13）。 */}
        {/* [A 批] 右槽顺序 = meta 在前、⋯ 在后：读数贴左、操作贴右，「看」与「动」各占一端 */}
        <span className="at-card-head-right">
          {state === "ready" ? (
            <>
              {/* E3 只在这一层出现：条件渲染，不常驻空容器（常驻的 role=alert 挂载时就有内容，
                  读屏不会"出现即播报"）。refreshError 时 moduleState() 恰好返回 ready，所以
                  放进 ready 分支不会漏。 */}
              {refreshErrorText ? (
                <span className="at-refresh-error" data-error-layer="refresh" role="alert" title={refreshErrorText}>
                  <AlertCircle size={12} strokeWidth={2} aria-hidden="true" />
                  <span className="sr-only">{refreshErrorText}</span>
                </span>
              ) : null}
              {action ?? (meta ? <span className="at-card-meta">{meta}</span> : null)}
            </>
          ) : null}
          {controls}
        </span>
      </div>
      {/* 卡头之下的常驻行（四态都在）。放在四态分支**之前**，与 `state` 无关 */}
      {subhead}
      {state === "loading" ? (
        /* `data-row` 只决定条高（CSS）；**条数**由 tiers.css 的档位规则裁，不在这里读断点 */
        <div className="at-skeleton" data-row={skeletonRow} aria-hidden="true">
          {Array.from({ length: skeletonRows }, (_, index) => <span key={index} />)}
        </div>
      ) : state === "error" ? (
        /* E2 同样**条件渲染**：错误块只在 error 时挂上，出现即播报 */
        <div
          className="at-module-error"
          role="alert"
          data-error-layer="module"
          aria-labelledby={`${domId} ${errorId}`}
        >
          <p id={errorId} className="at-module-error-text">{errorText}</p>
          {onRetry ? (
            <button
              type="button"
              className="at-link-btn"
              aria-disabled={retryBusy || undefined}
              onClick={retryBusy ? undefined : onRetry}
            >
              {retryLabel}
            </button>
          ) : null}
        </div>
      ) : state === "empty" ? (
        emptyVisual ? (
          /* 有视觉锚点时环与文案**纵排在同一块**里。
             不能写成「一句 `at-empty` + 环」两个并列子项：`.at-empty` 是
             `flex: 1 1 auto`（它要独占整卡的剩余高度来居中），环跟在后面就只能溢出卡外
             被裁 —— 实际观感是"文字压在环上、环只剩上半截"（0.13 的计时卡）。 */
          <div className="at-empty-figure">
            {emptyVisual}
            <p className="at-empty">{emptyText}</p>
          </div>
        ) : (
          <p className="at-empty">{emptyText}</p>
        )
      ) : children}
      {footer}
    </section>
  );
}
