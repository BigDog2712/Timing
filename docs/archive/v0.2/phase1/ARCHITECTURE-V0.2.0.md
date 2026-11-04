# Timing 架构设计 V0.2.0（增量）

- Document ID: ARCH-v0.2.0
- Status: Draft for V0.2.0-1 review（用户确认后冻结）
- Owner: 高见远（首席架构师，mvp-dev-expert-team-architect）
- Date: 2026-10-16
- Upstream: `docs/CHANGE-PLAN-V0.2.0.md`（变更范围，已定）；`docs/phase1/ARCHITECTURE-v1.md`；`docs/phase2/IPC-CONTRACT-v2.md`；`docs/phase2/schema.sql`；`docs/decisions/ADR-001~008`
- Downstream: `docs/phase2/IPC-CONTRACT-V0.2.0.md`、`docs/phase2/schema-V0.2.0.sql`、`src/types/domain.ts`、`src-tauri`（Rust）、V0.2.0-2 Spec

> 本文是 **增量**架构文档。V0.1.0 的架构（`ARCHITECTURE-v1.md`）继续有效，本文只写「变了什么、新增什么、为什么」。凡本文未提及处，一律以 v1 与 `IPC-CONTRACT-v2.md` 为准。
> 本项目**无 HTTP 后端、无 REST、无网络请求**。前后端契约 = Tauri `invoke` 命令 + Rust `emit` 事件。

---

## 0. 一句话结论

V0.2.0 在**不动架构主干**的前提下，把 Timing 从「单窗药丸计时器」扩成「常驻计时 + 待办 + 便利贴多窗 + 提醒 + 倒计时 + 双主题」的桌面工具：数据 3 表 → 5 表，IPC 29 → 52 命令，视图 9 → 14。新代码**全部沿用四层分层、状态机归 Rust、单文件 ≤ 300 行**；四个新能力的架构决策各配一条 ADR（009~012），另含**托盘菜单决策 ADR-013**（用户裁决：**保留原生菜单、不自绘**；自绘方案降级为 v0.3+ 可选增强）。

---

## 1. 范围

### 1.1 本期新增（对齐 `CHANGE-PLAN-V0.2.0.md` §B.2，已定不可改）

| # | 功能 | 架构归类 |
|---|---|---|
| 6 | 小条随事项名伸缩 | 纯前端（宽 = 基宽 + 事项名宽，CSS `max-width` 收敛） |
| 7 | 待办事项 | **新表 `todos` + IPC 组 `todo`** |
| 8 | 事项窗口（四状态清单） | **新窗口 `todos`**（独立 WebviewWindow） |
| 9 | 便利贴 | **多窗口（`note-{id}`）+ 新表 `notes`** |
| 10 | 提醒铃 | **后台调度（Rust 常驻定时器 + 系统通知）** |
| 11 | 倒计时 | **计时状态机扩展（`mode`/`target_sec`）** |
| 12 | 常用事项 / 固定任务 | `items.is_pinned` + 最近 5 条（前端） |
| 13 | 深浅双主题 | **前端 ThemeProvider + 令牌切换** |
| 14 | 四色可配 | settings 四色键 + 运行时 CSS 变量注入 |
| 15 | 自绘玻璃菜单 | 纯前端统一组件（**应用内**：小条右键 / 事项右键 / 便利贴右键）；**托盘菜单保留原生、不自绘**（ADR-013，见 §6.e） |

### 1.2 本期不做（Out of scope，硬约束，禁止镀金）

- **插件系统 / Obsidian 同步**：明确缓到 v0.3，不引入（与「数据保持 SQLite」决策冲突）。
- **数据格式改造**：不改 Markdown、不与 Obsidian 打通。
- **全局快捷键**：维持 P1（V0.1.0 口径不变，本期仍不注册实键）。
- **多用户 / 云同步 / 联网 / 遥测**：本产品永远离线单机。
- **便利贴富文本**：便利贴正文为**纯文本**（换行保留），不做富文本 / Markdown 渲染 / 图片。
- **待办重复规则（RRULE）/ 子任务 / 标签 / 优先级**：不做。
- **通知点击动作**：本期通知为「一次性提示」，不实现「点通知跳转到事项」（Windows toast 动作按钮留 v0.3）。
- **macOS / Linux 适配**：不变（代码保留跨平台能力，不过度适配）。
- **自定义主题色全色板**：本期只开放四色（计时中 / 提醒 / 完成 / 小条底色），不做任意令牌覆盖。

> 任何超出 §1.1 的需求，必须回到 Phase 重新评审，不得在本期实现。

---

## 2. 架构主干不变声明（对齐变更方案 §A2）

| 档位 | 内容 | 是否变 |
|---|---|---|
| **主干（不动）** | Tauri 2.12.4 + React 19.3 + TS + Vite + Zustand + SQLite(sqlx) + lucide-react；四层架构（表现→命令→业务→数据，依赖只向下）；**计时状态机归 Rust（单一事实来源）**；IPC = invoke + emit（无 REST）；单文件 ≤ 300 行、入口只装配；崩溃恢复 15s 落盘；单 active 会话约束（`uq_records_open`）；ADR-001~008 | **不变** |
| **已有项扩写** | 数据模型 3 → 5 表；IPC 29 → 52；视图 9 → 14；settings 加主题/四色/倒计时预设键 | **扩展，非推翻** |
| **V0.2.0 全新增** | 多窗口管理（便利贴 + 事项窗 + 设置窗）、后台提醒调度、倒计时状态机扩展、双主题 Token 切换；另含**托盘菜单决策 ADR-013**（结论：保留原生、不自绘） | **新增，配 ADR-009~013** |

> 计时状态机仍归 Rust：倒计时不改「Rust 拥有领域与持久化、React 只拥有表现」这条边界（见 §6.c）。

---

## 3. 版本锚定（新增依赖，已联网核实 2026-10-16）

> 纪律：**只写核实过的真实版本，禁止版本幻觉**（K-12 / 知识库 `generated-code-failure-modes` §3）。核实方式：`npm view <pkg> version`；crate 版本查 crates.io API。

| 用途 | 依赖 | 锁定版本 | 核实来源（实测输出） |
|---|---|---|---|
| 系统通知（提醒 / 倒计时到点） | `tauri-plugin-notification`（Rust crate） | **2.7.0** | crates.io API `max_stable_version = "2.7.0"` |
| 系统通知（前端 API，供权限/查询） | `@tauri-apps/plugin-notification`（npm） | **2.7.0** | `npm view` → `2.7.0` |
| 多窗口 | **Tauri 核心能力**（`WebviewWindowBuilder`），无新增依赖 | 随 `tauri` 2.12.4 | Tauri 官方文档（core） |
| 倒计时铃声 | **Web Audio API**（WebView2 内建），无新增依赖 | — | 不需引入音频 crate |

**已在 V0.1.0 锁定、本期不变**（复核 npm 现值供参考，**装包以实际解析为准**）：

| 依赖 | V0.1.0 锁定 | npm 当前解析值（2026-10-16 实测） |
|---|---|---|
| `@tauri-apps/api` | 2.12.4 | 2.12.4 |
| `@tauri-apps/plugin-sql` | 2.4.1 | 2.6.0（升级需与本契约一致，**本期不动**） |
| `@tauri-apps/plugin-store` | ^2.5.0 | 2.5.0 |
| `@tauri-apps/plugin-window-state` | ^2.5.0 | 2.5.0 |
| `@tauri-apps/plugin-autostart` | ^2.7.0 | 2.7.0 |
| `@tauri-apps/cli` | ^2.12.0 | 2.12.3 |
| `lucide-react`（P0 锁定） | **1.57.0** | 1.57.0 |
| `zustand` | ^5.0.15 | 5.0.15 |

> 本期**唯一新增依赖类**是 `tauri-plugin-notification`（Rust + npm，均 2.7.0）。其余四能力零新增依赖：多窗口用核心、铃声用 Web Audio、主题用 CSS 变量、便利贴用核心窗口。

---

## 4. 数据模型（3 表 → 5 表）

### 4.1 变更总览

| 表 | 变更类型 | 变更内容 | 依据 |
|---|---|---|---|
| `items` | **ALTER 加列** | +`remind_at`、+`reminded_at`、+`is_pinned` | 提醒铃 / 固定任务 |
| `time_records` | **ALTER 加列** | +`mode`、+`target_sec` | 倒计时 |
| `settings` | **加键（无 DDL）** | `theme.mode`、`accent.running/warn/done/bar`、`countdown.presets` | 双主题 / 四色 / 倒计时预设 |
| `notes` | **新建表** | 便利贴（内容 + 窗口几何 + 打开态） | 便利贴多窗口 |
| `todos` | **新建表** | 待办（标题 + 计划/提醒/完成时刻） | 待办事项 |

**与变更方案 §C 的差异及理由（架构决策，需 team-lead 知悉）**：

1. `items` 增 `reminded_at`、`todos` 增 `reminded_at`：**提醒去重标记**。仅有 `remind_at` 时，后台扫描每 tick 都会命中同一条已到点提醒并重复弹通知（沉默逻辑错误）。`reminded_at` 记录「已触发」时刻，扫描条件加 `reminded_at IS NULL`，保证一条提醒只弹一次、且崩溃重启不重弹（K-19）。
2. `notes` / `todos` 增 `updated_at` + `deleted_at`：对齐 V0.1.0 全库约定（每表 `id/created_at/updated_at` + 软删除，`IPC-CONTRACT-v2 §1.8`）。变更方案列的是「核心字段」，非穷尽。
3. `notes` 增 `is_open`：**窗口恢复的依据**。关闭便利贴 = 「收纳」（保留数据 + 关窗），重启需恢复「上次开着的」便利贴；`is_open` 是这一状态的事实来源（K-14）。
4. `notes.item_id` **可空**：便利贴可挂靠事项，也可作为独立桌面便签（`NULL`）。

### 4.2 ER 图（V0.2.0）

