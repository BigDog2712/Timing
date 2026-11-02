# IPC-CONTRACT-v3：事件契约（Rust → 前端）

> **本文件只定义「事件」**。命令与错误码仍以 `docs/phase2/IPC-CONTRACT-v2.md` 为准，
> v2 **未作废**，两者不重叠、不冲突。凡本文件与 v2 出现矛盾之处，以 `npm run check:contract`
> 的实际输出为最终裁决——它是唯一会自动执行的判定。

## 0. 为什么单独立一份

v2 把「命令」写得极细（60 个函数、15 个错误码），而**事件只有一句「见 §5.5」**。后果是实测出来的三条问题：

1. 前端 `IPC_EVENTS` 里有 3 个事件名是**手写的字符串字面量**，后端一个都没 emit（`app:open-settings` 为典型：前端一直订阅，后端从未发出，纯死常量）。
2. `browserMock` 缺 8 条命令（日记域 4 条 + 丢弃计时 + 日状态 2 条 + 便利贴清理），浏览器 dev 环境下这些链路直接走不通，但没人发现——因为没有覆盖度断言。
3. 事件名与 emit 点分布在 6 个文件里，靠人肉保持同步。

现在这三条都由 `scripts/check-contract.mjs` 机械校验（见 §4）。

## 1. 唯一事实来源

| 位置 | 承担什么 |
| --- | --- |
| `src-tauri/src/app/events.rs` | 11 个 `pub const` 事件名 + 5 个 emit 辅助函数 |
| `src/types/domain/ipc.ts` 的 `IPC_EVENTS` | 11 个前端键（V0.3.3 起**零例外**，见 §3） |
| `scripts/check-contract.mjs` | 断言两侧集合相等、字面量归零、mock 覆盖 65/65 |

事件名**只能**来自上述常量。后端 `.emit("字面量", ...)` 会被门禁直接判红。

## 2. 事件表

订阅窗含义：**main** = 主窗（小条），**note** = 便利贴窗，**all** = 所有窗口各自订阅（K-21：主窗不代转）。

| # | 事件名 | payload | 触发点（Rust） | 订阅窗 | 前端处理 |
| --- | --- | --- | --- | --- | --- |
| 1 | `timer:state-changed` | `TimerState` | `app::events::emit_timer_state`，在**每次计时状态迁移之后**调用（start / pause / resume / stop / discard / undo / switch / countdown 到点 / resolve_open） | main | `useTimerStore.setState` —— 权威状态，前端不自行推导 |
| 2 | `theme-changed` | `{ mode, accents }` | `app::events::emit_theme_changed`，`theme_set` / `accent_set` / `update_settings`（触及主题字段）之后 | all | `useThemeStore.apply`（K-21：各窗自订阅） |
| 3 | `countdown-finished` | `CountdownFinished { session, targetSec }` | `jobs::countdown`（到点）→ `emit_countdown_finished` | main | 瞬时提示 `倒计时 N 分钟已到点` + `flashEnded()` + `timerStore.refresh()` |
| 4 | `reminder-fired` | `Reminder` | `jobs::reminder`（±60s 窗口命中）→ `emit_reminder_fired` | main | `reminderActions.onFired`（±60s 聚合为一张浮出卡） |
| 5 | `note-window-opened` | `{ noteId: number }` | `commands::window_cmd::open_note_window` → `emit_note_window(true, ..)` | main | 占位订阅（主窗当前不展示计数，见下 §3 注释） |
| 6 | `note-window-closed` | `{ noteId: number }` | `window_cmd::close_note_window` / `note_cmd::note_delete` → `emit_note_window(false, ..)` | main | 同上 |
| 7 | `tray:highlight` | 无（`null`） | `app::tray`（托盘图标**双击**） | main | `highlightPill()` —— 小条按「高亮颜色」闪三下定位 |
| 8 | `app:open-new-note` | 无 | `app::tray`（「便利贴…」） | main | `openNewNote()` |
| 9 | `app:open-new-item` | 无 | `app::tray`（「新建事项…」） | main | `uiStore.openPanel('create')` |
| 10 | `todo-nudge` | `TodoNudge { todoId, title, remindAt, stage }` | `jobs::nudge`（T-15 轻提醒 / T-5 自动开始询问）→ `emit_todo_nudge` | main | `todoNudgeActions.onNudge`（同一张提醒浮出卡，按 `stage` 换正文与动作，ADR-030） |
| 11 | `md-sync:changed` | `MdSyncReport { at, imported, exported, kinds, errors }` | `jobs::md_sync`（轮询导入写回后）→ `emit_md_sync_changed` | main / todos / note | 按 `kinds` 刷新：`useAppBootstrap`（事项 + 计时）、`useTodayRecords` / `useRecordsData`（记录）、`TodosWindow`（事项 + 待办）、`NoteWindow`（当前便利贴，有未落盘编辑时不覆盖） |

emit 点合计 **11** 处（门禁输出 `emit 点 11` 即此数）。

