/**
 * 分析窗（原 Patina）的一次性落点参数（[P0-03]）。
 *
 * 从 `types/domain/ipc.ts` 拆出：那个文件是 `IpcApi` 的方法清单，撞 300 行门禁；
 * 这三个类型只与 `open_activity_window` 一条命令相关，与另外 94 个方法无关。
 * `ipc.ts` 仍原样 re-export，调用方一个都不改。
 *
 * 命名口径（FUSION-ARCH-v1 §6.6）：药丸窗口 label 是 `main`，分析窗是 `activity`——
 * 与 Rust 侧的定义一致。本类型描述「分析窗该落到哪里」，不是「哪个窗口」。
 */

/* ---- [P0-03] 宿主 → 分析窗的一次性落点（`open_activity_window` 的可选参数） ----
命名口径（FUSION-ARCH-v1 §6.6）：药丸窗口 label 是 `main`，分析窗是 `patina`——与 Rust
insight 侧的定义相反。本类型描述「分析窗该落到哪里」，不是「哪个窗口」。 */
export interface ActivityHistoryTarget {
  /** 本地日 `YYYY-MM-DD`（`src/lib/dateKey.ts` 的 `todayDateKey()`；禁用 UTC 截断） */
  dateKey: string;
  /** 可选：想在分析窗里聚焦的应用名（`History` 侧以高亮环消费，不做过滤/不滚动定位）。 */
  focusApp?: string | null;
}

export interface PatinaOpenTarget {
  history?: ActivityHistoryTarget; /* 历史页某天；与 overview 二选一（并存时 history 优先） */
  overview?: boolean; /* `true` = 分析窗总览页（P1-02：摘要面板页脚「在分析窗看总览」） */
  /* [V0.12.1][依赖 T03] `true` = 分析窗设置页。三键互斥，判序 history > settings > overview；
     Rust 侧 `PatinaOpenTarget` 是 deny_unknown_fields，T03 同批补这个字段之前会被拒收。 */
  settings?: boolean;
}

export interface ActivityOpenWindowParams {
  /** 省略 = 只把分析窗叫到前台（V0.12.0 原行为） */
  target?: PatinaOpenTarget | null;
}
