/**
 * [P0-07] 工具页「专注会话」侧的统一文案。
 *
 * ## 为什么需要这个文件
 *
 * 计时语义统一把应用里的「在跑的东西」劈成两类：
 *   · **专注会话**（番茄钟 / 自由专注）：写 `focus_history_*`，**不写 `time_records`**，不进时间账；
 *   · **计时**（倒计时 / 摸鱼 / 正计时）：写 `time_records`，进时间账。
 *
 * 但中文 locale 里 `tools.focusModePomodoro` 的值是「番茄**计时**」、`tools.pomodoroTaskEdit` 是
 * 「编辑番茄**计时**」、`tools.pomodoroTimingSettings` 是「**计时**设置」——同一个「计时」
 * 同时指了两件账目性质相反的事。locale 四个文件是按索引对齐的位置数组，**本轮不许动**，
 * 所以改名只能在组件侧做：把这几处文案集中在本文件覆盖掉，一个地方就能看清「哪些词被替换了」。
 *
 * ## 番茄模式为什么叫「番茄钟」而不是「番茄专注」
 *
 * 同一个页面上，模式页签与阶段按钮指的是**同一件事**：页签是模式名，按钮是「开始 / 暂停 /
 * 跳过番茄钟阶段」（locale idx 176–181）。如果页签叫「番茄专注」、按钮叫「番茄钟」，就在
 * 「专注 / 计时」这一维之外又造出「番茄专注 / 番茄钟」这一维的同义异名——正好违反 P0-07
 * 自己的验收口径。所以模式名回到仓库里已有的「番茄钟」家族：它不含「计时」二字（不违反
 * 进账劈分），又是通用说法，用户认得。
 *
 * 「专注设置」保留：它说的是设置的**归属**（这块设置属于专注会话），不是给番茄钟起第二个名字。
 * 「自由专注」也保留：它是**另一个模式**，与「番茄钟」并列而非同义。
 *
 * ## 为什么要单独一个 `createTitle`
 *
 * 两个页签的新建表单共用 locale 的 `tools.pomodoroTaskCreate`（idx 28 =「新建专注」）：
 * 在**自由专注**页签里这是对的（新建的就是一段自由专注），但在**番茄钟**页签里就成了
 * 「新建专注 / 编辑番茄钟」——同一个对象两个词。一个 key 服务两个模式，全局改必然弄错一边，
 * 所以只给番茄页签加这一个覆盖值，自由专注侧继续用 locale 原值。
 *
 * ## 边界
 *  · 纯文案常量 + 一个取值函数，不碰 IPC、不碰状态；
 *  · `locale` 只按 `zh*` 前缀二分（与 `HostTimingStatusRow` / `TimingCapsule` 同一口径），
 *    因为这里只要「中文 / 英文」两套，不需要 `SUPPORTED_LOCALES` 的完整四语。
 */

export interface FocusSessionCopy {
  /** 番茄钟页签的模式名。与阶段按钮的「番茄钟」同一家族，不许另起名字。 */
  focusModePomodoro: string;
  /** 番茄钟页签「新建」表单的标题（自由专注页签不用它，那边继续走 locale 的「新建专注」）。 */
  createTitle: string;
  /** 番茄任务编辑器标题。 */
  editTitle: string;
  /** 番茄时长选择器的字段名（说的是设置归属，不是模式名）。 */
  settingsTitle: string;
  /** 是否计入时间账 —— 每个专注会话页签上都必须有这一句。 */
  ledger: string;
  /** 替代方案：要进账该用哪个工具。 */
  hint: string;
}

export const FOCUS_SESSION_COPY = {
  zh: {
    focusModePomodoro: "番茄钟",
    createTitle: "新建番茄钟",
    editTitle: "编辑番茄钟",
    settingsTitle: "专注设置",
    ledger: "专注会话 · 不计入时间账",
    hint: "要算进时间账请用倒计时",
  },
  en: {
    focusModePomodoro: "Pomodoro",
    createTitle: "New Pomodoro",
    editTitle: "Edit Pomodoro",
    settingsTitle: "Focus settings",
    ledger: "Focus session · not counted in your time log",
    hint: "Use the countdown timer to log time",
  },
} as const satisfies Record<"zh" | "en", FocusSessionCopy>;

/** 按 locale 前缀取一套文案；非中文一律走英文（与标题栏胶囊同口径）。 */
export function focusSessionCopy(locale: string): FocusSessionCopy {
  return locale.startsWith("zh") ? FOCUS_SESSION_COPY.zh : FOCUS_SESSION_COPY.en;
}
