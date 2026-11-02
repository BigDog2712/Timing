# TickBar IPC 契约 v2（Phase 2 锁定）

- Document ID: IPC-CONTRACT-v2
- Status: **Frozen for Phase 3**（Phase 3 前后端联调唯一依据）
- Owner: 高见远（首席架构师，mvp-dev-expert-team-architect）
- Date: 2026-10-16
- Upstream: `docs/Spec-v1.md` §5 / §6 / §13；`docs/phase1/ARCHITECTURE-v1.md` §7
- Downstream: `src/types/domain.ts`（前端 TS 类型）；`src-tauri`（Rust 命令 + serde DTO）
- 本项目**无 HTTP 后端、无 REST、无网络请求**。前后端契约 = Tauri `invoke` 命令（入参/出参）+ Rust `emit` 事件。本文件即本项目的"API 文档"。

---

## 0. 相对 v1 的差异清单（必须先读过再读下文）

| # | 变更点 | v1（ARCHITECTURE §7 / Spec 初稿） | v2（锁定） | 依据 |
|---|---|---|---|---|
| D-1 | `time_records.status` 枚举 | `'active' \| 'draft' \| 'saved'` | `'active' \| 'saved'`（**移除 `draft`**） | Spec §13 变更① |
| D-2 | 结束计时命令 | `stop_timer` 置 `draft`，再由 `confirm_stop` / `cancel_stop` 收尾 | `stop_timer` **直接置 `saved`**；**删除** `confirm_stop` / `cancel_stop`；**新增** `undo_stop` | Spec §13 变更① |
| D-3 | 部分唯一索引 | `UNIQUE(status) WHERE status IN ('active','draft')` | `UNIQUE(status) WHERE status = 'active'` | Spec §6 |
| D-4 | `TimerState.status` 枚举 | `'idle' \| 'running' \| 'paused' \| 'draft'` | `'idle' \| 'running' \| 'paused'` | Spec §13 变更① |
| D-5 | 错误码 | `TIMER_NO_DRAFT` | `TIMER_NO_UNDO` | Spec §5.1 |
| D-6 | 图标库口径 | 架构 1.57.0 / 设计 ≥0.460 不一致 | 唯一库 `lucide-react`，版本以安装实际解析为准 | Spec §13 变更③ |
| D-7 | 托盘 / 开机自启 | P1 | **P0-5 / P0-6（MVP）**；全局快捷键仍 P1 | Spec §13 变更② |
| D-8 | `TimerState` 字段 | 无实时时长字段 | 新增 `liveDurationSec`（服务端快照） | Spec §5.2「含实时累计时长」细化 |
| D-9 | P1 命令归属 | `create_manual_record` / `export_records_csv` 混在主表 | 移入「P1 预留（本期不实现）」，不属 MVP 契约 | Spec §5.2「唯一依据」 |
| D-10 | 记录级"未找到" | 无对应码 | `ITEM_NOT_FOUND` 语义扩展为「目标资源不存在」（事项或记录）；v2 记入待办建议新增 `RECORD_NOT_FOUND` | 见 §10 风险 R-3 |

> 若 Phase 3 发现本契约与 Spec 冲突：**先改 Spec，再改本契约，再改两端代码**（规格即契约）。

---

## 1. 通用约定

1. **命名**：命令名 `snake_case`；DTO 字段 `camelCase`（Rust 侧统一 `#[serde(rename_all = "camelCase")]`）；枚举字符串值按其定义（`SwitchMode` / `ResolveAction` 用 `snake_case`，状态枚举用小写单词）。
2. **返回**：所有命令返回 `Result<T, AppError>`。成功 → 直接返回值；失败 → 序列化为 `{ "code": "<ErrorCode>", "message": "<人类可读>" }`。
3. **调用出口**：前端**禁止组件内直接 `invoke`**，统一经 `src/services/ipc.ts`（集中 try/catch 与错误码映射，K-11）。
4. **时间戳**：epoch **毫秒**（Rust `i64`），UTC。**时长**：**秒**（Rust `i32`），向下取整。
5. **ID**：SQLite `INTEGER`，前端 `number`。系统事项「未归类」固定 `id=1`、`isSystem=true`。
6. **分页**：`page` 从 1 起（默认 1）；`limit` 默认 20，**上限 100**（超限按 100 截断）。
7. **时间范围过滤**：`from` **含**、`to` **不含**，作用字段 `started_at`；缺省即不设该边界。
8. **软删除**：所有查询默认过滤 `deleted_at IS NULL`；删除操作不物理删行（记录保留以供审计）。`resolve_open_record(discard)` 例外，见 §4.4。
9. **单一 active 约束**：全局最多一条 `status='active'` 会话，由 TimerService 保证 + `uq_records_open` 索引兜底。

---

## 2. 错误码清单（共 16 个）

> 组成：v0.1.0 锁定 11 个 + v0.2.0 新增 5 个 + v0.3.0 新增 1 个 − v0.3.1 下架 1 个
> （`ITEM_NAME_DUPLICATE`，事项改为允许同名，见 ADR-021）− v0.3.3 下架 1 个
> （`SHORTCUT_REGISTER_FAILED`，全局快捷键整体下架，见 ADR-022）+ v0.4.0 新增 1 个
> （`MD_SYNC_CONFIG_INVALID`，见 ADR-033）。
> 集合仍为**闭合**：新增与下架都必须同时改 `src-tauri/src/error.rs` 的 `as_str` 与前端
> `ErrorCode` 联合类型，`npm run check:contract` 会核对两侧逐字一致（ADR-018 / ADR-021 / ADR-022）。

### 2.1 v0.1.0 锁定（11）

| code | 触发条件 | 前端处理 | 可重试 |
|---|---|---|---|
| `DB_ERROR` | SQLite 读写失败 / 事务回滚 | 提示"数据保存失败"+ 记录日志；**内存数据不丢**；按退避重试 ≤3 次 | 是 |
| `ITEM_NOT_FOUND` | 目标资源不存在或已软删除（**事项**；扩展：**记录**，见 §10 R-3） | 刷新事项/记录列表 | 否 |
| `ITEM_NAME_EMPTY` | 事项名称为空或仅空白字符 | 表单内联提示 | 否 |
| `ITEM_SYSTEM_PROTECTED` | 删除 / 归档系统事项「未归类」(id=1) | 置灰操作 + 提示不可删除 | 否 |
| `TIMER_ALREADY_RUNNING` | 已存在 `active` 会话时尝试 `start_timer`；或 `undo_stop` 期间已开启新会话 | 忽略 / 提示先结束 | 否 |
| `TIMER_NOT_RUNNING` | 无 `active` 会话却调 `pause_timer` / `resume_timer` / `stop_timer` / `switch_item` | 忽略并同步状态 | 否 |
| `TIMER_NO_UNDO` | 撤销窗口已过期 / 记录非 `saved` / 记录已删除 | 关闭撤销条 + 同步状态 | 否 |
| `INVALID_DURATION` | `ended_at < started_at` | 兜底丢弃该次输入 / 记录 | 否 |
| `IO_ERROR` | 文件 / 系统调用失败（注册表自启、窗口操作、字体等） | 通用错误提示 | 视情况 |