```
┌───────────────────────────────┐   ┌──────────────────────────────┐
│             items             │   │         time_records         │
├───────────────────────────────┤   ├──────────────────────────────┤
│ id            INTEGER         │   │ id            INTEGER        │
│ name          TEXT            │   │ item_id       INTEGER  (FK)  │
│ color         TEXT            │   │ status        TEXT           │
│ status        TEXT            │   │ started_at    INTEGER        │
│ is_system     INTEGER         │   │ ended_at      INTEGER NULL   │
│ sort_order    INTEGER         │   │ accumulated_sec INTEGER      │
│ remind_at     INTEGER NULL  * │   │ running_since INTEGER NULL   │
│ reminded_at   INTEGER NULL  * │   │ note          TEXT NULL      │
│ is_pinned     INTEGER  *      │   │ mode          TEXT  *        │
│ created_at    INTEGER         │   │ target_sec    INTEGER NULL * │
│ updated_at    INTEGER         │   │ created_at    INTEGER        │
│ deleted_at    INTEGER         │   │ updated_at    INTEGER        │
└───────────────────────────────┘   │ deleted_at    INTEGER        │
                                    └──────────────────────────────┘

┌────────────────┐   ┌──────────────────────────────┐   ┌──────────────────────────┐
│     todos      │   │            notes             │   │        settings          │
├────────────────┤   ├──────────────────────────────┤   ├──────────────────────────┤
│ id INTEGER     │   │ id            INTEGER  PK    │   │ key   TEXT PK            │
│ title TEXT     │   │ item_id       INTEGER NULL FK│   │ value TEXT (JSON)        │
│ planned_at  *  │   │ content       TEXT           │   │ updated_at INTEGER       │
│ remind_at   *  │   │ pos_x / pos_y  REAL          │   └──────────────────────────┘
│ reminded_at *  │   │ width / height REAL          │
│ done_at        │   │ is_open       INTEGER *      │
│ sort_order     │   │ created_at / updated_at      │
│ created_at     │   │ deleted_at    INTEGER        │
│ updated_at  *  │   └──────────────────────────────┘
│ deleted_at  *  │
└────────────────┘

实体关系：items 1─n time_records；items 1─n notes（可空）；todos 独立（不挂事项）
* = V0.2.0 新增列；notes 一窗一行（窗口 label = note-{id}）
```

> `todos` 与 `items` **不做外键关联**：待办是「还没归类的计划」，开始做时才可能变成一次计时；变更方案未要求关联，避免过度建模。若后续需要「待办 → 事项」关联，走 v0.3 迁移加列。

### 4.3 表结构（仅列 V0.2.0 相关字段）

#### `items`（新增 3 列）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| remind_at | INTEGER | NULL | 事项提醒时刻（epoch 毫秒）。NULL = 无提醒 |
| reminded_at | INTEGER | NULL | 该提醒**已触发**时刻（epoch 毫秒）。NULL = 未触发。*去重标记 |
| is_pinned | INTEGER | NOT NULL DEFAULT 0, CHECK in (0,1) | 1 = 固定任务（常用事项菜单置顶 + 固定任务区） |

#### `time_records`（新增 2 列）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| mode | TEXT | NOT NULL DEFAULT `'countup'`, CHECK in ('countup','countdown') | 计时模式 |
| target_sec | INTEGER | NULL, CHECK (`target_sec IS NULL OR target_sec > 0`) | 倒计时目标秒数；仅 `mode='countdown'` 时非空 |

> 不变式（应用层保证）：`mode='countup'` ⇒ `target_sec IS NULL`；`mode='countdown'` ⇒ `target_sec > 0`。
> SQLite 的 `ADD COLUMN` 不允许带 `CHECK`（K-13），故 `mode` / `target_sec` 的取值约束落在**应用层**（TimerService 校验 + 写入前归一），`schema-V0.2.0.sql` 对新建库的完整 DDL 里可保留 CHECK。

#### `notes`（新表）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | 主键（= 窗口 label `note-{id}` 的尾号） |
| item_id | INTEGER | NULL, REFERENCES items(id) | 挂靠事项；NULL = 独立便签 |
| content | TEXT | NOT NULL DEFAULT '' | 便利贴正文（纯文本，保留换行；长度上限 4000 字符） |
| pos_x | REAL | NOT NULL | 逻辑像素 x（**非**物理像素，K-15） |
| pos_y | REAL | NOT NULL | 逻辑像素 y |
| width | REAL | NOT NULL | 逻辑像素宽（下限 160，上限 900） |
| height | REAL | NOT NULL | 逻辑像素高（下限 120，上限 900） |
| is_open | INTEGER | NOT NULL DEFAULT 0, CHECK in (0,1) | 1 = 窗口当前打开；重启据此恢复 |
| created_at | INTEGER | NOT NULL | epoch 毫秒 |
| updated_at | INTEGER | NOT NULL | epoch 毫秒 |
| deleted_at | INTEGER | NULL | 软删除 |

#### `todos`（新表）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | 主键 |
| title | TEXT | NOT NULL, 长度 1-200 | 待办标题 |
| planned_at | INTEGER | NULL | 计划执行时刻（epoch 毫秒，仅日期或精确到分）；NULL = 未排期 |
| remind_at | INTEGER | NULL | 提醒时刻；NULL = 无提醒 |
| reminded_at | INTEGER | NULL | 已触发时刻；NULL = 未触发。*去重标记 |
| done_at | INTEGER | NULL | 完成时刻；NULL = 未完成 |
| sort_order | INTEGER | NOT NULL DEFAULT 0 | 手动排序（升序） |
| created_at | INTEGER | NOT NULL | |
| updated_at | INTEGER | NOT NULL | |
| deleted_at | INTEGER | NULL | 软删除 |

### 4.4 索引清单（V0.2.0 新增，标识 J-*）

| # | 索引 | 定义 | 用途 |
|---|---|---|---|
| J-1 | `idx_notes_item_id` | `notes(item_id)` | 按事项查便利贴 |
| J-2 | `idx_notes_open` | `notes(is_open)` **WHERE `is_open=1 AND deleted_at IS NULL`** | 启动恢复打开态便利贴（热点） |
| J-3 | `idx_todos_done` | `todos(done_at)` | 待办列表按完成态过滤/排序 |
| J-4 | `idx_todos_planned` | `todos(planned_at)` | 事项窗口按计划时刻分组 |
| J-5 | `idx_items_remind` | `items(remind_at)` **WHERE `remind_at IS NOT NULL AND reminded_at IS NULL`** | 后台提醒扫描（热点，部分索引） |
| J-6 | `idx_todos_remind` | `todos(remind_at)` **WHERE `remind_at IS NOT NULL AND reminded_at IS NULL`** | 后台提醒扫描（热点，部分索引） |

> 沿用 V0.1.0 的 I-1..I-6 不动。J-5/J-6 用**部分索引**只覆盖「未触发的提醒」，扫描代价 O(待触发数)，与已触发历史无关。

### 4.5 迁移策略（幂等 + 与 V0.1.0 老库共存）

**关键约束（K-13）**：SQLite **不支持** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，`ADD COLUMN` 重复执行会报 `duplicate column name`。V0.1.0 的 `0001_init.sql` 只用了 `CREATE TABLE/INDEX IF NOT EXISTS` 所以可反复跑；V0.2.0 的加列**不能**靠纯 SQL 幂等。

**方案：Rust 侧「列守卫」迁移器**（新文件 `src-tauri/src/infra/migrate.rs`）：

```
migrate(pool):
  1. 执行 0001_init.sql（不变，CREATE TABLE/INDEX IF NOT EXISTS，幂等；建立 3 张基表）
  2. * 先补列：对加列清单逐项 ensure_column（必须在建索引之前，K-13）：
       MIGRATE_COLUMNS = [
         ("items", "remind_at",    "INTEGER"),
         ("items", "reminded_at",  "INTEGER"),
         ("items", "is_pinned",    "INTEGER NOT NULL DEFAULT 0"),
         ("time_records", "mode",       "TEXT NOT NULL DEFAULT 'countup'"),
         ("time_records", "target_sec", "INTEGER"),
       ]
     ensure_column(table, col, def):
       if col ∉ PRAGMA table_info(table):  ALTER TABLE table ADD COLUMN col def
  3. 再执行 schema-V0.2.0.sql（建 notes/todos + 全部索引 + settings 种子，全 IF NOT EXISTS）
  4. UPDATE settings SET value='2' WHERE key='schema.version'
```

> **顺序是硬约束（K-13）**：步骤 2 必须在步骤 3 **之前**。`schema-V0.2.0.sql` 里的
> `idx_items_remind` 建在 `items(remind_at)` 上，而旧库的 `items` 缺该列 —— 若先跑步骤 3，
> 旧库会因「no such column: remind_at」而失败（已实测复现）。先补列则各路径皆安全。

- **老库（V0.1.0）**：步骤 1 的建表为 no-op（表已存在）→ 步骤 2 检出 `items`/`time_records` 缺列并 `ALTER` 补齐 → 步骤 3 的 `CREATE TABLE IF NOT EXISTS`（items/time_records）仍为 no-op，但新建 `notes`/`todos` 并建出全部索引。
- **新库（V0.2.0 首装）**：步骤 1 用 V0.1.0 的 `0001` 建 3 张基表 → 步骤 2 补 5 列 → 步骤 3 建 `notes`/`todos` 与索引。即**两条路径殊途同归**，`items`/`time_records` 的新列在任何路径上都由 `ALTER` 补齐（因此这两表的新列**不带** `CHECK`，取值约束在应用层；`schema-V0.2.0.sql` 里这两表的完整 `CREATE TABLE` 仅作目标 schema 参考，对已存在的表为 no-op）。
- **重复执行**：全部幂等（建表/索引 `IF NOT EXISTS` + 列守卫）。

> `schema-V0.2.0.sql` 是**目标全量 DDL 的权威参考**（供新库 / 文档 / 审计），`infra/migrate.rs` 是实现幂等落地的执行者。两者交叉引用，改一处必须同步另一处（规格即契约）。
> 迁移在 `infra::db::init_pool` 内、`AppState.manage` 之前完成，**先于**托盘/后台任务启动（见 §6）。

---

## 5. IPC 契约增量（29 → 52 命令）

### 5.1 通用约定（沿用 `IPC-CONTRACT-v2 §1`，无变化）

命名 snake_case；DTO camelCase；时间戳 epoch 毫秒；时长秒；ID number；分页 page/limit；软删除默认过滤；单一 active 约束不变。

### 5.2 新错误码（11 → 16）

| code | 触发条件 | 前端处理 |
|---|---|---|
| `NOTE_NOT_FOUND` | 便利贴不存在 / 已软删除 | 关闭对应窗口 + 刷新列表 |
| `TODO_NOT_FOUND` | 待办不存在 / 已软删除 | 刷新待办列表 |
| `WINDOW_LIMIT_EXCEEDED` | 便利贴窗口数达上限（20） | 提示「便利贴数量已达上限」 |
| `INVALID_TARGET_SEC` | `start_countdown` 的 `targetSec <= 0` 或超上限（> 24h） | 表单内联提示 |
| `INVALID_COLOR` | `accent_set` 传入非法 hex（非 `#RRGGBB`） | 表单内联提示，保留旧值 |