> **V0.4.0 增量**：`md-sync:changed` 只在**真的从 Markdown 导入了数据**时发（`MdSyncReport.touched()`），
> 空轮询不发，避免每 2 秒打扰前端。payload 带 `kinds`，订阅方只刷新受影响的数据（ADR-033）。

> **V0.3.12 增量**：`todo-nudge` 承载待办的两级提醒（`stage=1` 开始前 15 分钟的轻提醒；
> `stage=2` 开始前 5 分钟的自动开始询问）。它与 `reminder-fired` 的分工是
> **待办 vs 事项**：待办的 `remind_at` 是「开始时间」，不再进通用到点提醒（ADR-030）。

> **V0.3.3 减量**：`shortcut:triggered` 随全局快捷键整体下架（ADR-022），事件数 10 → 9。
> 更早的 `tray:toggle-visibility` / `app:open-settings` / `app:open-common-items` 分别在
> V0.3.1（显隐功能删除）与 V0.3.x 的托盘 IA 改造中下架，本表已按现行代码校正。

## 3. 例外（必须是显式的）

1. **`note-window-opened` / `note-window-closed`** 的订阅方是空处理（`() => undefined`）。保留订阅的理由是「结构预留」：将来主窗要展示「已打开便利贴数」时在此对接，不必再改契约。它们**有**真实 emit 点，因此不属于死常量。

> **V0.3.3**：原第 1 条例外 `shortcut:triggered` 已随全局快捷键整体下架（ADR-022），
> `scripts/check-contract.mjs` 的 `EVENT_ALLOWLIST` 现为空 Map —— 此后**任何**前端声明的
> 事件都必须有真实 emit 点，不再有"特性关闭时先留着"这种口子。

## 4. 门禁规则（`npm run check:contract`）

| 规则 | 失败信息 | 说明 |
| --- | --- | --- |
| 命令数三方一致 | `命令：Rust N / IpcApi N / ipc.ts N / mock N` | `generate_handler!` 列表 = `IpcApi` 方法名（camelCase→snake_case）= `ipc.ts` 的 invoke 字符串 = `browserMock` 的键 |
| 错误码两侧一致 | `错误码：Rust N / 前端 N` | `error.rs` 的 `ErrorCode` 变体 = 前端 `ERROR_TEXT` 键 |
| 后端 emit 的事件前端必须声明 | 列出差集 | 漏声明 → 前端无从 listen |
| 前端声明的事件必须有 emit 点 | 列出差集（allowlist 除外） | 否则是死常量 |
| 禁止事件名字面量 | 列出 `.emit("xxx"` 位置 | 必须用 `events.rs` 常量 |
| mock 覆盖 | 列出缺失命令 | 浏览器 dev 的可用性下限 |

死常量判定用「常量标识符在同一文件出现 ≥2 次（声明 + 使用）」而不是纯文本匹配：像 `NOTE_WINDOW_OPENED` 这种被 `emit_note_window` 间接引用的常量，纯文本匹配会误报。

## 5. 增删事件的操作清单

新增一个事件时，一次改完这 5 处，否则门禁红：

1. `src-tauri/src/app/events.rs` — 加 `pub const` + 一个 emit 辅助函数（含 `log_warn!` 失败分支）。
2. 触发点调用辅助函数（不要直接 `app.emit`）。
3. `src/types/domain/ipc.ts` — 加 `IPC_EVENTS` 键；payload 类型加进 `types/domain/*.ts`。
4. `src/hooks/useAppBootstrap.ts` — 加 `useTauriEvent` 订阅。
5. 本文件 §2 事件表加一行（`check:contract` 不管文档，但文档不一致会误导下一个改的人）。

删除一个事件：反向操作。若「临时停用」，必须走 `EVENT_ALLOWLIST` 并写原因，**不允许**留着前端订阅让后端沉默。

## 6. 载荷口径约定

- **命名**：Rust 侧一律 `#[serde(rename_all = "camelCase")]`，因此 payload 是 `targetSec` / `noteId` / `itemId`，前端拿到的是 camelCase。
- **无载荷事件**：传 `null`，不要传空对象——前端 `useTauriEvent<T>(name, cb)` 的 `T` 写 `unknown`。
- **载荷只放「此刻已经算好的值」**：事件不是通知「去查一下」。例如 `timer:state-changed` 直接带完整 `TimerState`，前端不需要再 `getTimerState()` 补一刀（那会引入一次竞态）。
- **权威状态只有一个**：计时状态以 `timer:state-changed` 为唯一权威。其余事件（`countdown-finished` / `reminder-fired`）只描述「发生了一件事」，前端据此刷新而不是自行改状态。

## 相关文档

- `docs/phase2/IPC-CONTRACT-v2.md` — 命令与错误码（仍然有效）
- `docs/decisions/ADR-017.md` — 为什么把这些做成门禁
- `docs/reviews/2026-10-18-ARCH-ASSESSMENT.md` — 问题来源与验收标准（T22）