### 2.2 v0.2.0 新增（5）

| code | 触发条件 | 前端处理 | 可重试 |
|---|---|---|---|
| `NOTE_NOT_FOUND` | 便利贴不存在或已软删除（`note_get` / `note_update` / `note_delete` / `open_note_window`） | 关闭该便利贴窗 | 否 |
| `TODO_NOT_FOUND` | 待办不存在或已软删除（`todo_update` / `todo_toggle`） | 刷新待办列表 | 否 |
| `WINDOW_LIMIT_EXCEEDED` | 同时打开的便利贴窗数达上限 20（K-14） | 提示「最多 20 张」并置灰入口 | 否 |
| `INVALID_TARGET_SEC` | 倒计时目标秒数 ≤0 或 >24h | 内联提示 + 落到合法预设 | 否 |
| `INVALID_COLOR` | 四色入参不是 `#RRGGBB` | 内联提示 + 保留原色 | 否 |

### 2.3 v0.3.0 新增（1）

| code | 触发条件 | 前端处理 | 可重试 |
|---|---|---|---|
| `ITEM_NAME_TOO_LONG` | 文本字段超上限：事项名 >60（`create_item` / `update_item`）、待办标题 >200（`todo_create` / `todo_update`）、便利贴正文 >4000（`note_create` / `note_update`） | 表单内联提示「输入内容过长」+ 光标留在原字段 | 否 |

> **为什么值得加第 17 码**：v0.2.0 起「超长」只能借用 `ITEM_NAME_EMPTY`，前端拿到
> code 后会高亮到「名称不能为空」分支——用户看着「名字太长」的报错却被告知「不能为空」。
> 语义错配的代价是每次都要靠 message 猜，而 message 不是契约的一部分。
> 详见 `docs/decisions/ADR-018.md`。

### 2.4 v0.4.0 新增（1）

| code | 触发条件 | 前端处理 | 可重试 |
|---|---|---|---|
| `MD_SYNC_CONFIG_INVALID` | Markdown 落点配置不合法：根目录为空、`file` 是绝对路径 / 含 `..`、`heading` 不是「# 标题文字」、同一 `kind` 重复、字段超长等（`md_sync_save`，以及插件启动头 `contributes.mdSync` 校验） | 设置 → 同步页原样展示原因并保留用户输入；不弹通用「数据库错误」 | 否（改配置后重试） |

> 为什么不用 `IO_ERROR`：这类失败是**用户配置写错**，不是磁盘 / 系统调用失败；
> 混用会让设置页把「路径写错」显示成「磁盘故障」。见 ADR-033。

---

## 3. 命令清单（总表）

> 前端 `ipc.ts` 方法名 = 命令名转 camelCase（如 `start_timer` → `startTimer`）。

### 3.1 事项域 Items

| 命令 | 入参 | 出参 | ipc.ts 方法 |
|---|---|---|---|
| `list_items` | `{ includeArchived?: boolean }` | `Item[]` | `listItems` |
| `create_item` | `{ name: string, color?: string }` | `Item` | `createItem` |
| `update_item` | `{ id: number, patch: ItemPatch }` | `Item` | `updateItem` |
| `archive_item` | `{ id: number }` | `Item` | `archiveItem` |
| `unarchive_item` | `{ id: number }` | `Item` | `unarchiveItem` |
| `delete_item` | `{ id: number }` | `void` | `deleteItem` |

### 3.2 计时域 Timer

| 命令 | 入参 | 出参 | ipc.ts 方法 |
|---|---|---|---|
| `start_timer` | `{ itemId?: number }` | `TimeRecord` | `startTimer` |
| `pause_timer` | `{}` | `TimeRecord` | `pauseTimer` |
| `resume_timer` | `{}` | `TimeRecord` | `resumeTimer` |
| `stop_timer` | `{}` | `TimeRecord` | `stopTimer` |
| `undo_stop` | `{ recordId: number }` | `TimeRecord` | `undoStop` |
| `get_timer_state` | `{}` | `TimerState` | `getTimerState` |
| `switch_item` | `{ itemId: number, mode: SwitchMode }` | `TimerState` | `switchItem` |

### 3.3 记录域 Records

| 命令 | 入参 | 出参 | ipc.ts 方法 |
|---|---|---|---|
| `list_records` | `{ itemId?: number, from?: number, to?: number, page?: number, limit?: number }` | `Paginated<TimeRecord>` | `listRecords` |
| `stats_summary` | `{ itemId?: number, from?: number, to?: number }` | `StatsSummary` | `statsSummary` |
| `update_record` | `{ id: number, patch: RecordPatch }` | `TimeRecord` | `updateRecord` |
| `delete_record` | `{ id: number }` | `void` | `deleteRecord` |

### 3.4 崩溃恢复 Recovery

| 命令 | 入参 | 出参 | ipc.ts 方法 |
|---|---|---|---|
| `resolve_open_record` | `{ action: ResolveAction, endAt?: number, includeGap?: boolean }` | `TimeRecord \| null` | `resolveOpenRecord` |

### 3.5 设置域 Settings

| 命令 | 入参 | 出参 | ipc.ts 方法 |
|---|---|---|---|
| `get_settings` | `{}` | `Settings` | `getSettings` |
| `update_settings` | `{ patch: Partial<Settings> }` | `Settings` | `updateSettings` |
| `set_autostart` | `{ enabled: boolean }` | `boolean` | `setAutostart` |
| `get_autostart` | `{}` | `boolean` | `getAutostart` |

### 3.6 快捷键域 Shortcut（V0.3.3 已下架）

> `register_shortcut` 于 V0.3.3 删除：全局快捷键整体下线（命令 / 模块 / DTO / 错误码 /
> 事件一起走，见 §12.5 与 `docs/decisions/ADR-022.md`）。本节保留标题只为不让后续
> 章节号整体位移（`common.rs` / ADR-020 等文档引用了 §3.7 / §4.7）。

### 3.7 窗口 / 系统域 Window & System

| 命令 | 入参 | 出参 | ipc.ts 方法 |
|---|---|---|---|
| `show_window` | `{}` | `void` | `showWindow` |
| `main_work_area` | `{}` | `WorkAreaDip` | `mainWorkArea` |
| `hide_window` | `{}` | `void` | `hideWindow` |
| `toggle_window` | `{}` | `void` | `toggleWindow` |
| `save_window_position` | `{ x: number, y: number }` | `void` | `saveWindowPosition` |
| `quit_app` | `{}` | `void` | `quitApp` |