> 其余新命令复用既有码：`theme_get/accent_get` → `DB_ERROR`；`reminder_*` 目标缺失 → `ITEM_NOT_FOUND` / `TODO_NOT_FOUND`；`open_*_window` 失败 → `IO_ERROR`。

### 5.3 新增命令（23 条）

#### 便利贴 note（5）

| 命令 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `note_create` | `{ itemId?: number, content: string, posX: number, posY: number, width: number, height: number }` | `Note` | 建便利贴行（`is_open=0`）。**不建窗口**（窗口由 `open_note_window` 负责，职责分离）。`content` trim 后可空 |
| `note_get` | `{ id: number }` | `Note` | 单条；缺失 → `NOTE_NOT_FOUND` |
| `note_list` | `{ itemId?: number }` | `Note[]` | 列表（默认过滤软删；`itemId` 缺省 = 全部；排序 `updated_at DESC`） |
| `note_update` | `{ id: number, patch: NotePatch }` | `Note` | 部分更新（`content`/`itemId`/`posX`/`posY`/`width`/`height`） |
| `note_delete` | `{ id: number }` | `void` | 软删除 + **关闭该窗口（若开）** + emit `note-window-closed` |

#### 待办 todo（5）

| 命令 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `todo_create` | `{ title: string, plannedAt?: number, remindAt?: number }` | `Todo` | 新建；`title` trim 空 → `ITEM_NAME_EMPTY` |
| `todo_update` | `{ id: number, patch: TodoPatch }` | `Todo` | 部分更新（`title`/`plannedAt`/`remindAt`/`sortOrder`） |
| `todo_delete` | `{ id: number }` | `void` | 软删除（幂等：不存在静默成功） |
| `todo_list` | `{ includeDone?: boolean, from?: EpochMs, to?: EpochMs }` | `Todo[]` | 默认排除已完成；`from <= planned_at < to`；排序 `sort_order ASC, planned_at ASC` |
| `todo_toggle` | `{ id: number, done: boolean }` | `Todo` | 勾选/取消勾选（`done=true` 置 `done_at=now`，`false` 置 NULL）。**显式传 `done`**，不用盲翻转（防并发双击竞态） |

#### 窗口 window（4）

| 命令 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `open_note_window` | `{ noteId: number }` | `void` | 打开/聚焦便利贴窗口；置 `is_open=1`；超上限 → `WINDOW_LIMIT_EXCEEDED` |
| `close_note_window` | `{ noteId: number }` | `void` | 「收纳」：持久化内容 + 几何，销毁窗口，置 `is_open=0`；emit `note-window-closed` |
| `open_todos_window` | `{}` | `void` | 打开/聚焦**单例**事项窗口（label `todos`） |
| `open_settings_window` | `{}` | `void` | 打开/聚焦**单例**设置窗口（label `settings`） |

> `open_*` 语义：窗口已存在 → `show()+set_focus()`；不存在 → 创建。多窗口 MVP 不许开多个设置窗 / 事项窗。

#### 主题 theme（4）

| 命令 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `theme_get` | `{}` | `ThemeSettings` | `{ mode }` |
| `theme_set` | `{ mode: ThemeMode }` | `ThemeSettings` | 写 `settings.theme.mode` + emit `theme-changed` |
| `accent_get` | `{}` | `AccentColors` | 四色当前值（未配的返回令牌默认值） |
| `accent_set` | `{ patch: Partial<AccentColors> }` | `AccentColors` | 校验 hex（非法 → `INVALID_COLOR`）+ emit `theme-changed` |

#### 计时 timer（2）

| 命令 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `start_countdown` | `{ itemId?: number, targetSec: number }` | `TimeRecord` | 开倒计时会话：`mode='countdown'`、`target_sec=targetSec`。前置：无 active。`targetSec` 非法 → `INVALID_TARGET_SEC` |
| `set_countdown_preset` | `{ presets: number[] }` | `number[]` | 覆盖预设列表（去重 + 升序 + 每项 >0；上限 8 个） |

#### 提醒 reminder（3）

| 命令 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `reminder_set` | `{ target: ReminderTarget, targetId: number, remindAt: number }` | `Reminder` | 设提醒：写 `remind_at` + **清 `reminded_at=NULL`**（重设即复活） |
| `reminder_clear` | `{ target: ReminderTarget, targetId: number }` | `void` | 清提醒：`remind_at=NULL, reminded_at=NULL` |
| `reminder_pending` | `{}` | `Reminder[]` | 未触发提醒列表（`remind_at IS NOT NULL AND reminded_at IS NULL`），按 `remind_at ASC` |

### 5.4 DTO 变更与新增

**修改**（字段追加，不删不改名，向后兼容）：

```jsonc
// Item += 3 字段
{ "id":1, "name":"写方案", "color":null, "status":"active", "isSystem":false, "sortOrder":0,
  "remindAt": null,        // number | null —— 事项提醒时刻
  "remindedAt": null,      // number | null —— 已触发时刻
  "isPinned": false,       // boolean —— 固定任务 / 常用事项
  "createdAt":1760000000000, "updatedAt":1760000000000 }

// ItemPatch += remindAt?, isPinned?（remindedAt 不可由前端设）

// TimeRecord += 2 字段
{ "id":10, "itemId":1, "status":"active", "startedAt":1760000000000, "endedAt":null,
  "accumulatedSec":0, "runningSince":1760000000000, "note":null,
  "mode": "countdown",     // "countup" | "countdown"
  "targetSec": 1500 }      // number | null —— 仅 countdown 非空

// TimerState += 2 字段
{ "status":"running", "session":{...}, "lastItemId":1, "liveDurationSec":42,
  "mode": "countdown",     // "countup" | "countdown"（idle 时 = "countup"）
  "remainingSec": 1458 }   // number | null —— countdown 剩余（max(0, targetSec-live)）；countup/idle 为 null

// Settings += 3 字段
{ "autostartEnabled":false, "alwaysOnTop":true, "opacityEnabled":true, "lastDisplayId":null,
  "shortcuts": {...},
  "themeMode": "dark",                               // "dark" | "light" | "system"
  "accents": { "running":"#4DA3E8", "warn":"#E8A33D", "done":"#4CC38A", "bar":null },
  "countdownPresets": [300,900,1500,1800,2700,3600] }
```

**新增**：

```jsonc
// Note
{ "id":1, "itemId":null, "content":"需求文档要补一版",
  "posX":120, "posY":80, "width":320, "height":232,
  "isOpen":true, "createdAt":1760000000000, "updatedAt":1760000000000 }

// Todo
{ "id":1, "title":"写周报", "plannedAt":null, "remindAt":null, "remindedAt":null,
  "doneAt":null, "sortOrder":0, "createdAt":1760000000000, "updatedAt":1760000000000 }

// ThemeSettings
{ "mode": "dark" }

// AccentColors（bar 可空 = 跟随主题令牌）
{ "running":"#4DA3E8", "warn":"#E8A33D", "done":"#4CC38A", "bar":null }

// Reminder
{ "target":"item", "targetId":1, "title":"写方案", "remindAt":1760000900000 }
```

**枚举**：`TimerMode = 'countup' | 'countdown'`；`ThemeMode = 'dark' | 'light' | 'system'`；`ReminderTarget = 'item' | 'todo'`。

### 5.5 新增事件（5 条；`IPC-CONTRACT-v2 §6` 的 5 条不变）

| 事件名 | Payload | 触发时机 | 前端应做 |
|---|---|---|---|
| `reminder-fired` | `Reminder` | 后台调度命中到点提醒 | 主窗弹轻提示；刷新该事项/待办铃铛态 |
| `countdown-finished` | `{ session: TimeRecord, targetSec: number }` | 倒计时到点自动结束 | 主窗**播放铃声** + 瞬时提示（并伴随 `timer:state-changed`） |
| `theme-changed` | `ThemeSettings & { accents: AccentColors }` | `theme_set` / `accent_set` | ThemeProvider 切换 `data-theme` + 注入四色变量；**广播所有窗口** |
| `note-window-opened` | `{ noteId: number }` | 便利贴窗口创建/显示 | 主窗/事项窗刷新便利贴列表态 |
| `note-window-closed` | `{ noteId: number }` | 便利贴窗口销毁 | 同上 |

> `countdown-finished` 是变更方案「新增事件」之外补的：倒计时到点是**独立语义**（有铃声），与普通 `timer:state-changed`（idle）区分，前端据它播放铃声（K-20/K-22）。
> 事件广播纪律见 K-21：`app.emit` 广播**所有** webview，`theme-changed` 需广播（所有窗口都要切主题），`timer:state-changed` 由便利贴/待办窗口**忽略**；窗口专属事件用 `emit_to(label, ...)`。

---

## 6. 新增能力架构方案与关键裁定（重点）

> 6.a~6.d 为四个核心新能力（各配 ADR-009~012）；6.e~6.g 为设计师提出的三项架构交叉点裁定（托盘菜单 ADR-013【结论：保留原生】、中文字重、玻璃立场）。

### 6.a 多窗口模型（ADR-009，答设计师 Q1）

V0.1.0 是「单窗 384×360 内绘制」；V0.2.0 改为**多独立 `WebviewWindow`**。四类窗口统一在一个模型下管理（几何持久化、多显示器、尺寸钳制、防白闪、主题广播规则对四类统一约束）：

| 窗口 | label | 尺寸（逻辑px） | 单例 | 配置要点 |
|---|---|---|---|---|
| 主小条 PillBar | `main` | 画布 384×360（沿用）；**OS 窗口随内容自适应** | 是 | `transparent:true`、`decorations:false`（沿用 V0.1.0）；`minWidth/minHeight = 1`、`maxWidth/maxHeight = 384/360`，由 `useWindowAutoFit` 收缩到可见内容包围盒（ADR-014，解决透明区吞桌面点击）；**不挂任何背景模糊**（保拖拽顺滑，见 §6.g） |
| 设置面板 | `settings` | 392×660 | 是 | 新不透明窗；`resizable:false`、`skipTaskbar:false`、`alwaysOnTop:false` |
| 事项窗口 | `todos` | 宽 336（高自适应，min 360） | 是 | 新不透明窗；`resizable:true`（限高） |
| 便利贴 | `note-{id}` | 320×232（默认） | 否（每贴一窗，上限 20） | `skipTaskbar:true`、`alwaysOnTop:false`（默认）、min 160×120 |

