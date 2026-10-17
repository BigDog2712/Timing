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

1. **命名**：命令名 `snake_case`；DTO 字段 `camelCase`（Rust 侧统一 `#[serde(rename_all = "camelCase")]`）；枚举字符串值按其定义（`ShortcutAction` 用 `snake_case`，状态枚举用小写单词）。
2. **返回**：所有命令返回 `Result<T, AppError>`。成功 → 直接返回值；失败 → 序列化为 `{ "code": "<ErrorCode>", "message": "<人类可读>" }`。
3. **调用出口**：前端**禁止组件内直接 `invoke`**，统一经 `src/services/ipc.ts`（集中 try/catch 与错误码映射，K-11）。
4. **时间戳**：epoch **毫秒**（Rust `i64`），UTC。**时长**：**秒**（Rust `i32`），向下取整。
5. **ID**：SQLite `INTEGER`，前端 `number`。系统事项「未归类」固定 `id=1`、`isSystem=true`。
6. **分页**：`page` 从 1 起（默认 1）；`limit` 默认 20，**上限 100**（超限按 100 截断）。
7. **时间范围过滤**：`from` **含**、`to` **不含**，作用字段 `started_at`；缺省即不设该边界。
8. **软删除**：所有查询默认过滤 `deleted_at IS NULL`；删除操作不物理删行（记录保留以供审计）。`resolve_open_record(discard)` 例外，见 §4.4。
9. **单一 active 约束**：全局最多一条 `status='active'` 会话，由 TimerService 保证 + `uq_records_open` 索引兜底。

---

## 2. 错误码清单（共 11 个，锁定）

| code | 触发条件 | 前端处理 | 可重试 |
|---|---|---|---|
| `DB_ERROR` | SQLite 读写失败 / 事务回滚 | 提示"数据保存失败"+ 记录日志；**内存数据不丢**；按退避重试 ≤3 次 | 是 |
| `ITEM_NOT_FOUND` | 目标资源不存在或已软删除（**事项**；扩展：**记录**，见 §10 R-3） | 刷新事项/记录列表 | 否 |
| `ITEM_NAME_EMPTY` | 事项名称为空或仅空白字符 | 表单内联提示 | 否 |
| `ITEM_NAME_DUPLICATE` | 同名 `active` 事项已存在（trim + 大小写不敏感比较） | 内联提示 + 提供"直接使用该事项" | 否 |
| `ITEM_SYSTEM_PROTECTED` | 删除 / 归档系统事项「未归类」(id=1) | 置灰操作 + 提示不可删除 | 否 |
| `TIMER_ALREADY_RUNNING` | 已存在 `active` 会话时尝试 `start_timer`；或 `undo_stop` 期间已开启新会话 | 忽略 / 提示先结束 | 否 |
| `TIMER_NOT_RUNNING` | 无 `active` 会话却调 `pause_timer` / `resume_timer` / `stop_timer` / `switch_item` | 忽略并同步状态 | 否 |
| `TIMER_NO_UNDO` | 撤销窗口已过期 / 记录非 `saved` / 记录已删除 | 关闭撤销条 + 同步状态 | 否 |
| `SHORTCUT_REGISTER_FAILED` | 热键被占用或加速键非法（[P1]） | 提示并允许改键 | 否 |
| `INVALID_DURATION` | `ended_at < started_at` | 兜底丢弃该次输入 / 记录 | 否 |
| `IO_ERROR` | 文件 / 系统调用失败（注册表自启、窗口操作、字体等） | 通用错误提示 | 视情况 |

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
| `resolve_open_record` | `{ action: ResolveAction, endAt?: number }` | `TimeRecord \| null` | `resolveOpenRecord` |

### 3.5 设置域 Settings

| 命令 | 入参 | 出参 | ipc.ts 方法 |
|---|---|---|---|
| `get_settings` | `{}` | `Settings` | `getSettings` |
| `update_settings` | `{ patch: Partial<Settings> }` | `Settings` | `updateSettings` |
| `set_autostart` | `{ enabled: boolean }` | `boolean` | `setAutostart` |
| `get_autostart` | `{}` | `boolean` | `getAutostart` |

### 3.6 快捷键域 Shortcut [P1]

| 命令 | 入参 | 出参 | ipc.ts 方法 |
|---|---|---|---|
| `register_shortcut` | `{ action: ShortcutAction, accelerator: string }` | `boolean` | `registerShortcut` |

### 3.7 窗口 / 系统域 Window & System