### 3.8 插件 / Markdown 同步（V0.4.0）

| 命令 | 入参 | 出参 | ipc.ts 方法 |
|---|---|---|---|
| `plugin_list` | `{}` | `PluginListResult` | `pluginList` |
| `plugin_open_dir` | `{}` | `void` | `pluginOpenDir` |
| `md_sync_get` | `{}` | `MdSyncView` | `mdSyncGet` |
| `md_sync_save` | `{ config: MdSyncConfig }` | `MdSyncView` | `mdSyncSave` |
| `md_sync_run` | `{}` | `MdSyncReport` | `mdSyncRun` |
| `md_sync_open` | `{ kind: MdSyncKind }` | `void` | `mdSyncOpen` |

---

## 4. 命令详解（入参 / 出参 / 语义 / 错误码 / 事件）

### 4.1 事项域 Items

#### `list_items`
- 入参：`{ "includeArchived"?: boolean }`（默认 `false`）
- 出参：`Item[]`（排序 `sort_order ASC, name ASC`；默认过滤 `deleted_at IS NULL`；`includeArchived=false` 时仅返回 `status='active'`）
- 语义：读取事项列表。系统事项「未归类」始终包含。
- 错误码：`DB_ERROR`

#### `create_item`
- 入参：`{ "name": string, "color"?: string }`
- 出参：`Item`（`status='active'`、`isSystem=false`、`sortOrder` = 当前最大 `sort_order` + 1）
- 语义：新建事项。`name` trim 后为空 → `ITEM_NAME_EMPTY`；**允许同名**（ADR-021，事项靠 `id` 区分）。
- 错误码：`ITEM_NAME_EMPTY` / `DB_ERROR`

#### `update_item`
- 入参：`{ "id": number, "patch": { "name"?: string, "color"?: string, "sortOrder"?: number } }`
- 出参：`Item`（`updated_at` 刷新）
- 语义：部分更新（仅含字段被改）。`patch.name` 存在且 trim 空 → `ITEM_NAME_EMPTY`；改成与别的事项同名**允许**（ADR-021）。系统事项可改名。
- 错误码：`ITEM_NOT_FOUND` / `ITEM_NAME_EMPTY` / `DB_ERROR`

#### `archive_item`
- 入参：`{ "id": number }`
- 出参：`Item`（`status='archived'`）
- 语义：归档（软态，非删除）。系统事项 → `ITEM_SYSTEM_PROTECTED`。
- 错误码：`ITEM_NOT_FOUND` / `ITEM_SYSTEM_PROTECTED` / `DB_ERROR`

#### `unarchive_item`
- 入参：`{ "id": number }`
- 出参：`Item`（`status='active'`）
- 语义：取消归档。恢复后即使与现有 `active` 事项同名也**允许**（ADR-021，不再有「恢复即冲突」）。
- 错误码：`ITEM_NOT_FOUND` / `DB_ERROR`

#### `delete_item`
- 入参：`{ "id": number }`
- 出参：`void`
- 语义：软删除（`deleted_at = now`），**保留其历史记录**（记录 `item_id` 不变，仍归属该事项统计）。系统事项 → `ITEM_SYSTEM_PROTECTED`。若该事项正被 `active` 会话引用，允许删除，活动会话保留原 `item_id`。
- 错误码：`ITEM_NOT_FOUND` / `ITEM_SYSTEM_PROTECTED` / `DB_ERROR`

### 4.2 计时域 Timer

#### `start_timer`
- 入参：`{ "itemId"?: number }`（缺省 `1` = 未归类）
- 出参：`TimeRecord`
- 语义：新建 `active` 会话：`status='active'`、`started_at=now`、`running_since=now`、`accumulated_sec=0`、`ended_at=null`；并持久化 `lastItemId=itemId`。
- 前置：**无 `active` 会话**。
- 错误码：`TIMER_ALREADY_RUNNING` / `ITEM_NOT_FOUND` / `DB_ERROR`
- 事件：`timer:state-changed`

#### `pause_timer`
- 入参：`{}`
- 出参：`TimeRecord`（仍 `active`，`running_since=null`）
- 语义：冻结：`accumulated_sec += floor((now - running_since) / 1000)`；`running_since = null`。**不产生记录**。已在暂停态调用为**幂等 no-op**（返回当前记录，不报错）。
- 前置：存在 `active` 会话。
- 错误码：`TIMER_NOT_RUNNING` / `DB_ERROR`
- 事件：`timer:state-changed`

#### `resume_timer`
- 入参：`{}`
- 出参：`TimeRecord`（`active`，`running_since=now`）
- 语义：从暂停值继续：`running_since = now`。已在运行态调用为**幂等 no-op**。
- 前置：存在 `active` 会话（暂停态）。
- 错误码：`TIMER_NOT_RUNNING` / `DB_ERROR`
- 事件：`timer:state-changed`

#### `stop_timer`
- 入参：`{}`
- 出参：`TimeRecord`（`status='saved'`）
- 语义：**右键单击**。若在运行：先 `accumulated_sec += floor((now - running_since) / 1000)`、`running_since = null`；随即置 `status='saved'`、`ended_at=now`、冻结 `accumulated_sec`、`updated_at=now`。返回记录；前端据 `UNDO_WINDOW_MS = 3000` 开启撤销条。
- 前置：存在 `active` 会话。
- 错误码：`TIMER_NOT_RUNNING` / `INVALID_DURATION`（`ended_at < started_at` 兜底） / `DB_ERROR`
- 事件：`timer:state-changed`（`status='idle'`）

#### `undo_stop`
- 入参：`{ "recordId": number }`
- 出参：`TimeRecord`（`active`，`running_since=now`）
- 语义：撤销条「撤销」。**校验**：记录存在、`deleted_at IS NULL`、`status='saved'`、且 `now - ended_at <= UNDO_WINDOW_MS + 200`（服务端以 `ended_at` 为准，+200ms 容差）。**回滚**：`status='active'`、`ended_at=null`、`running_since=now`（**不回溯崩溃/停机间隙**）、`accumulated_sec` 保持不变（时长接续）、`item_id` 不变、`updated_at=now`。
- 前置：**当前无其他 `active` 会话**（否则 `TIMER_ALREADY_RUNNING`）。
- 错误码：`TIMER_NO_UNDO`（窗口过期 / 非 saved / 已删除） / `TIMER_ALREADY_RUNNING` / `DB_ERROR`
- 事件：`timer:state-changed`（`status='running'`）