**四类窗口一致的四条机制**（避免逐窗重复决策）：

1. **路由**：`App.tsx` 依 `getCurrentWindow().label` 选根组件（`main`→PillBar；`settings`→SettingsWindow；`todos`→TodosWindow；`note-*`→StickyNoteWindow）。
2. **几何持久化 + 多显示器**：**按窗口类型分两路**——① **便利贴（动态 label `note-{id}`）落 DB**：`notes.pos_x / pos_y / width / height`（均 `REAL`，**逻辑像素**；表结构不含 `monitor_id`）；② **单例窗（固定 label `main`/`settings`/`todos`）沿用 `tauri-plugin-window-state`**（按 label 自动持久化，V0.1.0 既有机制，本期不动，不入库）。两路统一经 `infra/windows.rs::clamp_to_workarea` 按目标屏 `work_area` 钳制、越界回落主屏（K-6/K-15 同源）。**不持久化显示器 id**：恢复时用 `app.available_monitors()` 现算目标屏与 `work_area`（`Monitor` 提供 `work_area`/`size`/`scale_factor`）。
3. **防白闪三件套**：每个新窗 `visible:false` + `index.html` 内联主题脚本 + 令牌兜底 `--bg`，首帧就绪后 `show()`（K-18）。
4. **主题广播**：`theme_set`/`accent_set` 后 emit `theme-changed`（广播所有窗口），各窗 ThemeProvider 重设 `data-theme`（§6.d）。**便利贴/事项窗逐窗订阅、主窗不代劳**——避免主窗对所有子窗做集中转发（多一跳、且主窗关闭即失效）。
5. **便利贴尺寸钳制（两层，互不冲突）**：**硬钳制**（代码强制）`160×120 … 900×900`（`NOTE_MIN_W/H` / `NOTE_MAX_W/H`），且运行时**再被当前屏 `work_area` 收窄**（两者取小）；**舒适上限**（软提示，不强制）`640×480`（`NOTE_COMFORT_MAX_W/H`）仅作默认建议/拖拽吸附。**舒适上限 ≤ 硬上限**，故无「不可达区间」。

> 与设计师报告口径一致；ADR-009 已按「便利贴窗口 + 单例面板」统一记录。

#### 方案（选定：一便利贴 = 一个 `WebviewWindow`）

- **窗口模型**：`label = note-{id}`，`url = index.html?w=note&id={id}`；`App.tsx` 按 `getCurrentWindow().label` 路由根组件（主窗 → PillBar；`note-*` → StickyNoteWindow；`todos` → TodosWindow；`settings` → SettingsWindow）。
- **窗口配置**：`decorations:false`、`transparent:true`、`shadow:false`、`resizable:true`、`skipTaskbar:true`、`alwaysOnTop:false`、`minWidth:160/minHeight:120`、`maxWidth:900/maxHeight:900`（静态硬上限，运行时再受 `work_area` 钳制）、`visible:false`（首帧就绪后 `show()`，防白闪 K-18）。
- **位置/尺寸持久化**：`notes.pos_x/pos_y/width/height`（**逻辑像素**）。窗口 `Moved`/`Resized` 事件 → `NOTE_GEOM_DEBOUNCE_MS`(300) 去抖 → `note_update` 落盘。
- **多显示器 / DPI**：存逻辑坐标 = 物理像素 / `scaleFactor`；恢复时按该显示器 `work_area` 钳制，越界回落主屏（复用 V0.1.0 的 K-6 逻辑，抽成 `infra/windows::clamp_to_workarea`）。
- **关闭 / 重启恢复**：关闭 = 「收纳」（`close_note_window`：先落盘内容+几何，再 `destroy()` 窗口，置 `is_open=0`）；启动时 `SELECT id FROM notes WHERE is_open=1 AND deleted_at IS NULL` 逐个恢复窗口。
- **资源隔离与上限**：每窗独立 WebView2 进程；`MAX_NOTE_WINDOWS = 20`，超限 `WINDOW_LIMIT_EXCEEDED`。
- **与主窗隔离**：便利贴窗口 ① 不订阅 `timer:state-changed`（用 label 过滤）；② 只加载必要 store（`noteStore`），不挂 PillBar 全量 store；③ 不常驻后台 tick。

#### 取舍分析

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **A 一便利贴一 WebviewWindow** | 原生拖动/缩放/最小化/多显示器一等支持；窗口级 `alwaysOnTop`、`skipTaskbar` 直接可用；实现最简、与变更方案一致 | 每个 WebView ≈ 20–40MB，N 张即 N 份 React 运行时；窗口创建 ~100–200ms | **选定**（MVP 上限 20 张，实际使用通常 1–5 张） |
| B 单全屏透明 overlay 托管所有便利贴 | 只用 1 个 WebView，内存恒定；笔记间拖拽/层叠纯 DOM | 需自造「点击穿透 + 逐条命中测试」；窗口级拖动/缩放要手写；跨显示器要自算虚拟桌面坐标；任务栏/焦点行为需自管 | 备选（若内存成为硬瓶颈，v0.3 可迁移；`notes` 表结构不变，仅渲染方式换） |
| C 原生 child window（父子窗） | 与主窗绑定生命周期 | Tauri 跨平台 child 支持不完整；便利贴本就应独立于主窗存亡 | 不用 |

> **最大风险**：内存随窗口数线性增长（K-14）。缓解：上限 20 + 关闭即 `destroy`（不留隐藏窗）+ 便利贴窗口不加载 PillBar 全量逻辑。**判定：可行，非阻塞；成本可控**（替代方案 B 已验证可回退）。

#### 落地文件（新增，均 ≤300 行）

`src-tauri/src/infra/windows.rs`（多窗口创建/恢复/钳制）、`commands/note_cmd.rs` + `window_cmd.rs`、`services/note.rs`、`repositories/note.rs`、`models/note.rs`；
前端 `src/components/note/StickyNoteWindow.tsx` + `NoteHeader.tsx` + `NoteBody.tsx`、`src/stores/noteStore.ts`、`src/lib/windows.ts`（label 解析 + 几何换算）。

### 6.b 后台提醒调度（ADR-010）

#### 方案

- **常驻调度器**：`infra/reminder.rs::spawn_reminder_watcher(app)`，tokio `interval(REMINDER_SCAN_INTERVAL_SECS = 15)`，与现有 15s `flusher` 并行（独立任务，互不阻塞）。
- **扫描（查询式，非计数式）**：每 tick 查
  ```sql
  SELECT id, name, remind_at FROM items
   WHERE deleted_at IS NULL AND remind_at IS NOT NULL AND reminded_at IS NULL AND remind_at <= :now
  UNION ALL
  SELECT id, title, remind_at FROM todos
   WHERE deleted_at IS NULL AND remind_at IS NOT NULL AND reminded_at IS NULL AND remind_at <= :now;
  ```
- **触发**：对每条命中 → ① `UPDATE ... SET reminded_at = :now`（**先置位再去重**，保证只弹一次，K-19）；② `app.notification().builder().title(..).body(..).show()`（`tauri-plugin-notification` 2.7.0）；③ `emitter.emit("reminder-fired", Reminder{...})`。
- **休眠唤醒补偿**：因为是**查询式**（条件 `remind_at <= now`），不依赖「漏了几个 tick」。系统休眠期间 ticker 暂停，唤醒后下一个 tick 立即把所有逾期未触发提醒一次扫出并触发（**迟到但必达**）。这比「计时累加式」更抗休眠（无累计误差）。
- **幂等与重复**：`reminded_at` 保证跨重启不重弹；同一 tick 内多条提醒各弹各的（不聚合，MVP 从简）。
- **失败处理**：通知发送失败（`Err`）时**回滚** `reminded_at`（保留待重试），避免「静默丢提醒」。

#### 取舍分析

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **A Rust 常驻 `tokio::interval` + 查询式扫描** | 不依赖前端存活；休眠唤醒后自动补发；实现最简；与 15s flusher 同构 | 15s 粒度 → 提醒最多迟 14s | **选定**（提醒迟到十几秒可接受；粒度可调） |
| B 前端 `setInterval` | 复用前端 | 窗口隐藏/WebView 被挂起即失效；WebView 暂停后漏触发 | 不用 |
| C 每条提醒各起一个 `tokio::sleep` 定时任务 | 到点精准 | 提醒数多时任务碎片化；休眠唤醒补偿要自己算；重启要重建 | 备选（精度要求提高时再上） |
| D 独立 OS 计划任务（Task Scheduler） | 应用未启动也能提醒 | 需管理员/注册表复杂、跨平台差 | 不用 |

> **最大风险**：Windows 系统通知（toast）**需要 AppUserModelID（AUMID）**，dev 态可能不弹、打包（NSIS）后稳定；且 Windows「专注助手/勿扰」会吞通知（K-16）。缓解：① 打包配置写入 AUMID（`bundle.identifier` + 快捷方式）；② 通知失败时回滚 `reminded_at` 并重试；③ 应用内 `reminder-fired` 事件保证「即使系统通知没弹，主窗仍有可视提示」。**判定：可行；系统通知在 dev 态可能不可见，属平台限制，非阻塞。**

### 6.c 倒计时状态机扩展（ADR-011）

#### 方案

- **数据**：`time_records.mode ∈ {countup,countdown}`、`target_sec`。`TimerMode` 进入 `TimeRecord` 与 `TimerState`。
- **命令**：`start_countdown({ itemId?, targetSec })`（= 带 mode/target 的 `start_timer`）。新增 `INVALID_TARGET_SEC`。
- **状态机**（在 V0.1.0 三态上叠加，**不新增状态**）：
  ```
  idle ──start_countdown──▶ running(countdown) ──pause_timer──▶ paused(countdown)
                                 │ resume_timer                     │
                                 ▼                                  │
                          [到点] 自动结束 ◀──────── stop_timer（手动提前结束）
                                 ▼
                              saved（accumulated_sec = target_sec）
  ```
  - **到点判定归 Rust**：`infra/countdown.rs::spawn_countdown_watcher`，tokio `interval(1s)`，查 `mode='countdown'` 的 active 会话，若 `live_duration >= target_sec` → 结束（K-20）。**不由前端发起结束**，避免窗口隐藏/WebView 挂起时漏触发（与「状态机归 Rust」一致）。
  - **钳制**：结束时 `accumulated_sec = target_sec`（精确落点，不受 tick 抖动影响）；`ended_at = started_at + target_sec*1000`（时长口径一致，便于统计）。
  - **到点行为**：`finalize` → 发系统通知 → emit `timer:state-changed`（idle）+ `countdown-finished`（前端播铃声，K-22）。
  - **手动提前结束**：复用 `stop_timer`（对 countdown 同样有效），`accumulated_sec = live`（可小于 target），不播铃声。
