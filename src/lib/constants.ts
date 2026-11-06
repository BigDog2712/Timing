/**
 * Timing — 交互阈值常量（对齐 docs/design/design-tokens.json `size.*`）
 * -----------------------------------------------------------------------------
 * 这些是**行为阈值**（毫秒/字符数），非视觉 Token，故以 TS 常量集中管理，
 * 与 design-tokens.json 的 size.longPressMs / clickMaxMs / debounceMs /
 * hoverTooltipMs / nameMaxChars 保持一致。
 */

/** 右键长按判定：>= 500ms 弹出上下文菜单 */
export const LONG_PRESS_MS = 500;

/** 右键单击判定上限：< 400ms = 结束并保存（400–500ms 不确定区视为单击） */
export const CLICK_MAX_MS = 400;

/** 连点去抖窗口：200ms 内的重复点击忽略 */
export const DEBOUNCE_MS = 200;

/** 收起态悬停 tooltip 延迟：300ms */
export const HOVER_TOOLTIP_MS = 300;

/** 事项名截断：11 个中文字符（或 22 个拉丁字符） */
export const NAME_MAX_CHARS = 11;

/** 待办标题入参上限（与后端 todo_create / todo_update 的 1-200 校验对齐） */
export const TODO_TITLE_MAX_CHARS = 200;

/**
 * 事项名**入参**上限（与后端 `ITEM_NAME_MAX_LEN` 同值 60）。
 *
 * 注意与上面的 `NAME_MAX_CHARS` 区分：那个是**显示截断**（11 个字符后省略号），
 * 这个是**校验上限**（超过即 `ITEM_NAME_TOO_LONG`，不静默截断入库）。
 * V0.3.0 之前只有前端 `maxLength`，后端不校验，IPC 可绕过 —— 现已两侧同值（ADR-018）。
 */
export const ITEM_NAME_MAX_CHARS = 60;

/** 结束态（ENDED）瞬时视觉确认保持时长：900ms */
export const ENDED_FLASH_MS = 900;

/**
 * [V0.3.1] 托盘双击高亮保持时长：2500ms。
 *
 * 与 CSS 动画配对使用 —— `.pill[data-highlight]` / `.dot[data-highlight]` 都是
 * 0.8s × 3 次（2.4s），这里留 100ms 余量再摘属性，避免最后一次闪烁被截断。
 * [V0.11.5] 圆点形态也要闪，常量从 PillBar 提到这里，两条形态共用同一个值。
 */
export const HIGHLIGHT_MS = 2500;

/* [V0.3.4] 原 `SHORT_RECORD_SEC = 60`（短记录「保存 / 丢弃」二选一的判定阈值）已删除：
   该弹条整体下架，阈值改由后端「最短记录时长」（`ReferenceSettings.minRecordSeconds`，
   默认 30s，用户可调）承担。二者不是同一件事——前者是**询问**的触发条件，
   后者是**记录**的门槛（低于即不入库）。见 ADR-023。 */

/** [V0.2.0] 倒计时「接近到点」提示窗口：剩余 ≤ 60s → 小条数字切 --color-warn */
export const COUNTDOWN_WARN_SEC = 60;

/** [V0.2.1] 整条拖动阈值：位移超过该值（物理像素）才判定为拖动，避免吃掉单击 */
export const DRAG_THRESHOLD_PX = 4;

/** [V0.2.1] 拖动后吞掉尾随 click 的窗口：拖完松手时那一次 click 不应触发组件功能 */
export const DRAG_CLICK_SWALLOW_MS = 240;

/** [V0.2.7] 浮层「指针离开即收」的宽限：跨过小条与浮层之间的空隙时不误收 */
export const HOVER_CLOSE_GRACE_MS = 420;

/** [V0.2.8] 事项窗「指针离开即隐藏」的宽限：跨过窗口边缘抖动时不误收 */
export const WINDOW_LEAVE_HIDE_MS = 420;

/** [V0.2.10] 滚轮一格对应的像素位移：Chromium/Windows 一格是 100 或 120，按 100 折；
 *  触控板的小 delta 攒够一格才步进，避免一次轻扫连跳数个 5 分钟档 */
export const WHEEL_NOTCH_PX = 100;