#### `get_timer_state`
- 入参：`{}`
- 出参：`TimerState`
- 语义：查 `status='active' AND deleted_at IS NULL` 的会话：
  - 存在 → `session` 非空；`status = running_since != null ? 'running' : 'paused'`；`liveDurationSec = accumulated_sec + (running ? floor((now - running_since)/1000) : 0)`。
  - 不存在 → `status='idle'`、`session=null`、`liveDurationSec=0`。
  - `lastItemId` 取持久化的最近使用事项 id（默认 1）。
- 错误码：`DB_ERROR`

#### `switch_item`
- 入参：`{ "itemId": number, "mode": "end_and_start" | "just_switch" }`
- 出参：`TimerState`
- 语义：
  - `end_and_start`：将当前 `active` 会话置 `saved`（先冻结累计，`ended_at=now`），再新开一条 `active` 会话归属 `itemId`。**不开启撤销条**（显式分段，非误触）。
  - `just_switch`：仅将当前 `active` 会话的 `item_id` 改为 `itemId`，`running_since` 不变（时长连续、不计断）。
- 前置：存在 `active` 会话。
- 错误码：`TIMER_NOT_RUNNING` / `ITEM_NOT_FOUND` / `DB_ERROR`
- 事件：`timer:state-changed`

### 4.3 记录域 Records

#### `list_records`
- 入参：`{ "itemId"?: number, "from"?: number, "to"?: number, "page"?: number, "limit"?: number }`
- 出参：`Paginated<TimeRecord>`
- 语义：仅 `status='saved' AND deleted_at IS NULL`；`itemId` 精确过滤；`from <= started_at < to`；排序 `started_at DESC`；`page` 默认 1、`limit` 默认 20（上限 100）；`total` = 过滤后总数；`hasMore = page * limit < total`。
- 错误码：`DB_ERROR`

#### `stats_summary`
- 入参：`{ "itemId"?: number, "from"?: number, "to"?: number }`
- 出参：`StatsSummary`
- 语义：仅 `saved` 未删除；`totalSec = Σ accumulated_sec`；`recordCount` = 条数；`byItem` 按 `item_id` 聚合、`totalSec` 降序。
- 错误码：`DB_ERROR`

#### `update_record`
- 入参：`{ "id": number, "patch": { "itemId"?: number, "startedAt"?: number, "endedAt"?: number, "note"?: string } }`
- 出参：`TimeRecord`
- 语义：编辑已保存记录（改归属 / 时长 / 备注）。**仅 `status='saved'` 记录可编辑**；目标不存在、已删除或为 `active` → `ITEM_NOT_FOUND`（记录级"目标不存在"；active 会话请走 `switch_item` / `pause_timer` / `stop_timer`）。`patch` 同时含 `startedAt`/`endedAt` 且 `endedAt < startedAt` → `INVALID_DURATION`。改 `itemId` 需目标事项存在。`note` 长度 ≤ 500。
- 错误码：`ITEM_NOT_FOUND` / `INVALID_DURATION` / `DB_ERROR`

#### `delete_record`
- 入参：`{ "id": number }`
- 出参：`void`
- 语义：软删除单条记录（`deleted_at=now`）。**幂等**：记录不存在或已删除 → 静默成功。
- 错误码：`DB_ERROR`

### 4.4 崩溃恢复 Recovery

#### `resolve_open_record`
- 入参：`{ "action": "resume" | "close" | "discard", "endAt"?: number, "includeGap"?: boolean }`
- 出参：`TimeRecord | null`
- 语义：启动时检测到 `active` 会话，由前端弹「继续 / 结束 / 丢弃」后调用：
  - `resume`：保持 `active`；`running_since = now`（默认**不把崩溃停机时长计入**——崩溃前的 `running_since` 已被持久化但指向过去，必须重置）。返回记录。
  - `close`：置 `saved`；`ended_at = endAt ?? now`；`running_since = null`；默认**不补算崩溃间隙**，以最后落盘的 `accumulated_sec` 为最终时长（丢失 ≤30s）。返回记录。
  - `discard`：**软删除**（`deleted_at=now`）并置 `status='saved'`、`ended_at=now`（释放 `uq_records_open` 部分唯一索引，保证随后可开新会话）。返回 `null`。
  - **`includeGap`（V0.4.2，可选，默认 `false`）**：为真时把「退出期间」并入累计——
    `accumulated_sec += floor((目标时刻 − running_since) / 1000)`，目标时刻对 `resume` 是 `now`、
    对 `close` 是 `ended_at`。只在会话**当时正在跑**（`running_since` 非空）时生效：
    暂停中的会话没有流逝，补了等于把暂停算成工作。`discard` 一律忽略（记录不保留）。
    切到「计入」后 `resume` 的 `running_since` 仍重置为 `now`，不会重复累计。
- 无 `active` 会话时调用 → 返回 `null`（幂等）。
- 错误码：`DB_ERROR` / `INVALID_DURATION`（`endAt` 早于 `started_at`）
- 事件：`timer:state-changed`

### 4.5 设置域 Settings

#### `get_settings`
- 入参：`{}`，出参：`Settings`
- 语义：读取全部设置（默认值见 §5.4）。`autostartEnabled` 以注册表实际状态为准回填。
- 错误码：`DB_ERROR` / `IO_ERROR`

#### `update_settings`
- 入参：`{ "patch": Partial<Settings> }`，出参：`Settings`（返回合并后全量）
- 语义：部分更新。联动：`autostartEnabled` 变更即时写注册表（`alwaysOnTop` 自 V0.3.3 起恒定，
  不再是设置项，见 ADR-022）。
- [V0.3.9] `moyuPresets` 整表覆盖（顺序即展示顺序）；`itemsRecentCount` 钳到 1..10。
- 错误码：`DB_ERROR` / `IO_ERROR`

#### `set_autostart`
- 入参：`{ "enabled": boolean }`，出参：`boolean`（**实际生效状态**，用于纠正平台写入失败）
- 语义：开关开机自启：写/删 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 条目（经 `tauri-plugin-autostart`）。**关闭时必须完全移除，不留隐藏启动项**（AC-21）。
- 错误码：`IO_ERROR` / `DB_ERROR`

#### `get_autostart`
- 入参：`{}`，出参：`boolean`
- 语义：查询自启实际状态（读注册表）。
- 错误码：`IO_ERROR`

### 4.6 快捷键域 Shortcut（V0.3.3 已下架）

> 原 `register_shortcut`（`{ action, accelerator }` → `boolean`）已删除，语义与错误码一并失效；
> 见 §12.5 与 `docs/decisions/ADR-022.md`。章节标题为保持编号稳定而保留。

### 4.7 窗口 / 系统域 Window & System

#### `show_window` / `hide_window` / `toggle_window`
- 入参：`{}`，出参：`void`
- 语义：悬浮条显隐（由托盘调用）。`toggle_window` 依据当前可见性切换。显隐后 emit 对应事件使前端重置瞬时 UI（如收起展开面板）。
- 错误码：`IO_ERROR`