- **单调时钟复用**：沿用同一 `live_duration(record, now_ms())` 公式（墙钟毫秒 + 单调调度）。`remainingSec = max(0, target_sec - live)` 作为服务端快照写入 `TimerState`（与 `liveDurationSec` 同源，避免 R-4 类跳变）。
- **时钟跳变**：墙钟被改（NTP/手动）可能使 `live` 跳变；countdown watcher 用 `live >= target` 判定 + 钳制，跳变只会导致「提前/延后到点一次」，不会算错已落盘时长（`accumulated_sec` 每 15s 落盘不变）。

#### 取舍分析

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **A Rust 1s watcher 判定到点 + 钳制 accumulated** | 单一事实来源；窗口隐藏/挂起不漏；落点精确 | 每秒一次 DB 读（本地 SQLite，可忽略） | **选定** |
| B 前端 tick 判定到点后调 `stop_timer` | 零额外 Rust 任务 | 窗口隐藏/WebView 挂起即失效；与「状态机归 Rust」相悖 | 不用 |
| C 复用 15s flusher 判定 | 不加任务 | 到点最多迟 15s，倒计时体验差 | 备选（若嫌 1s 任务浪费，可降到 1s 只在 countdown 活跃时启用） |

> **最大风险**：1s watcher 的「无谓空转」（无倒计时时也每秒查库）。缓解：查询走 `uq_records_open` 唯一槽（最多 1 行），且 `mode='countdown'` 早退；实测开销可忽略。**判定：可行。**
> **铃声风险**：WebView 自动播放策略可能拦截「无用户手势」的音频（K-22）→ 降级：首次交互时预热 `AudioContext`；仍被拦则只保留系统通知。

### 6.d 双主题 Token 切换（ADR-012）

#### 方案（前端主导，Rust 只存 `theme.mode`）

- **令牌承载**：两套同变量名、不同值的 CSS 变量。`:root`（或 `:root[data-theme="dark"]`）为深色，`:root[data-theme="light"]` 为浅色。组件 CSS 只引用 `var(--*)`，**零裸 hex**（沿用 V0.1.0 纪律）。
- **ThemeProvider**：`src/components/theme/ThemeProvider.tsx` + `src/lib/theme.ts`：
  - 解析模式：`themeMode='dark'|'light'|'system'`；`system` 时读 `matchMedia('(prefers-color-scheme: light)')` 并按需订阅系统变化。
  - 应用：`document.documentElement.dataset.theme = resolved`。
  - 注入四色：`root.style.setProperty('--color-running', accents.running)` 等（默认不设 = 用令牌值，用户改了才覆盖）。
  - 持久化：设置（`settings.theme.mode`）为**事实来源**，同时写 `localStorage['timing.theme']` 作为**首屏快取**。
- **首屏无白闪（K-18）**：
  1. `index.html` `<head>` 内联引导脚本（在 CSS/React 之前同步执行）：读 `localStorage['timing.theme']`，立即 `document.documentElement.dataset.theme = v || 'dark'`；并设 `color-scheme`。
  2. 窗口 `visible:false`，前端**首帧渲染完成后**再 `show_window`（沿用 K-1/K-18），把「令牌生效」与「窗口可见」错开。
  3. 令牌文件里 `:root` 给 `--bg` 等**兜底默认值**，保证「只设了 data-theme、CSS 尚未解析」也无纯白底。
  4. 主窗（透明）自身无白闪风险；**设置窗 / 事项窗 / 便利贴窗**为新不透明窗，统一走「内联脚本 + visible:false + 兜底背景」三件套。
- **浅色主题对比度（K-17）**：浅色下用户配色（尤其 `accent.running`）**作文字**时对比度不足 → `lib/theme.ts` 提供 `deepenForNonText(hex, bg, 3.0)`：保色相、按 0.05 步进加深至 ≥3:1（非文本场景）；作文字场景用 ≥4.5:1 的 `--color-*-ink` 派生。**具体令牌值由设计师在 `design-tokens V0.2.0` 定稿**（已同步机制契约，见 §12 协同项）。
- **主题切换广播**：`theme_set`/`accent_set` → emit `theme-changed`（**广播所有窗口**），各窗口 ThemeProvider 收到后重设 `data-theme`，实现多窗同步。

#### 取舍分析

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **A HTML 属性 + CSS 变量双套 + 内联引导脚本** | 零依赖；切换瞬时；多窗天然一致；无白闪 | 需维护两套令牌值 | **选定** |
| B React state 挂 class + 条件渲染两套样式 | 纯 JS 可控 | 令牌重复、切换走 React 渲染更慢、易漏 | 不用 |
| C 运行时 `style.setProperty` 逐变量覆盖 | 灵活 | 变量多、维护差、首屏必然闪 | 不用（仅四色用 C 的注入） |

> **最大风险**：浅色主题下对比度回归（尤其用户自定义 accent）。缓解：K-17 的派生函数 + 验收要求「两套主题逐对 ≥ AA」。**判定：可行。**

### 6.e 托盘菜单（ADR-013，答设计师 Q2）

#### 问题本质

Tauri v2 的托盘菜单由 `tray-icon` + `muda` 构造，Windows 平台就是 **`HMENU` + `TrackPopupMenu`** 的原生 Win32 弹出菜单；macOS 是 `NSMenu`。**原生菜单的字体、圆角、阴影、玻璃底一律无法用 CSS 变量控制**——不存在「给原生菜单换皮」的路径。对齐 Timing 的玻璃菜单外观（`tray-menu.md` 的 272px 玻璃面板）只有两条路。

#### 方案对比

| 维度 | 方案 A：保留原生菜单 | 方案 B：禁用原生菜单 + 光标处自绘透明 `WebviewWindow` |
|---|---|---|
| 外观 | 系统默认（不达标，与主 UI 两套语言） | 与 Timing 一致（玻璃 + 状态块 + 按状态裁剪） |
| 键盘导航 | 系统免费提供（↑↓/Enter/Esc/加速键） | **须自绘**：↑↓/Home/End/Enter/Esc/Tab-out，roving tabindex + `aria-activedescendant` |
| 无障碍（读屏） | 系统级 AT 完整支持 | 降级：读屏只能读到 webview 内的 ARIA（口语化描述弱于原生） |
| 失焦/点外部关闭 | 系统行为，天然正确 | 须自管：`WindowEvent::Focused(false)` → `hide()`；`alwaysOnTop:true` 保证可收到 blur |
| 多显示器定位 | 系统在托盘所在屏弹出 | 须自算：`TrayIconEvent::Click{ position }`（物理）+ `scaleFactor` → 目标屏 `work_area` 钳制，边缘翻转（右下角 → 向左上翻） |
| z 序 / 越任务栏 | 系统保证在任务栏之上 | 须 `alwaysOnTop:true + skipTaskbar:true + decorations:false`；show 后 `set_focus()`，与任务栏同处 topmost 带，刚激活者在上 |
| 首次弹出延迟 | 即时 | 新建窗 ~100–200ms → 须**启动时预建隐藏窗**，弹出仅「定位 `set_position` + `show` + `set_focus`」 |
| 新增依赖 | 0 | **0**（复用既有 `WebviewWindow`；原生菜单 2 个菜单项事件改走 `App.tsx` 的 label 路由） |
| 成本 | ~0.5 人日（沿用现托盘） | **~2–3 人日**（窗口 + 菜单位置 + 焦点/关闭 + 键盘 + 边界钳制 + 现有托盘项迁移） |

#### 选定：**方案 A**（保留原生托盘菜单，不自绘）—— 用户裁决

**用户裁决（2026-10-16）**：否决架构最初推荐的方案 B，**保留原生 Win32 托盘菜单**。理由：B 的约 2–3 人日成本相对收益不划算，**用户明确接受「托盘菜单外观与 Timing 不一致」**。（本 doc 初稿曾推荐 B，此处按裁决修订；B 记为未来可选增强。）

据此明确三条：

1. **托盘菜单 = 原生**：`tray-icon` + `muda`（Windows `HMENU` + `TrackPopupMenu`），**不自绘**。沿用 V0.1.0 托盘机制；「按状态裁剪」通过**状态变化时重建原生菜单**实现（原生菜单原生支持分组 / 分隔 / 启用禁用）。
2. **应用内菜单仍走自绘玻璃**：小条右键 / 事项右键 / 便利贴右键均在 `WebviewWindow` 内绘制，**不受此裁决影响**，继续用 `GlassMenu`（`src/components/menu/GlassMenu.tsx`）。
3. **托盘菜单失去「玻璃外观」；「状态块」降级保留**：① 玻璃外观——**失去**（原生菜单无法自绘）；② 状态块——**降级为顶部一条禁用文本项**（见下「内容组织」），不再是富样式可视块。**依赖核查：无别处依赖被破坏** —— `MenuStatusBlock` **组件**在**应用内悬浮菜单**中仍原样复用（`tray-menu.md §1` 的「与悬浮菜单共用」即此；托盘不再调用它）；玻璃外观仅托盘退回系统观感，其余弹层/面板不受影响。

#### 托盘菜单内容组织（方案 Ⅰ — 定案）

**控制组按状态裁剪**（状态变化时重建原生菜单）：

| 状态 | 控制组显示项 | 常态项数 |
|---|---|---|
| 空闲 | 仅「开始正计时」 | ~8 |
| 正计时中 | 「暂停」+「结束并写入事项计时」+「放弃（不记录）」 | ~10 |
| 倒计时中 | 同上（结束项含倒计时语义） | ~10 |
| 暂停中 | 「继续」+「结束并写入事项计时」+「放弃（不记录）」 | ~10 |

「视图 / 打开 / 系统 / 退出」四组**常显**。裁剪后常态约 **8–10 项**（对比原 16 项平铺）。

**状态块降级（取 B：顶部一条禁用文本项）**——`enabled=false` 文本项，文案与 `MenuStatusBlock` 同口径：空闲 `空闲 · 点开始正计时`；计时中 `任务名 · 12:34` / `任务名 · 倒计时 · 剩 07:26`；暂停中 `任务名 · 已暂停`（+ 时长）。**技术约束**：

