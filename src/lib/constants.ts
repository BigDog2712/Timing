/**
 * TickBar — 交互阈值常量（对齐 docs/design/design-tokens.json `size.*`）
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

/** 结束态（ENDED）瞬时视觉确认保持时长：900ms */
export const ENDED_FLASH_MS = 900;

/** 短时计时确认阈值：< 60 秒结束时不静默保存，改问「要留下吗」 */
export const SHORT_RECORD_SEC = 60;

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