#### `save_window_position`
- 入参：`{ "x": number, "y": number }`，出参：`void`
- 语义：记录窗口位置，**逻辑像素**（物理像素需除 `scaleFactor`，K-6）。
- 错误码：`IO_ERROR`

#### `main_work_area`（ADR-020 新增）
- 入参：`{}`，出参：`WorkAreaDip`（`{ x, y, w, h }`，**DIP / 逻辑像素**）
- 语义：返回主条**当前所在显示器的工作区**（扣除任务栏），以主条窗口矩形与各显示器工作区
  的重叠面积取最大者；完全不在任何显示器内时回落到主显示器。
  前端 `lib/fitBounds.ts` 用它在主窗写入 CSS 令牌 `--fit-w` / `--fit-h`，替代已删除的
  固定 384×360 画布——浮层贴边钳制不再写死尺寸，而是「屏幕多大就多大」。
  窗口移动（`onMoved`）后重新取，跨屏自动跟随。
- 错误码：`IO_ERROR`
- 说明：只读，无副作用；不进入事件域。

#### `quit_app`
- 入参：`{}`，出参：`void`
- 语义：真正退出进程（`app.exit(0)`），仅托盘菜单「退出」调用。关闭窗口只 `hide_window`（K-5）。
- 错误码：`IO_ERROR`

### 4.8 插件 / Markdown 同步（V0.4.0）

#### `plugin_list`
- 入参：`{}`，出参：`PluginListResult`（`{ dir, plugins, quickTimers }`）
- 语义：扫描 dev → exe → user 三处插件目录（同 id 先到先得），返回磁盘事实；载入失败也列出并带 `error`。
- 错误码：`IO_ERROR` / `DB_ERROR`

#### `plugin_open_dir`
- 入参：`{}`，出参：`void`
- 语义：在资源管理器中打开用户插件目录（不存在则创建）。
- 错误码：`IO_ERROR`

#### `md_sync_get`
- 入参：`{}`，出参：`MdSyncView`（`{ installed, pluginId, pluginName, pluginVersion, today, config, status }`）
- 语义：读插件默认落点 + 用户保存的 KV 覆盖，附最近一次运行状态。
- 错误码：`DB_ERROR` / `IO_ERROR`

#### `md_sync_save`
- 入参：`{ config: MdSyncConfig }`，出参：`MdSyncView`
- 语义：校验并落 `settings` KV（`plugin.md-sync.config`），随后立即同步一次；单个落点失败写进 `status.bindings[].lastError`，不整体报错。
- 错误码：`MD_SYNC_CONFIG_INVALID` / `DB_ERROR` / `IO_ERROR`

#### `md_sync_run`
- 入参：`{}`，出参：`MdSyncReport`（`{ at, imported, exported, kinds, errors }`）
- 语义：按已保存配置强制同步一轮；错误逐条收集，不因一个落点失败而中断其他落点。
- 错误码：`DB_ERROR` / `IO_ERROR`

#### `md_sync_open`
- 入参：`{ kind: MdSyncKind }`，出参：`void`
- 语义：先同步一轮（补齐标题区块），再打开该 kind 的**今日文件**；文件仍不存在 → `IO_ERROR`。`kind` 未配置 → `MD_SYNC_CONFIG_INVALID`。
- 错误码：`MD_SYNC_CONFIG_INVALID` / `IO_ERROR` / `DB_ERROR`

---

## 5. DTO JSON 形状

> 字段名 `camelCase`；Rust 侧 `#[serde(rename_all = "camelCase")]`。以下为**权威形状**，`domain.ts` 必须严格一一对应。

### 5.1 Item

```jsonc
{
  "id": 1,
  "name": "写方案",
  "color": "#RRGGBB",          // hex 字符串（用户数据，非设计 token）| null
  "status": "active",           // "active" | "archived"
  "isSystem": false,            // true 仅「未归类」(id=1)
  "sortOrder": 0,
  "createdAt": 1760000000000,   // epoch 毫秒
  "updatedAt": 1760000000000
}
```

### 5.2 TimeRecord

```jsonc
{
  "id": 10,
  "itemId": 1,
  "status": "saved",                // "active" | "saved"（draft 已移除）
  "startedAt": 1760000000000,       // epoch 毫秒
  "endedAt": 1760000180000,         // active 时为 null
  "accumulatedSec": 180,            // 累计已计秒
  "runningSince": null,             // 非 null = 当前段起点(epoch ms)；null = 暂停或已结束
  "note": null                      // string | null，长度 ≤ 500
}
```

### 5.3 TimerState

```jsonc
{
  "status": "idle",                 // "idle" | "running" | "paused"
  "session": null,                  // TimeRecord | null（running/paused 时非空）
  "lastItemId": 1,                  // number | null
  "liveDurationSec": 0              // 服务端快照：accumulatedSec + (running ? now-runningSince : 0)
}
```

### 5.4 Settings

```jsonc
{
  "autostartEnabled": false,
  "lastDisplayId": null,            // string | null（显示器标识）
  // V0.3.3 下架：alwaysOnTop（窗口恒定置顶）/ opacityEnabled（感知壁纸）/ shortcuts（全局快捷键）
  "themeMode": "dark",              // "dark" | "light" | "system"
  "accents": { "running": "#4DA3E8", "warn": "#E8A33D", "done": "#4CC38A", "bar": null },
  "countdownPresets": [300, 900, 1500, 1800, 2700, 3600],
  // V0.3.4 下架：countdownAutoEnd（倒计时到点恒结束并保存，ADR-023）
  // [V0.3.9] 常用摸鱼（应用内置，顺序即菜单顺序；settings KV `moyu.presets` 的 JSON 数组）
  "moyuPresets": [
    { "id": "factory-toilet", "item": "上厕所", "minutes": 10, "mode": "countdown" },
    { "id": "factory-moyu", "item": "摸鱼", "minutes": 25, "mode": "countdown" },
    { "id": "factory-meal", "item": "吃饭", "minutes": 60, "mode": "countdown" }
  ],
  // [V0.3.9] 常用事项框偏好：是否显示最近编辑 + 条数（1..10）
  "itemsShowRecent": true,
  "itemsRecentCount": 5,
  // [V0.3.9] 常用事项默认倒计时：itemId → 分钟（有值 = 点它起倒计时，无值 = 正计时）
  // 整表覆盖语义；服务端归一化（itemId > 0、分钟 1..1440），越界项直接丢弃
  "itemsTimers": { "2": 25 }
}
```

> [V0.3.9] `moyuPresets` 为整表覆盖语义：写入即全量替换，服务端归一化
> （空名丢弃 / 名称 ≤ 40 字 / 分钟 1..1440 / id 去重 / 最多 20 条）。
> 键缺失或 JSON 损坏 → 出厂三条；**空数组是合法值**（用户删光），不回落默认。