- **纯文本、无圆点/无富样式**（原生菜单无法渲染我们的 lucide SVG；见下 P0 注）。
- **任务名须在 Rust 侧先截断**（建议 ≤ ~20 显示宽，超长加省略号）——原生菜单**按最宽项撑大整菜单、不自动省略**，任务名过长会撑宽整个菜单（K-30）。
- **重建时机**：菜单结构**只在状态迁移时重建**；「剩 07:26」的秒级变化用 `MenuItem::set_text`（muda/Tauri 提供；若本版本不可用则退化为「状态文本在重建时快照」）更新，**禁止每 tick 重建菜单**（K-30）。
- 原生菜单**打开时不一定即时重绘** `set_text` → 状态文本按「**展开瞬间快照**」对待，够用（可接受）。

> **P0 注（字符符号）—— 已裁定：纯文本**：设计稿状态前缀原用了一个圆点字符 **U+25CF（BLACK CIRCLE）**。原生菜单项**无法携带我们锁定的 lucide SVG**，而团队 P0 要求功能图标必须是统一描边的 SVG、禁止 emoji / 字符符号充当图标。**裁决（2026-10-16，P0 从紧）：托盘状态项一律纯文本**（`摸鱼 · 12:34` / `倒计时 · 剩 07:26` / `空闲 · 点开始正计时`），**不加任何圆点字符**。

**副产物（正向）**：原生菜单**自动跟随系统深色模式**；键盘导航、无障碍（读屏）、失焦/点外部关闭、多显示器定位、任务栏层级**全部由系统保证**，无需自管；零新增依赖、零新窗口。
> 注意（K-29）：原生菜单**跟随 OS 明暗、不跟随应用 `data-theme`** → 应用设浅色而系统深色时托盘与主 UI 明暗不一致，**已接受**。托盘仅保留信息架构，不承诺与应用主题同色；应用内菜单不受影响。

**落地约束**：
- 托盘图标 `TrayIconBuilder` + 原生菜单；「显示/隐藏」「退出」等即原生菜单项，事件走既有 `on_menu_event`。
- **重建 vs 更新分工**：**状态迁移 → 重建菜单结构**（裁剪控制组）；**状态文本秒级刷新 → `set_text`**（不重建）。不做每 tick 重建。
- **IPC 增量不变**：托盘菜单**不新增命令**，服务端契约仍 52 条（§5）。

**记录**：方案 B（自绘玻璃托盘）**降级为「未来可选增强（v0.3+）」**，完整约束与风险保留在 ADR-013「未来可选增强」节，**勿删**；K-25 仅在届时启用 B 时才适用。

### 6.f 中文层级字重与字体栈（答设计师 Q3）

#### 问题

`Microsoft YaHei UI` / `Microsoft YaHei` 仅含 **Light(300) / Regular(400) / Bold(700)** 三字面，**无 500/600/650**。设计稿里「SemiBold 600 / Medium 500」的中文标题，在 Windows 上要么回落 400、要么浏览器合成伪粗体（`font-synthesis`），两者都不精确。

#### 架构裁定（Phase 3 锁口径）

1. **字体栈（Latin 优先，CJK 回落）**——数字/拉丁走 `Segoe UI Variable`（字面齐全，含多档字重），中文才回落雅黑：
   ```text
   --font-ui: system-ui, "Segoe UI Variable Text", "Segoe UI",
              "Microsoft YaHei UI", "Microsoft YaHei",
              "PingFang SC", "Noto Sans CJK SC", sans-serif;
   --font-mono: ui-monospace, "Cascadia Mono", "Consolas",
                "Microsoft YaHei UI", monospace;   /* 计时数字 */
   ```
   > **计时数字（正/倒计时主数字）单独用 `--font-mono` + 拉丁字面**，因此**数字能吃到完整字重档**（这是计时 App 最关键的一处字重表达），不受中文三字面限制。
2. **中文层级字重规则（Spec 落地）**：中文「层级」**不用 500/600/650**，改用 **{400, 700}** 两档 + **字号 + 颜色（`--ink/--ink-2/--ink-3/--ink-4`）+ 字距**承载。即：设计稿的 500/600 中文标题 → **映射到 400 且加深一档 ink + 略增字号**；需要「重」时用 700。
3. **禁止伪粗体**：`body { font-synthesis-weight: none; }`——避免浏览器为「不存在的 600」合成加粗（会糊、跨机不一致）。
4. **是否内联字体**：**MVP 不内联**。Windows 目标机雅黑/Segoe 均在，内联 CJK 可变字体（Source Han Sans / Noto Sans SC）会 +10~20MB 包体，违背 V0.2.0「轻」基调。若未来跨平台（macOS/Linux）或要求「三档字重精确」，再引入**可变 CJK 字体**并同步 `--font-ui`——属 v0.3 议题。

> 与设计师口径一致：**Spec 阶段按 WebView2 实测锁定**每个中文层级的最终 `{font-weight, font-size, color, letter-spacing}` 组合，本架构只锁「只用 400/700 + 禁用合成」这条纪律。

### 6.g 玻璃材质立场反转确认（答设计师 Q4）

#### 结论：立场反转（V0.1.0 拒 `backdrop-filter` → V0.2.0 采用玻璃）**技术上无坑，前提是「玻璃 = 板不透明 + 文字不透明」而非「真桌面模糊」**。

#### 关键事实（联网核实）

- **`backdrop-filter` 只作用于 webview 内部层级，无法穿透到 OS 窗口管理器**。即：它模糊的是**同一网页里、位于该元素背后**的内容，**不能**把「桌面/其它应用」模糊进来。想让桌面透过透明窗被模糊，必须用 **Tauri 的 Window Effects API**（`set_effects` / `EffectsBuilder` + `Effect::Acrylic|Mica|Blur`），且**要求窗口 `transparent:true`**；Windows 上 `Acrylic` 需 Win11 22H2+，旧系统自动降级；`Acrylic` 在**拖窗时**有已知性能抖动。
- 设计师的规格是「**高不透明度板（`--menu-bg` 94%/97%）+ 文字 100% 不透明**」——这是**板式拟玻璃**（板近乎不透明，只在边缘/层叠处用轻 `backdrop-filter` 处理 webview 内层级），**不依赖 OS 桌面模糊**。**故此方案安全**：不碰 `Acrylic/Mica`，无平台降级问题、无拖拽抖动、无 Linux 不支持问题。

#### 与 K-1 白闪的关系

- **白闪与 `backdrop-filter` 无关**。原因是 WebView2 首帧绘制前显示其默认背景（白/黑）。`backdrop-filter` 是**内容绘制之后**的合成步骤，既不引发也不消除白闪。
- 但**加了模糊层会略微抬高首帧合成成本** → 更要坚持「`visible:false` → 首帧就绪 → `show()`」的握手（K-1/K-18）。透明窗（主小条）自身即透明，无白闪；新增的**设置/事项/便利贴为不透明窗**，白闪风险源于「不透明背景本身晚于首帧」，同样由三件套兜住。

#### 落地约束

1. **主小条（`main`，常驻、可拖拽）不挂任何背景模糊**——避免 `Acrylic`/大面 `backdrop-filter` 在拖动时的合成开销；保持纯透明 + 实心元素。
2. **玻璃只用于弹层/面板**（`GlassMenu`、悬浮菜单、托盘菜单），且**板不透明度 ≥94%**（对齐令牌 `--menu-bg`）；模糊半径克制（webview 内层级），避开「动态内容上持续滤镜」的已知性能坑。
3. **若 Phase 3 判定仍需「真桌面模糊」**（Timing 观感硬指标）：启用 `set_effects([Acrylic])`，写入**独立已知坑 K-27**，标注平台降级（Win11 22H2+）与拖拽抖动，且**仍不用于主小条**。**默认不启用**（板式玻璃已达标）。
4. **组件 CSS 纪律不变**：玻璃相关的裸 rgba 只允许出现在令牌定义层与 `--shadow-*` 组；组件层一律 `var(--menu-bg)` 等（§10 #14）。

---

## 7. 目录结构扩展（落地为可执行约束，单文件 ≤ 300 行）

```
src/                                  # 前端（表现层）
├── index.html                                # * 加 <head> 内联主题引导脚本（K-18）
├── App.tsx                                   # * 按窗口 label 路由根组件（主窗/note-*/todos/settings）
├── components/
│   ├── pill/…                                # 既有（小条随名伸缩 → PillBar/TimerDisplay 微调）
│   ├── note/                                 # * 便利贴窗口：StickyNoteWindow / NoteHeader / NoteBody
│   ├── todo/                                 # * 事项窗口：TodosWindow / TodoRow / TodoAddBar / StatusSection
│   ├── theme/ThemeProvider.tsx               # * 主题上下文
│   ├── countdown/CountdownMenu.tsx           # * 倒计时时长菜单
│   ├── reminder/ReminderPopover.tsx          # * 提醒设置气泡
│   ├── common/CommonItemsMenu.tsx            # * 常用事项 / 固定任务
│   ├── menu/GlassMenu.tsx                    # * 自绘玻璃菜单（应用内：小条/事项/便利贴右键；键盘导航 + role=menu）
│   └── …（既有 ui/ records/ settings/ recover/ undo/）
├── hooks/useNoteWindowSync.ts                # * 便利贴内容防抖落盘
├── lib/
│   ├── theme.ts                              # * 主题解析 + 四色注入 + deepenForNonText
│   ├── windows.ts                            # * 窗口 label 解析 + 逻辑/物理像素换算 + 钳制
│   └── …（既有 format/ icons/ time/ constants）
├── stores/noteStore.ts / todoStore.ts        # * 新增；既有 timer/item/settings/ui 扩字段
└── types/domain.ts                           # * 扩类型（见 §5.4）

src-tauri/src/                         # 后端（四层）
├── commands/                                 # 命令层（薄）
│   ├── note_cmd.rs / todo_cmd.rs             # *
│   ├── window_cmd.rs                         # * open/close 多窗口（含 note/todos/settings）
│   ├── theme_cmd.rs / reminder_cmd.rs        # *
│   ├── timer_cmd.rs                          # * 加 start_countdown
│   └── …（既有 item/settings/record/system）
├── services/                                 # 业务层
│   ├── note.rs / todo.rs / theme.rs / reminder.rs   # *
│   └── timer.rs                              # * 加 countdown 分支
├── repositories/                             # 数据层（仅 SQL）
│   └── note.rs / todo.rs                     # *
├── models/                                   # * note.rs / todo.rs / theme.rs（+ enums/constants 扩）
├── infra/
│   ├── migrate.rs                            # * 列守卫幂等迁移（§4.5）
│   ├── windows.rs                            # * 多窗口创建/恢复/钳制（ADR-009）
│   ├── notify.rs                             # * 系统通知封装（tauri-plugin-notification）
│   ├── reminder.rs                           # * 提醒后台调度
│   ├── countdown.rs                          # * 倒计时到点后台调度
│   └── …（既有 db/clock/events/runtime/setup/window；tray.rs **基本不变**：保留原生托盘菜单，ADR-013）
└── migrations/0001_init.sql                  # 不变；schema-V0.2.0.sql 由 migrate.rs 引用
```