| 命令 | 入参 | 出参 | ipc.ts 方法 |
|---|---|---|---|
| `show_window` | `{}` | `void` | `showWindow` |
| `hide_window` | `{}` | `void` | `hideWindow` |
| `toggle_window` | `{}` | `void` | `toggleWindow` |
| `set_always_on_top` | `{ enabled: boolean }` | `void` | `setAlwaysOnTop` |
| `save_window_position` | `{ x: number, y: number }` | `void` | `saveWindowPosition` |
| `quit_app` | `{}` | `void` | `quitApp` |

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
- 语义：新建事项。`name` trim 后为空 → `ITEM_NAME_EMPTY`；与现有 `active` 事项同名（trim + 大小写不敏感）→ `ITEM_NAME_DUPLICATE`。
- 错误码：`ITEM_NAME_EMPTY` / `ITEM_NAME_DUPLICATE` / `DB_ERROR`

#### `update_item`
- 入参：`{ "id": number, "patch": { "name"?: string, "color"?: string, "sortOrder"?: number } }`
- 出参：`Item`（`updated_at` 刷新）
- 语义：部分更新（仅含字段被改）。`patch.name` 存在且 trim 空 → `ITEM_NAME_EMPTY`；与其他 `active` 事项重名 → `ITEM_NAME_DUPLICATE`。系统事项可改名。
- 错误码：`ITEM_NOT_FOUND` / `ITEM_NAME_EMPTY` / `ITEM_NAME_DUPLICATE` / `DB_ERROR`

#### `archive_item`
- 入参：`{ "id": number }`
- 出参：`Item`（`status='archived'`）
- 语义：归档（软态，非删除）。系统事项 → `ITEM_SYSTEM_PROTECTED`。
- 错误码：`ITEM_NOT_FOUND` / `ITEM_SYSTEM_PROTECTED` / `DB_ERROR`

#### `unarchive_item`
- 入参：`{ "id": number }`
- 出参：`Item`（`status='active'`）
- 语义：取消归档。恢复后若与现有 `active` 事项重名 → `ITEM_NAME_DUPLICATE`（避免恢复即冲突）。
- 错误码：`ITEM_NOT_FOUND` / `ITEM_NAME_DUPLICATE` / `DB_ERROR`

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
- 入参：`{ "action": "resume" | "close" | "discard", "endAt"?: number }`
- 出参：`TimeRecord | null`
- 语义：启动时检测到 `active` 会话，由前端弹「继续 / 结束 / 丢弃」后调用：
  - `resume`：保持 `active`；`running_since = now`（**不把崩溃停机时长计入**——崩溃前的 `running_since` 已被持久化但指向过去，必须重置）。返回记录。
  - `close`：置 `saved`；`ended_at = endAt ?? now`；`running_since = null`；**不补算崩溃间隙**，以最后落盘的 `accumulated_sec` 为最终时长（丢失 ≤30s）。返回记录。
  - `discard`：**软删除**（`deleted_at=now`）并置 `status='saved'`、`ended_at=now`（释放 `uq_records_open` 部分唯一索引，保证随后可开新会话）。返回 `null`。
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
- 语义：部分更新。联动：`alwaysOnTop` 变更即时应用到窗口；`shortcuts` 变更触发重注册（[P1]）。
- 错误码：`DB_ERROR` / `IO_ERROR` / `SHORTCUT_REGISTER_FAILED`（[P1]）

#### `set_autostart`
- 入参：`{ "enabled": boolean }`，出参：`boolean`（**实际生效状态**，用于纠正平台写入失败）
- 语义：开关开机自启：写/删 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 条目（经 `tauri-plugin-autostart`）。**关闭时必须完全移除，不留隐藏启动项**（AC-21）。
- 错误码：`IO_ERROR` / `DB_ERROR`

#### `get_autostart`
- 入参：`{}`，出参：`boolean`
- 语义：查询自启实际状态（读注册表）。
- 错误码：`IO_ERROR`

### 4.6 快捷键域 Shortcut [P1]

#### `register_shortcut`
- 入参：`{ "action": ShortcutAction, "accelerator": string }`，出参：`boolean`
- 语义：注册 / 改键。成功返回 `true`；被占用或加速键非法 → `Err(SHORTCUT_REGISTER_FAILED)`。**禁止 `unwrap()`**（K-3）。
- 错误码：`SHORTCUT_REGISTER_FAILED` / `IO_ERROR`

### 4.7 窗口 / 系统域 Window & System

#### `show_window` / `hide_window` / `toggle_window`
- 入参：`{}`，出参：`void`
- 语义：悬浮条显隐（由托盘左键单击 / 热键调用）。`toggle_window` 依据当前可见性切换。显隐后 emit 对应事件使前端重置瞬时 UI（如收起展开面板）。
- 错误码：`IO_ERROR`

#### `set_always_on_top`
- 入参：`{ "enabled": boolean }`，出参：`void`
- 语义：置顶开关，并持久化 `settings.alwaysOnTop`。
- 错误码：`IO_ERROR` / `DB_ERROR`