### 5.5 StatsSummary

```jsonc
{
  "totalSec": 5400,
  "recordCount": 12,
  "byItem": [ { "itemId": 1, "totalSec": 3600 } ]
}
```

### 5.6 Paginated<T>

```jsonc
{ "items": [], "total": 100, "page": 1, "limit": 20, "hasMore": true }
```

### 5.7 AppError

```jsonc
{ "code": "ITEM_NAME_EMPTY", "message": "事项名称不能为空" }
```

---

## 6. 事件清单（Rust → 前端 emit）

| 事件名 | Payload | 触发时机 | 前端应做 |
|---|---|---|---|
| `timer:state-changed` | `TimerState` | `start_timer` / `pause_timer` / `resume_timer` / `stop_timer` / `undo_stop` / `switch_item` / `resolve_open_record` | 直接以 payload 覆盖本地 timer store（**权威状态**） |
| `tray:toggle-visibility` | `{}` | 托盘左键单击切换显隐 | 重置瞬时 UI（收起展开面板等） |
| `app:open-settings` | `{}` | 托盘菜单「设置」要求打开设置 | 打开设置面板 |
| `app:open-new-item` | `{}` | 托盘菜单「新建事项」要求新建 | 打开新建事项入口 |

> V0.3.3：`shortcut:triggered` 已随全局快捷键下架（ADR-022）；`app:open-settings` 亦已废弃
> （托盘「设置」改为 Rust 侧直接建窗，见 `docs/phase2/IPC-CONTRACT-v3.md` §2）。
> 现行事件清单**以 `IPC-CONTRACT-v3.md` 为准**。

> 事件订阅纪律：`listen()` 返回的 `unlisten` **必须在 `useEffect` 清理函数中调用**（K-8），避免 WebView 重载后残留。

---

## 7. 状态机

### 7.1 计时状态机（TimerState.status）

```
        start_timer
  idle ───────────────▶ running
   ▲                     │  ▲
   │                     │  │ resume_timer
   │        pause_timer  ▼  │
   │                   paused
   │                     │
   │   stop_timer        │ stop_timer
   └─────────────────────┘
        (record → saved)

  idle ──undo_stop──▶ running        （3s 撤销窗口内）

  running/paused ──switch_item(end_and_start)──▶ running（新会话，旧会话 saved）
  running/paused ──switch_item(just_switch)───▶ 原状态（仅改归属）
```

### 7.2 记录生命周期（TimeRecord.status）

```
(none) ──start_timer──▶ active(running_since≠null)
active(running) ──pause_timer──▶ active(running_since=null)
active(任意)     ──stop_timer──▶ saved ──┐
                                         │ undo_stop（≤3s）
   saved ◀───────────────────────────────┘
        │
        └─(窗口过期)─▶ saved（终态）

active ──resolve_open_record(resume)──▶ active
active ──resolve_open_record(close)───▶ saved
active ──resolve_open_record(discard)─▶ soft-deleted + saved（终态，返回 null）
```

不变式（DB CHECK 兜底）：`ended_at IS NULL OR ended_at >= started_at`；`(status='active') = (ended_at IS NULL)`；全局 ≤1 条 `status='active'`。

---

## 8. 撤销窗口语义（UNDO_WINDOW_MS = 3000）

1. `stop_timer` 返回后，前端立即渲染撤销条，启动 3000ms 计时。
2. 窗口内点「撤销」→ 调 `undo_stop({ recordId })`；成功后状态回 `running`、累计接续、撤销条消失。
3. 窗口过期 → 前端关闭撤销条；记录保持 `saved`；界面回 `idle`（AC-07）。
4. **服务端为准**：`undo_stop` 以记录 `ended_at` 与服务器 `now` 校验窗口（+200ms 容差），前端计时仅用于 UI。
5. 窗口内用户若已点开始新计时 → `undo_stop` 返回 `TIMER_ALREADY_RUNNING`（不允许两条 active）。
6. 常量：`UNDO_WINDOW_MS = 3000`（前端与 Rust 侧常量同名同值，须一致）。

---

## 9. P1 预留（本期**不实现**，仅登记接口，禁止镀金）

| 命令 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `create_manual_record` | `{ itemId, startedAt, endedAt, note? }` | `TimeRecord` | 补录被忘记的记录（PRD P1-2） |
| `export_records_csv` | `{ itemId?, from?, to? }` | `{ path: string }` | 导出 CSV（PRD P1-3） |

> **V0.3.3**：原 P1 预留的「全局快捷键」整组（`register_shortcut` /
> `SHORTCUT_REGISTER_FAILED` / `shortcut:triggered` / `Settings.shortcuts` /
> `unregister_shortcut` / 默认加速键表）**整体下架，不保留占位**——占位两年无人消费，
> 只会在每次契约评审时被当成"已有能力"数进去。要恢复须重新走契约评审 + 新 ADR
> （见 `docs/decisions/ADR-022.md`）。

---

## 10. Phase 3 一致性校验清单与风险

### 10.1 交付前自检（缺一即退回）
- [ ] 全部 65 个命令在 Rust `invoke_handler` 注册（含 §11 / §12 / §3.8 增量；V0.3.4 下架日记域 4 条、V0.4.0 新增 md-sync 4 条后的现值），且命令名与本文一致。
- [ ] 16 个错误码在 `error.rs` 全部可序列化，无 `unwrap()` 泄漏 panic。
- [ ] `domain.ts` 每个字段与 §5 DTO 一一对应（含 `null` 联合类型）。
- [ ] 全项目无 `draft` 残留（命令、DTO、SQL、迁移、类型、文案）。
- [ ] 全项目无 `confirm_stop` / `cancel_stop` 残留。
- [ ] `uq_records_open` 定义为 `UNIQUE(status) WHERE status='active'`。
- [ ] 前端无组件内直接 `invoke`（全部经 `ipc.ts`）。
- [ ] `listen()` 均有配对 `unlisten`（K-8）。

### 10.2 需 Phase 3 特别注意的风险
- **R-1 撤销与新计时的竞态**：3s 窗口内用户可能已开始新会话。`undo_stop` 必须以服务端 `TIMER_ALREADY_RUNNING` 拒绝并让前端提示，绝不能出现两条 `active`（否则触发 `uq_records_open` 写失败）。
- **R-2 崩溃恢复时的时长口径**：`resume` 必须重置 `running_since=now`、`close` 不得补算崩溃间隙；否则会把停机时长计入，违背「丢失 ≤30s」（AC-14）。
- **R-3 记录级"未找到"复用 `ITEM_NOT_FOUND`**：MVP 11 码无 `RECORD_NOT_FOUND`，`update_record` / `delete_record` 记录级缺失暂用 `ITEM_NOT_FOUND`。建议 v2 增码；Phase 3 前端在收到该码时刷新列表即可，勿假设一定是事项。
- **R-4 `liveDurationSec` 与前端本地推算需一致**：前端 tick 公式必须与 `get_timer_state` 的服务端公式完全一致（`accumulatedSec + floor((now-runningSince)/1000)`），否则状态同步瞬间数字会跳变。
- **R-5 `discard` 必须改 `status`**：软删除 `active` 记录而不改 `status` 会永久占用 `uq_records_open` 的唯一槽，导致此后无法开新会话（见 §4.4）。