**文件组织硬规则不变**（`code-organization.md` / v1 §3.4）：单一职责、单文件 ≤ 300 行、按资源分包（命令+服务+仓库三件套）、入口只装配、依赖只向下、前端 `invoke` 只经 `services/ipc.ts`、`listen` 必配 `unlisten`。

---

## 8. 锁定的 SVG 图标库（P0 强制，沿用）

**唯一图标库：`lucide-react@1.57.0`（已安装，实测存在）**。禁止 emoji、禁止字符符号（U+2713/U+26A0/U+2714/U+274C 等）、禁止混用其它图标库。集中出口仍为 `src/lib/icons.ts`，组件禁止直接 import `lucide-react`。

**V0.2.0 新增图标（全部已对已安装的 `lucide-react@1.57.0` 导出名逐一核实）**：

| 用途 | Lucide 图标名 | 状态 |
|---|---|---|
| 便利贴 | `StickyNote` | 已核实存在 |
| 便利贴收纳（最小化） | `Minimize2` | 已核实存在 |
| 固定 / 取消固定（事项、便利贴） | `Pin` / `PinOff` | 已核实存在 |
| 提醒铃 | `Bell` / `BellOff` | 已核实存在 |
| 倒计时 | `Timer` / `TimerReset` / `AlarmClock` | 已核实存在 |
| 倒计时时长/计划 | `CalendarClock` | 已核实存在 |
| 主题：深 / 浅 / 跟随系统 | `Moon` / `Sun` / `Monitor` | 已核实存在 |
| 配色 | `Palette` / `Droplet` | 已核实存在 |
| 待办 / 完成 | `ListTodo` / `SquareCheck` / `CircleCheckBig` | 已核实存在 |
| 常用事项 / 最近 | `Star` / `Clock3` | 已核实存在 |
| 事项窗口视图切换 | `LayoutList` / `ListChecks` | 已核实存在 |
| 展开更多 / 折叠 | `ChevronRight` / `ChevronsUpDown` | 已核实存在 |
| 菜单更多 | `Ellipsis` | 已核实存在 |
| 外观设置 | `SlidersHorizontal` | 已核实存在 |
| 删除 / 编辑 / 新建 / 撤销（沿用） | `Trash2` / `Pencil` / `Plus` / `Undo2` | 已核实存在 |

> 描边规范沿用 `src/lib/icons.ts`：16px → strokeWidth 2.5；20/24px → 2。
> 核实方式：对 `node_modules/lucide-react/dist/lucide-react.d.ts` 的导出表逐名 grep（结果见实现记录）。**实现时新增任何图标，必须先核对该文件导出名再写入 `icons.ts`**（K-12）。

---

## 9. 新增已知坑（延续 K-13 起，Phase 3 硬约束）

| # | 坑 | 硬约束 |
|---|---|---|
| K-13 | SQLite **不支持** `ALTER TABLE ADD COLUMN IF NOT EXISTS`，重复 `ADD COLUMN` 报 `duplicate column name` | 加列一律经 `infra/migrate.rs::ensure_column`（`PRAGMA table_info` 守卫）；新表/索引一律 `IF NOT EXISTS`（§4.5） |
| K-14 | 多便利贴 = 多 WebView，内存随窗口数线性增长 | `MAX_NOTE_WINDOWS = 20`；关闭即 `destroy()`（不留隐藏窗）；便利贴窗口不加载 PillBar 全量 store 与后台 tick |
| K-15 | 便利贴 `Moved`/`Resized` 是**物理像素** | 存逻辑坐标须除 `scaleFactor`；恢复时按显示器 `work_area` 钳制，越界回落主屏（K-6 同源） |
| K-16 | Windows toast 需 **AppUserModelID**；dev 态可能不弹；专注助手会吞通知 | 打包写 AUMID（NSIS/MSI）；通知失败回滚 `reminded_at` 以便重试；应用内 `reminder-fired` / `countdown-finished` 事件保证有可视提示 |
| K-17 | 浅色主题下用户 accent 作文字对比度不足 | 浅色非文本 ≥3:1、文本 ≥4.5:1 派生（`deepenForNonText`）；两套主题逐对 AA 纳入验收 |
| K-18 | 主题在首屏后异步加载 → 白闪 | `index.html` 内联脚本同步读 `localStorage['timing.theme']` 设 `data-theme`；新窗 `visible:false` 首帧后 `show()`；令牌 `:root` 给兜底 `--bg` |
| K-19 | 提醒无去重标记 → 每 tick 重复弹通知 | 落 `reminded_at`；扫描条件含 `reminded_at IS NULL`；`reminder_set` 重设时清 `reminded_at` |
| K-20 | 倒计时到点若由前端判定，窗口隐藏/挂起会漏触发 | 到点判定归 Rust 的 `countdown_watcher`（1s）；结束时 `accumulated_sec` 钳到 `target_sec`，`ended_at = started_at + target*1000` |
| K-21 | `app.emit` 广播**所有** webview，多窗会互相误收事件 | 窗口专属事件用 `emit_to(label, ...)`；广播事件（`theme-changed`）各窗按 label 自行判定是否响应；便利贴/待办窗**忽略** `timer:state-changed` |
| K-22 | WebView 音频自动播放可能被策略拦截（铃声） | 首次用户交互时预热 `AudioContext`；被拦则降级为仅系统通知，不阻塞到点语义 |
| K-23 | 便利贴内容高频输入 → 频繁 IPC 落盘 | 内容变更 300ms 去抖 + 失焦立即落盘；几何变更 300ms 去抖（与内容分开计时） |
| K-24 | Tauri v2 托盘菜单是 `muda` **原生 Win32 `HMENU`+`TrackPopupMenu`**，**无法自绘/换皮** | **已接受**：托盘保留原生、不自绘（ADR-013 用户裁决）；要玻璃外观须回方案 B（v0.3+）。**应用内菜单不受影响**（WebviewWindow 内走自绘玻璃） |
| K-25 | 自绘托盘菜单（方案 B）的**焦点/关闭竞态**：弹出夺焦 → 可能「弹出即失焦即隐藏」；`alwaysOnTop` 下 blur 事件可能丢 → 「点外部不关」 | **本期 N/A**（未采用方案 B）；**仅当 v0.3+ 启用方案 B 时适用**：弹出后显式 `set_focus()`；关闭用 `Focused(false)` + 150ms 兜底校验前台窗；双屏 + 任务栏移位专项验收 |
| K-26 | `backdrop-filter` **只模糊 webview 内部层级，不穿透 OS 窗口管理器**；「真桌面模糊」须 `set_effects([Acrylic/Mica])` 且窗口 `transparent:true` | 玻璃采用「板不透明（≥94%）+ 文字不透明」的**板式拟玻璃**，默认不启用 OS 效果（§6.g）；主小条禁止挂模糊 |
| K-27 | Windows `Acrylic/Mica` 需 **Win11 22H2+**（旧系统自动降级）；`Acrylic` 拖窗时合成抖动 | **默认不启用**；若 Phase 3 判定必须真桌面模糊才启用，且**排除主小条/拖拽面**，标注平台降级为可接受 |
| K-28 | `Microsoft YaHei UI` 仅 Light/Regular/Bold（**无 500/600/650**）；缺档字重会触发浏览器**伪粗体合成**（糊、跨机不一致） | 中文层级只用 **{400,700}** + 字号/颜色（`--ink*`）/字距承载；`font-synthesis-weight:none` 禁合成；计时数字走 `--font-mono` 拉丁字面以取全档字重（§6.f） |
| K-29 | 原生托盘菜单**只跟随 OS 明暗，不跟随应用 `data-theme`** → 应用设浅色而系统深色时，托盘菜单与主 UI 明暗不一致 | **已接受的局限**（原生菜单代价）。缓解：托盘菜单**只保留信息架构**（分组/裁剪/启用禁用），**不承诺与应用主题同色**；应用内菜单不受影响（走 `data-theme`）。若要求一致须回方案 B（v0.3+） |
| K-30 | 原生菜单项**按最宽项撑大整菜单、不自动省略**；且**每 tick 重建菜单有开销**、`set_text` 打开时不一定即时重绘 | 状态项/项标签的任务名**在 Rust 侧先截断**（≤ ~20 显示宽 + 省略号）；**只在状态迁移时重建**菜单结构，秒级状态文本用 `MenuItem::set_text` 更新（**禁止每 tick 重建**，K-30）；状态文本按「展开瞬间快照」对待 |

---

## 10. 技术约束清单（增量）

V0.1.0 的 10 条全部继续有效，追加：

11. 多窗口：便利贴独立 `WebviewWindow`（`note-{id}`），上限 20；设置窗/事项窗为**单例**（`settings` / `todos`）。开启窗口数在启动时按 `notes.is_open=1` 恢复。
12. 提醒与倒计时到点由 **Rust 后台任务**驱动（提醒 15s 扫描查询式；倒计时 1s 到点判定）；前端只显示与播铃声。
13. 通知依赖 `tauri-plugin-notification` **2.7.0**（唯一新增依赖）；铃声用 Web Audio，零新增依赖。
14. 主题：令牌双套（`data-theme` 切换）+ 四色运行时注入；组件 CSS 零裸 hex（仅 `:root` 令牌定义层 + `--shadow-*` 阴影组 + 注入的 `--color-*` 例外）。**V0.2.0 阴影令牌由 v1 的 `--elev-*` 更名为 `--shadow-*`**（flat/ring/pop/plate/float/panel/balloon/inset）——设计师已提供同名过渡别名。
15. 图标：唯一 `lucide-react@1.57.0`；新增图标必须核对已安装导出名（§8）。
16. 托盘：**保留原生托盘菜单**（`muda`/Win32 `HMENU`），**不自绘**；**按状态裁剪（方案 Ⅰ）**——状态迁移时**重建原生菜单**（空闲仅可用项 / 计时中「暂停·结束·放弃」/ 暂停中「继续·结束·放弃」，常态约 8–10 项；视图/打开/系统/退出常显）；**状态块降级为顶部一条禁用文本项**（同 `MenuStatusBlock` 文案口径，纯文本无圆点，任务名先截断；秒级刷新用 `set_text`，不重建）。**应用内菜单**（小条/事项/便利贴右键）走自绘玻璃 `GlassMenu`，键盘导航与 ARIA 由其自管（ADR-013）。
17. 玻璃：采用**板式拟玻璃**（板不透明度 ≥94% + 文字 100% 不透明），**默认不启用** OS 级 `Acrylic/Mica`；主小条不挂任何模糊（§6.g / K-26 / K-27）。
18. 字体：`--font-ui` Latin 优先 → CJK 回落；**中文层级只用 {400,700}**，禁伪粗体（`font-synthesis-weight:none`）；计时数字走 `--font-mono` 拉丁字面（§6.f / K-28）。