#### `save_window_position`
- 入参：`{ "x": number, "y": number }`，出参：`void`
- 语义：记录窗口位置，**逻辑像素**（物理像素需除 `scaleFactor`，K-6）。
- 错误码：`IO_ERROR`

#### `quit_app`
- 入参：`{}`，出参：`void`
- 语义：真正退出进程（`app.exit(0)`），仅托盘菜单「退出」调用。关闭窗口只 `hide_window`（K-5）。
- 错误码：`IO_ERROR`

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
  "alwaysOnTop": true,
  "opacityEnabled": true,           // 透明度降级开关（W-4）
  "lastDisplayId": null,            // string | null（显示器标识）
  "shortcuts": {
    "toggleWindow": null,           // string | null（accelerator）
    "startPause": null,
    "stop": null,
    "newItem": null
  }
}
```

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
| `shortcut:triggered` | `{ "action": ShortcutAction }` | [P1] 全局热键按下 | 映射到对应动作 |
| `tray:toggle-visibility` | `{}` | 托盘左键单击切换显隐 | 重置瞬时 UI（收起展开面板等） |
| `app:open-settings` | `{}` | 托盘菜单「设置」/ 热键要求打开设置 | 打开设置面板 |
| `app:open-new-item` | `{}` | 托盘菜单「新建事项」/ 热键要求新建 | 打开新建事项入口 |

`ShortcutAction` 枚举（字符串值 `snake_case`）：`"toggle_window" | "start_pause" | "stop" | "new_item"`。

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
| `unregister_shortcut` | `{ action: ShortcutAction }` | `boolean` | 注销单个热键（配合改键） |

> 全局快捷键相关（`register_shortcut` / `SHORTCUT_REGISTER_FAILED` / `shortcut:triggered` / `Settings.shortcuts`）本期**仅保留结构与默认值**，不注册实际热键。

**锁定的默认加速键（[P1] 落地时的默认值，Spec §5.5 表格口径）**：

| 动作（ShortcutAction） | Settings.shortcuts 字段 | 默认加速键 |
|---|---|---|
| `toggle_window` | `toggleWindow` | `Ctrl+Alt+T` |
| `start_pause` | `startPause` | `Ctrl+Alt+S` |
| `stop` | `stop` | `Ctrl+Alt+E` |
| `new_item` | `newItem` | `Ctrl+Alt+N` |

> 口径统一：Spec §5.5 括号内"设计文档另提 `Ctrl+Alt+Space`"**作废**，`startPause` 一律为 `Ctrl+Alt+S`。
> MVP 期（P1 未实现）`Settings.shortcuts` 四字段默认值为 `null`（未注册）；上述默认值仅在 P1 注册热键时生效。

---

## 10. Phase 3 一致性校验清单与风险

### 10.1 交付前自检（缺一即退回）
- [ ] 全部 29 个命令在 Rust `invoke_handler` 注册（MVP 28 个 + [P1] `register_shortcut` 1 个），且命令名与本文一致。
- [ ] 11 个错误码在 `error.rs` 全部可序列化，无 `unwrap()` 泄漏 panic。
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

---

## 附录 A：capabilities 最小权限白名单（MVP，锁定）

> 依据 Spec §10「安全：`capabilities` 最小权限白名单」与坑 K-4（插件命令运行时被拒）。Phase 3 实现 `src-tauri/capabilities/default.json` 时按本表逐项放行；**本表之外不放行**。

| 能力域 | 放行项 | 服务于 |
|---|---|---|
| window | `core:window:allow-start-dragging`（K-2）、`allow-show` / `allow-hide` / `allow-set-always-on-top` / `allow-set-position` / `allow-close` | 悬浮条拖拽 / 显隐 / 置顶 / 位置恢复 |
| event | `core:event:allow-listen` / `allow-emit` | 前端订阅 `timer:state-changed` 等事件 |
| sql | `sql:allow-execute` / `allow-select` / `allow-load` / `allow-close` | tauri-plugin-sql（业务数据） |
| store | `store:allow-get` / `allow-set` / `allow-save` | tauri-plugin-store（设置 KV） |
| autostart | `autostart:allow-enable` / `allow-disable` / `allow-is-enabled` | P0-6 开机自启 |
| window-state | 插件默认（Rust 侧调用，前端无需 JS 权限） | 位置/尺寸记忆 |

**明确不放行（P1，最小权限）**：
- `global-shortcut:allow-*` 全部**不放行**（对应 K-3 的注册在 P1 才启用）；`register_shortcut` 命令在 Rust 侧保留注册但 MVP 不被调用。
- 不引入任何网络类权限（无 HTTP）；CSP 维持 `default-src 'self'`（Spec §10）。
- 托盘（`tauri::tray`）走 Rust 侧，无需前端 capability。