> 口径说明（2026-10-20）：§2 的「11 个错误码」与 §10.1 的「29 个命令」是 MVP 锁定值；当前实装
> **65 命令 / 16 错误码**（含 ADR-020 新增的 `main_work_area`；ADR-021 下架 `ITEM_NAME_DUPLICATE`；
> ADR-022 下架 `register_shortcut` / `set_always_on_top` / `SHORTCUT_REGISTER_FAILED`；
> ADR-023 下架日记域 4 条命令）。
> 以代码为准的机械校验由 `npm run check:contract` 执行（比对 `lib.rs` / `domain.ts` / `ipc.ts` /
> `error.rs` 四处），本文档的人工数字不再作为门禁。

---

## 11. 实装增量命令（0.2.4–0.2.10，未回写 Spec §5）

> 以下 10 个命令已在三处实现中生效（其中日记域 4 条已于 V0.3.4 下架，见下表与 §12.6），
> Spec §5 保持 0.2.0 锁定口径。命令名为 IPC 线缆名（snake_case）。

| 命令 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `daily_status_get` | `date: String`（`YYYY-MM-DD`） | `Record<number, 'pending' \| 'done'>` | 今日逐行状态；无记录返回空对象 |
| `daily_status_set` | `date`、`itemId: i64`、`status: 'pending' \| 'done'` | `void` | 非法 status 由服务层拒绝 |
| ~~`diary_get_config`~~ | — | ~~`DiaryConfig`~~ | **[V0.3.4 已下架]** 日记域整体下架（ADR-023）：命令、`DiaryConfig` / `TodayDiary` DTO、前后端实现与设置页「日记」页签全部删除。配置存于 `settings` KV 的 `diary.*` 四行（**从无独立表**），历史行保留只读不删 |
| ~~`diary_set_config`~~ | ~~`config: DiaryConfig`~~ | ~~`DiaryConfig`~~ | 同上（下架） |
| ~~`diary_today`~~ | — | ~~`TodayDiary`~~ | 同上（下架） |
| ~~`diary_open_today`~~ | — | ~~`TodayDiary`~~ | 同上（下架） |
| `discard_timer` | — | `void` | 放弃当前会话：置 `saved` + 软删释放唯一槽，不写待办联动；随后发 `timer-state-changed` |
| `get_reference_settings` | — | `ReferenceSettings`（17 字段） | 读 `timing.*` 键。**`minRecordSeconds` 默认 30 秒**（V0.3.4，原 5）：低于此时长的**非显式保存**会话不记录（手动结束 / 切换事项分段；倒计时到点与崩溃恢复的「结束并保存」不受限，见 ADR-023）；其余字段仍为「已决策未实装」 |
| `update_reference_settings` | `patch: ReferenceSettingsPatch` | `ReferenceSettings` | 同上；设置页「通用 → 最短记录时长」数字输入框写 `minRecordSeconds`（5–300，手动输入整数，单位 S） |
| `open_timer_window` | — | `void` | 打开 280×180 只读 Timer 窗（`timer` label） |

补充的行为口径：

- `start_timer` / `start_countdown` 的并发唯一槽冲突（`uq_records_open`）在仓储层被翻译为 `TIMER_ALREADY_RUNNING`，不再冒泡 `DB_ERROR`。
- `stop_timer` / `switch_item(end_and_start)` 结束 0 行（会话已被并发结束）返回 `TIMER_NOT_RUNNING`，事务随之回滚，不再「静默成功」。

---

## 12. V0.3.0 契约增量

> 本节只登记**相对 v2 的差异**，不重复上文已写的命令与语义。
> 版本链：v2（Phase 2 锁定）→ v0.2.0 增量（§11）→ **v0.3.0 增量（本节）**。

### 12.1 错误码：16 → 17 → 16

`ITEM_NAME_TOO_LONG` 见 §2.3。影响命令：`create_item` / `update_item` / `todo_create` /
`todo_update` / `note_create` / `note_update`（语义见 §2.3 表）。

同时**补上一条此前缺失的后端校验**：`create_item` / `update_item` 的 `name` 上限 60 字符
（此前只有前端 `maxLength`，直接调 IPC 可存进任意长名称；而托盘按显示宽度截断，
数据与展示会不一致）。前端常量 `ITEM_NAME_MAX_CHARS`（`src/lib/constants.ts`）与
后端 `ITEM_NAME_MAX_LEN`（`src-tauri/src/models/constants.rs`）同值，改动需两侧同步。

**v0.3.1 回落到 16（ADR-021）**：事项允许同名，`ITEM_NAME_DUPLICATE` 不再有触发点，
从闭集下架。影响命令：`create_item` / `update_item` / `unarchive_item`（错误码列已同步 §4.1）。
`ItemPicker` 的 duplicate 态与「直接使用该事项」按钮一并删除。

### 12.2 DTO：`Note` 新增 `isPinned`

| 字段 | 类型 | 说明 |
|---|---|---|
| `isPinned` | `boolean` | 便利贴窗口是否置顶（AC-64）。列 `notes.is_pinned`，`DEFAULT 1` |

- `note_update` 的 `NotePatch` 新增可选 `isPinned?: boolean`（缺省 = 不改）。
- 该字段是**窗口层级**，不是列表排序：`items.isPinned`（固定任务置顶）是另一回事，
  两者只是名字像。
- 落库后由命令层把最新值推给窗口（`infra::window_note::apply_note_pin`），因此「改库」与
  「改层级」在同一次调用里完成；窗口未打开时跳过，下次 `open_note_window` 按列值建窗。
- 这是**便利贴自己的**窗口层级，与 V0.3.3 删除的 `set_always_on_top`（主窗全局置顶开关）无关：后者固定为 `true`，前者仍逐窗可切。

### 12.3 数据库：schema.version 2 → 3

迁移 `0003_v030.sql` + `MIGRATE_COLUMNS_V3`（`PRAGMA table_info` 守卫，
SQLite 无 `ADD COLUMN IF NOT EXISTS`，K-13）。`notes.is_pinned` 默认 1，
老便利贴升级后仍是置顶（与 V0.2.x 硬编码 `always_on_top=true` 行为一致）。

### 12.4 已失效的 v2 条目（就地标注，避免与新实现冲突）