---

## 11. 端到端验证增量（Phase 3 用，追加到 v1 §8）

```text
# 9. 待办与事项窗口
#   - 小条右键 → 打开事项窗口；四状态（已完成/进行中/待进行/待办）视觉可区分（灰度打印仍可辨）
#   - 新增待办 → 勾选完成 → done_at 置位；取消勾选 → 回到未完成
#   - 待办设提醒 → 到点弹系统通知 + 主窗提示；同一条不重复弹（等 2 个扫描周期）

# 10. 便利贴多窗口
#   - 主窗创建便利贴 → 出现独立窗；拖动/缩放到副屏 → 重启后位置与尺寸还原到副屏
#   - 未悬停时背景/边框透明只剩正文；悬停浮出背景
#   - 「收纳」关闭 → 重启后不恢复；从列表重开 → 恢复到原位置
#   - 连续开到第 21 张 → 提示「已达上限」（WINDOW_LIMIT_EXCEEDED），不崩溃

# 11. 倒计时
#   - 选时长开倒计时 → 数字递减；暂停 → 停住；继续 → 从停点继续
#   - 到点 → 自动结束（saved，时长=target）+ 系统通知 + 铃声；记录时长精确等于 target
#   - 手动提前结束 → saved，时长=实际经过；不播铃声

# 12. 双主题
#   - 切浅色 → 全窗口（小条/设置/事项/便利贴）同步换肤，无白闪（冷启动 + 切换各测一次）
#   - 改四色 → 计时环/提醒/完成/小条底色即时变化；非法 hex 被拒（INVALID_COLOR）
#   - 跟随系统 → 改系统主题 → 应用跟随

# 13. 后端迁移与老库共存
#   - 用 V0.1.0 生成的 timing.db 启动 V0.2.0 → 自动加列/建表成功，历史记录/设置不丢
#   - 连续启动两次 → 无 duplicate column 报错（幂等）

# 14. 托盘菜单（原生，ADR-013；方案 Ⅰ）
#   - 托盘图标右键 → 系统原生菜单弹出；「视图/打开/系统/退出」组常显
#   - 控制组随状态裁剪：空闲仅「开始正计时」；计时中「暂停/结束/放弃」；暂停中「继续/结束/放弃」；常态约 8–10 项
#   - 顶部禁用文本项显示状态：空闲「空闲 · 点开始正计时」；计时中「任务名 · 12:34」；倒计时「任务名 · 倒计时 · 剩 07:26」
#   - 超长任务名 → 状态项/标签截断为省略号，不撑宽整菜单（K-30）
#   - 状态迁移时菜单结构重建；秒级状态文本用 set_text（不每 tick 重建）
#   - 切换系统深色模式 → 原生菜单跟随（系统行为）；应用内切主题 → 托盘不跟随（K-29，已接受）
#   - 多显示器：菜单在托盘所在屏弹出（系统行为）
#   - 应用内右键（小条 / 事项 / 便利贴）→ 自绘玻璃菜单正常，与托盘菜单互不影响

# 15. 中文层级字重（K-28）
#   - 设 `font-synthesis-weight:none` 后，中文标题在 400/700 两档下均无伪粗体糊边
#   - 计时数字随字重档变化有可辨差异（拉丁字面生效）

# 16. 玻璃与白闪（K-26）
#   - 玻璃弹层/面板在深/浅两主题下观感一致，板不透明度 ≥94%，文字 100% 不透明
#   - 冷启动主小条 / 新增三窗（设置/事项/便利贴）均无白闪（含浅色主题冷启动）
#   - 主小条拖动全程无模糊合成抖动（未挂 backdrop-filter/Acrylic）
```

---

## 12. 交付物与协同

### 12.1 本 Phase 产出物（架构侧）

- `docs/phase1/ARCHITECTURE-V0.2.0.md`（本文）
- `docs/phase2/schema-V0.2.0.sql`（5 表全量 DDL + 增量迁移）
- `docs/decisions/ADR-009.md`（多窗口管理）
- `docs/decisions/ADR-010.md`（后台提醒调度）
- `docs/decisions/ADR-011.md`（倒计时状态机扩展）
- `docs/decisions/ADR-012.md`（双主题）
- `docs/decisions/ADR-013.md`（托盘菜单：保留原生、不自绘；自绘方案记为 v0.3+ 可选增强）
- `src/types/domain.ts`（新增类型 + 命令签名，保持现有风格）

### 12.2 协同项

- **设计师（颜好看）**：双主题**机制契约**已发（`data-theme` 属性 + 四色 CSS 变量名 `--color-running/warn/done/bar` + 浅色 accent 派生 `deepenForNonText` + 首屏兜底），令牌**值**由 `UIUX-V0.2.0` / `design-tokens-V0.2.0` 定稿；两文档变量名须与本文 §6.d 一致。**已回设计师的 4 个架构问题**：Q1 多窗口模型（§6.a）、Q2 托盘菜单（§6.e，**结论：保留原生、不自绘【用户裁决】，自绘降级 v0.3+，ADR-013**）、Q3 中文层级字重（§6.f，结论：只用 400/700 + 禁伪粗体 + 计时数字走拉丁字面）、Q4 玻璃立场反转（§6.g，结论：板式拟玻璃安全，默认不启用 OS Acrylic）。阴影令牌 `--elev-*`→`--shadow-*` 更名已确认，设计师提供过渡别名。
  - **托盘菜单需回设计师的口径变更**：`tray-menu.md` 自绘玻璃规格**本期不落地**——托盘退回**原生菜单外观**，仅保留**信息架构**（分组/分隔/启用禁用/按状态裁剪）；**玻璃外观与状态块两项在托盘内失去**（状态块在应用内悬浮菜单仍保留）。应用内菜单（小条/事项/便利贴右键）**仍走自绘玻璃**，不受影响。Q1 多窗口目录（§6.a）**不含 `tray-menu` 窗**。
- **PM**：`ARCHITECTURE-V0.2.0` 的新错误码（5 个）、新事件（5 条）须并入 `PRD-V0.2.0` 的验收口径。
- **team-lead**：需确认的下游事项见 §12.3。

### 12.3 待裁决项（不阻塞 V0.2.0-2）

| # | 议题 | 架构侧建议 |
|---|---|---|
| A-6 | 便利贴是否 topmost（钉在其它窗口之上） | 建议 `alwaysOnTop:false`（桌面配件、非覆盖层）；若要「永远可见」给便利贴单独置顶开关，交设计师/用户定 |
| A-7 | 提醒扫描粒度 15s 是否够 | 建议 15s（迟到 ≤14s）。若要求分钟级精准，改 5s（成本可忽略） |
| A-8 | 倒计时 24h 上限 | 建议上限 `targetSec <= 86400`（>24h 用正计时更合理），交 PM 确认 |
| A-9 | 便利贴窗口上限 20 | 建议 20（内存护栏）；实际用量通常 1–5，够用 |
| A-10 | ~~托盘菜单内容组织（裁剪 vs 全量）~~ **已关闭（2026-10-16，用户裁决）** | **结论：方案 Ⅰ = 原生 + 按状态裁剪**（空闲仅「开始正计时」等可用项；计时中/暂停中控制组；常态约 8–10 项；视图/打开/系统/退出常显）+ **状态块降级为顶部禁用文本项**。见 §6.e 与 §10 #16 |
| A-11 | 玻璃是否需「真桌面模糊」（启用 OS `Acrylic/Mica`） | 默认不启用（板式玻璃已达标）。若要求桌面透过模糊，启用 `set_effects`，见 K-27；**排除主小条** |

---

## 参考来源（新增，联网核实 2026-10-16）

- Tauri 多窗口（WebviewWindowBuilder / label 路由）：https://v2.tauri.app/learn/window-customization/ 、https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/
- Tauri 事件广播与 `emit_to`：https://v2.tauri.app/develop/calling-frontend/
- tauri-plugin-notification（crate 2.7.0 / npm 2.7.0）：https://crates.io/api/v1/crates/tauri-plugin-notification 、https://v2.tauri.app/plugin/notification/
- Windows AppUserModelID 与 toast 限制：Microsoft Docs（Notifications overview，Windows App SDK）
- SQLite `ALTER TABLE` 限制（不支持 ADD COLUMN IF NOT EXISTS / ADD COLUMN 带 CHECK）：https://sqlite.org/lang_altertable.html
- SQLite 部分索引（partial index）：https://sqlite.org/partialindex.html
- 参考项目 `Timing_v1.7.0`：`README/DESIGN/DESIGN-SYSTEM.md`（令牌 / 便利贴 / 六屏 / 托盘裁剪）、`docs/DATA-STORAGE.md`（便利贴落点语义）
- 已安装依赖实测：`node_modules/lucide-react/dist/lucide-react.d.ts`（图标导出名逐一核实）
- Tauri v2 托盘菜单为原生 Win32 `HMENU`+`TrackPopupMenu`（`tray-icon`/`muda`），不可自绘：https://blog.plfjy.top/tray-right-click-menu （本期据此**保留原生菜单**，ADR-013）
- Tauri v2 窗口特效 `set_effects`/`WindowEffectsConfig`（Acrylic/Mica/Blur，需 `transparent:true`，Win11 22H2+）：https://tauri-v2.netlify.app/reference/javascript/api/namespacewebviewwindow （`setEffects`，Since 2.0.0）
- WebView2 `backdrop-filter` 仅作用于 webview 内部、不穿透 OS 窗口层：https://blog.csdn.net/gitblog_00745/article/details/151442759