| 原表述 | 现行 |
|---|---|
| 附录 A 放行 `sql:allow-*` / `store:allow-*` | **已移除**：前端从未引用这两个插件，放行等于给前端开一条绕过四层的直连库通道（ADR-015） |

### 12.5 V0.3.3 契约减量（ADR-022）

> 本节登记**下架**，与 §12.1 的「加码」相对。三处数字同步变小，`check:contract` 的
> 输出即验收依据。

| 面 | 变更 | 理由 |
|---|---|---|
| 命令 | 66 → **64**：删 `register_shortcut`、`set_always_on_top` | 全局快捷键整体下线；窗口恒定置顶（「保持窗口置顶」开关删除） |
| 错误码 | 16 → **15**：删 `SHORTCUT_REGISTER_FAILED` | 唯一触发点在 `infra/shortcuts.rs`，模块已删 |
| 事件 | 10 → **9**：删 `shortcut:triggered` | 该事件从未有 emit 点（`EVENT_ALLOWLIST` 的唯一例外），随功能一并清掉 |
| DTO | `Settings` 删 `alwaysOnTop` / `opacityEnabled` / `shortcuts` | 三个字段都只服务于已删除的开关 |
| 模块 | 删 `src-tauri/src/infra/shortcuts.rs`、`window.rs::set_always_on_top`、`services/settings.rs::set_always_on_top` | 无调用者即删，不留死代码 |

> 数据库里 `ui.always_on_top` / `ui.opacity_enabled` / `shortcut.*` 的历史行**保留只读不删**
> （迁移文件一律不改，没人再读即无害）。

### 12.6 V0.3.4 契约减量（ADR-023）

> 与 §12.5 同格式：本节只登记**下架**。三处数字同步变小（命令 64 → 60），
> `check:contract` 的输出（`命令 61 / 61 / 61 / 61`）即验收依据。

| 面 | 变更 | 理由 |
|---|---|---|
| 命令 | 64 → **60**：删 `diary_get_config`、`diary_set_config`、`diary_today`、`diary_open_today` | 日记模块整体下架：唯一入口是设置页「日记」页签，功能从未闭环；`TodayDiaryWindow` 是零挂载点的死组件 |
| 命令返回 | `stop_timer`：`TimeRecord` → **`StopResult{ record, discarded }`** | 新增「最短记录时长」：低于阈值的非显式保存会话不保存（手动结束 / 切换事项分段），前端据此不展示撤销条；倒计时到点与崩溃恢复的「结束并保存」不受限 |
| DTO | `Settings` 删 `countdownAutoEnd`；删 `DiaryConfig` / `TodayDiary`；新增 `StopResult` | 倒计时到点恒保存（无开关）；日记域 DTO 随命令一并删除 |
| 模块 | 删 `commands/diary_cmd.rs`、`services/diary.rs`、`models/diary.rs`、`services/settings.rs::countdown_auto_end`、`models/constants.rs::KEY_COUNTDOWN_AUTO_END` | 无调用者即删，不留死代码 |
| 数据 | 无表变更：日记配置走 `settings` KV（`diary.vault_root` / `diary.relative_dir` / `diary.file_name_format` / `diary.editor_path`），**从无独立表** | 历史迁移一律不改；四行 KV 保留只读不删，服务层不再读写即无害 |
| 文档口径 | 设置页签固定三项：外观配色 / 插件 / 通用 | 「扩展」改名「插件」且不再展示内置快捷计时 |

### 12.7 V0.4.0 契约增量（ADR-033）

| 面 | 变更 | 理由 |
|---|---|---|
| 命令 | 61 → **65**：新增 `md_sync_get` / `md_sync_save` / `md_sync_run` / `md_sync_open` | 首个 v2 插件 `md-sync` 的落点配置 + 手动同步 + 打开今日文件 |
| 事件 | 10 → **11**：新增 `md-sync:changed` | 文件侧导入写回 SQL 后，前端按 `kinds` 刷新事项 / 记录 / 待办 / 便利贴 |
| 错误码 | 15 → **16**：新增 `MD_SYNC_CONFIG_INVALID` | 落点配置错误要与 `DB_ERROR` / `IO_ERROR` 区分 |
| DTO | 新增 `MdSyncBinding` / `MdSyncConfig` / `MdSyncStatus` / `MdSyncView` / `MdSyncReport`；`PluginInfo` 新增 `mdSync` | 插件声明落点、设置页展示状态 |
| 插件 | `PLUGIN_API_VERSION` 1 → **2**；`contributes.mdSync` | 保持声明式：插件只声明，宿主执行同步 |
| 数据 | 无表变更：配置存 `settings` KV `plugin.md-sync.config` | 不新增迁移；KV 缺失时用插件默认落点 |
| 前端 | 设置页签 3 → **4**：外观配色 / 插件 / 同步 / 通用 | 「同步」只服务于已安装的 md-sync 插件 |
| 权限 | 新增 `dialog:allow-open` | 原生文件夹选择；不引入 `fs` 读写能力 |

---

## 附录 A：capabilities 最小权限白名单（MVP，锁定）

> 依据 Spec §10「安全：`capabilities` 最小权限白名单」与坑 K-4（插件命令运行时被拒）。Phase 3 实现 `src-tauri/capabilities/default.json` 时按本表逐项放行；**本表之外不放行**。
>
> **[V0.3.0 更正]** 下表已移除 `sql:allow-*` 与 `store:allow-*`：`tauri-plugin-sql` /
> `tauri-plugin-store` 已从依赖中删除（ADR-015），数据库只经 Rust 四层访问，
> 前端拿不到直连通道。历史条目见 §12.4。

| 能力域 | 放行项 | 服务于 |
|---|---|---|
| window | `core:window:allow-start-dragging`（K-2）、`allow-show` / `allow-hide` / `allow-set-always-on-top` / `allow-set-position` / `allow-close` | 悬浮条拖拽 / 显隐 / 置顶 / 位置恢复 |
| event | `core:event:allow-listen` / `allow-emit` | 前端订阅 `timer:state-changed` 等事件 |
| autostart | `autostart:allow-enable` / `allow-disable` / `allow-is-enabled` | P0-6 开机自启 |
| dialog | `dialog:allow-open` | V0.4.0 设置 → 同步：选择 Markdown 落点根目录（只选目录，不读写文件） |
| window-state | 插件默认（Rust 侧调用，前端无需 JS 权限） | 位置/尺寸记忆 |

**明确不放行（P1，最小权限）**：
- `global-shortcut:allow-*` 全部**不放行**——该能力已随全局快捷键功能整体下架，**不保留占位**
  （V0.3.3 / ADR-022）。
- 不引入任何网络类权限（无 HTTP）；CSP 维持 `default-src 'self'`（Spec §10）。
- 托盘（`tauri::tray`）走 Rust 侧，无需前端 capability。
