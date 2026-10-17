# Spec — TickBar v1.0

> 生成日期：2026-10-16
> 基于：PRD v1（许清楚）+ 架构文档 v1 / ADR-001~006（高见远）+ UIUX 文档 v1（颜好看）
> 状态：**已确认**（用户于 2026-10-16 确认三文档，并裁决 3 项：一键结束并保存 / 托盘+自启进 MVP / 图标库口径统一）
> 本文为团队内部**规格契约**：后续 Phase 2 设计细化、Phase 3 开发、Phase 4 测试**均以本文为唯一依据**。任何字段/契约增删改，必须先改本文再改代码。

---

## 1. 产品定义

- **一句话描述**：TickBar 把"我到底把时间花在哪了"压缩成桌面上一颗永远可见的小药丸——点一下开始，点一下暂停，右键结束，时间自动落到对应事项上。
- **目标用户**：按小时/按项目收费、在多个客户与事项间高频切换的 Windows 自由职业者与知识工作者（独立设计师、远程开发者、写作者、顾问）。
- **核心问题**：现有计时工具的第一失败原因是「忘记开始/停止计时」；自动记录类工具做不了"事项/客户归属"，手动计时类仍靠人记得点；且"常驻可见"形态现有实现普遍很糟（置顶失效、遮挡、无手柄）。

---

## 2. MVP 范围（锁定——不在此列表的功能一律不做）

### 2.1 P0（MVP 必交付）

| 优先级 | 功能 | 验收标准摘要 | 来源 | RICE |
|--------|------|-------------|------|------|
| P0-1 | 悬浮药丸计时条 + 交互状态机 | 常驻置顶药丸条；左键开始/暂停/恢复，右键单击结束并保存；等宽数字不抖动 | PRD P0-1 | 5.00 |
| P0-2 | 事项的创建与归类 | 新建事项、切换事项、无事项时以系统事项「未归类」承接 | PRD P0-2 | 5.40 |
| P0-3 | 本地持久化与计时不丢（崩溃恢复） | SQLite 持久化；运行中每 15s 落盘；异常退出后重启可恢复，丢失 ≤30s | PRD P0-3 | 5.00 |
| P0-4 | 今日/本周按事项的记录查看与汇总 | 展开面板展示按事项聚合时长 + 总计 + 明细 | PRD P0-4 | 3.20 |
| **P0-5** | **系统托盘常驻（图标 + 菜单 + 单击显隐 + 关闭转隐藏）** | 托盘图标常驻；菜单含显示/隐藏、新建事项、设置、退出；左键单击切换显隐 | 原 PRD P1-1，**用户裁决提前** | 6.00 |
| **P0-6** | **开机自启（设置项可开关）** | 设置中开关；写 HKCU Run；重启后自动启动；可一键关闭不留隐藏启动项 | 原 PRD P1-1，**用户裁决提前** | — |

> 核心闭环：**看到 → 点开始 → 落到事项 → 看汇总**。六项 P0 构成完整可交付闭环。

### 2.2 P1（本期不做实现，仅记录，禁止镀金）

| 优先级 | 功能 | RICE | 备注 |
|--------|------|------|------|
| P1-1 | 全局快捷键（显示/隐藏、开始/暂停、结束、新建） | 4.27 | 架构已预置插件能力 |
| P1-2 | 记录补记与手动编辑 | 3.84 | 直接对冲"忘记计时" |
| P1-3 | 周/月汇总与 CSV 导出 | 2.80 | |
| P1-4 | 闲置检测与超时提醒 | 2.56 | |
| P1-5 | 悬浮条外观设置（位置记忆/贴边/透明度/尺寸） | 2.13 | |
| P1-6 | 本地匿名统计（默认关闭，需显式开启） | — | 保持"零遥测"叙事干净 |

---

## 3. 明确不做（Out-of-Scope — 锁定）

> 开发中如有人提出以下功能，**直接拒绝**，走变更流程需回到 Phase 0。

| 不做的功能 | 原因 | 何时考虑 |
|------------|------|----------|
| 账号体系 / 登录注册 | 与"纯本地、免登录"核心定位冲突 | 不做 |
| 云端存储 / 多设备同步 | 无后端为既定约束；触达隐私红线 | 不做 |
| 团队协作 / 成员管理 / 权限 | 面向单机个人用户，会滑向红海 | 不做 |
| 客户 CRM / 项目管理 / 发票 | 会让产品变重（Tympi 路线） | v2 视反馈 |
| 被动屏幕/窗口自动记录 | 与"零遥测"卖点冲突 | 不做 |
| 跨平台（macOS/Linux/移动端） | 聚焦 Windows 单机切入 | v2 视反馈 |
| 番茄钟 / 专注屏蔽 / 白噪音 | 属"专注工具"能力，非时间记录核心 | 不做 |
| AI 自动事项归类 | 无历史数据支撑 | 长期 |
| 浏览器扩展 / 第三方集成 | 增加维护面，非个人 MVP 必需 | 不做 |
| 主题市场 / 皮肤 / 复杂动画 | MVP 只需一套克制深色主题 | 不做 |
| 社交 / 排行榜 / 打卡分享 | 与个人时间记录价值无关 | 不做 |
| 自动更新（updater）/ 多语言 i18n | 本期仅简体中文，代码预留 i18n 接口 | v2 |

---

## 4. 技术架构（锁定 — 含版本锚定）

> 本项目**无 HTTP 后端、无 REST、无网络请求**。桌面壳 = Tauri 2（Rust），前端 = React 19。技术选型依据 ADR-001~006。

| 层 | 技术 | 锁定版本 | 锁定原因 |
|----|------|----------|----------|
| 桌面框架 | Tauri（Rust crate `tauri`） | **2.12.4** | 体积/内存/冷启动最优；5 项 OS 集成全有官方插件（ADR-001） |
| 桌面 CLI | `@tauri-apps/cli` | `^2.12.0` | 与 core 同步 |
| 前端 JS API | `@tauri-apps/api` | **2.12.4** | 与 core 同步 |
| 前端 | React / React DOM | **19.3.0** | 生态最成熟，组件化最优（ADR-002） |
| 语言 | TypeScript | `^5.9` | |
| 构建 | Vite | **8.3.4** | 官方脚手架同期版本 |
| Vite 插件 | `@vitejs/plugin-react` | `^6.1.2` | |
| 状态管理 | Zustand | `^5.0.0` | 约 1KB，满足低占用 |
| **图标库（P0 锁定）** | `lucide-react`（Lucide 图标集，ISC） | **基线 1.57.0**（安装时以实际解析版本为准） | 纯 SVG、2px 描边、tree-shakable、离线内联（ADR-004） |
| 数据持久化 | `tauri-plugin-sql`（sqlite feature） | crate **2.5.0** / npm `@tauri-apps/plugin-sql` **2.4.1** | 结构化查询+索引+事务（ADR-003） |
| 设置存储 | `tauri-plugin-store` | `^2.0.0` | 轻量 KV，仅存配置 |
| 系统托盘 | 内建 `tauri::tray`（feature `tray-icon`） | 随 core 2.12.4 | 官方一等支持 |
| 全局快捷键 | `tauri-plugin-global-shortcut` | `^2.0.0` | [P1] 已预置 |
| 开机自启 | `tauri-plugin-autostart` | `^2.0.0` | 写 HKCU Run |
| 窗口状态 | `tauri-plugin-window-state` | `^2.0.0` | 位置/尺寸记忆 |
| 单实例 | `tauri-plugin-single-instance` | `^2.0.0` | 防多开重复计时 |
| Rust 工具链 | rustc / cargo | **≥ 1.90**（edition 2024 MSRV） | |
| Node.js | Node | `^20.19` 或 `≥ 22.12` | Vite 8 engines |
| 运行环境 | WebView2 运行时 | 系统组件 | 打包内嵌 bootstrapper（W-1） |

**部署形态**：Windows 桌面安装包（NSIS + MSI），未签名（内测）；正式分发建议 OV/EV 证书（ADR-006）。
**认证方案**：无（纯本地免登录）。

### 4.1 分层架构（依赖只能向下）

```
表现层 React（components/hooks/stores/services/ipc.ts）
  ↓ Tauri IPC（invoke / listen，受 capabilities 白名单管控）
命令层 commands/*（仅反序列化 → 调 service → 序列化，无业务、无 SQL）
  ↓
业务层 services/*（TimerService / ItemService / RecordService / SettingsService）
  ↓
数据层 repositories/*（仅 SQL + 行映射）
  ↓
基础设施：SQLite（%APPDATA%\com.tickbar.app\tickbar.db，WAL）+ OS API（tray/shortcut/autostart/…）
```

关键决策：**计时状态机归属 Rust**（单一事实来源），前端只渲染并基于 `started_at` 本地推算 tick，避免高频 IPC。

### 4.2 代码组织硬规则（任一不合格 → 退回重做）

| # | 规则 |
|---|---|
| 1 | 单一职责，一文件一主导出 |
| 2 | 单文件 ≤ 300 行（不含空行注释） |
| 3 | 按资源分包：一资源 = 命令 + 服务 + 仓库三件套 |
| 4 | 入口只装配：`lib.rs`/`main.tsx` 只挂插件/命令/托盘，无业务，各自 < 120 行 |
| 5 | 业务逻辑不进命令处理器 |
| 6 | 前端禁止组件内直接 `invoke`，统一经 `src/services/ipc.ts` |
| 7 | 类型/DTO 独立成文件 |
| 8 | 依赖只向下、不反向、不跨层 |

---

## 5. 接口契约（Tauri IPC Command Contract）

> 本项目无 REST，此节即「API 文档」。Phase 2 据此产出 `src/types/domain.ts`（前端 TS 类型）与 Rust DTO（serde）。

### 5.1 统一返回与错误码

所有命令返回 `Result<T, AppError>`；失败序列化为 `{ "code": "...", "message": "..." }`。

| code | 触发条件 | 前端处理 |
|---|---|---|
| `DB_ERROR` | 数据库读写失败 | 提示"数据保存失败"，记录日志，内存数据不丢 |
| `ITEM_NOT_FOUND` | 事项不存在/已删除 | 刷新列表 |
| `ITEM_NAME_EMPTY` | 名称为空 | 表单内联提示 |
| `ITEM_NAME_DUPLICATE` | 名称重复（同 active） | 内联提示 + 提供"直接使用该事项" |
| `ITEM_SYSTEM_PROTECTED` | 删除/归档系统事项「未归类」 | 置灰操作，提示不可删除 |
| `TIMER_ALREADY_RUNNING` | 已有非 saved 会话仍尝试开始 | 忽略/提示先结束 |
| `TIMER_NOT_RUNNING` | 无 active 会话却调暂停/继续 | 忽略并同步状态 |
| `TIMER_NO_UNDO` | 撤销窗口已过期或记录非 saved | 忽略并同步状态 |
| `SHORTCUT_REGISTER_FAILED` | 热键被占用注册失败 | 提示并允许改键 |
| `INVALID_DURATION` | 结束时间早于开始时间 | 兜底丢弃该记录 |
| `IO_ERROR` | 文件/系统调用失败 | 通用错误提示 |

### 5.2 命令清单（**以本表为唯一依据**）

> 注意：本表相对 ARCHITECTURE-v1 §7.2 有两处**锁定变更**（见 §13 变更记录）：
> ① `stop_timer` 由"进入 draft 待确认"改为**直接保存**（用户裁决：一键结束并保存）；
> ② 新增 `undo_stop`；删除 `confirm_stop` / `cancel_stop`。

| 命令 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `list_items` | `{ includeArchived: boolean }` | `Item[]` | 事项列表（按 sort_order, name） |
| `create_item` | `{ name: string, color?: string }` | `Item` | 新建事项 |
| `update_item` | `{ id, patch: { name?, color?, sortOrder? } }` | `Item` | 部分更新 |
| `archive_item` | `{ id }` | `Item` | 归档 |
| `unarchive_item` | `{ id }` | `Item` | 取消归档 |
| `delete_item` | `{ id }` | `void` | 软删除（保留其记录） |
| `start_timer` | `{ itemId }` | `TimeRecord` | 开始新会话（无事项传 1=未归类）；需当前无非 saved 会话 |
| `pause_timer` | `{}` | `TimeRecord` | 暂停：`accumulated_sec += now - running_since`，`running_since=null`；仍 active，**不产生记录** |
| `resume_timer` | `{}` | `TimeRecord` | 继续：`running_since = now` |
| `stop_timer` | `{}` | `TimeRecord` | **右键单击**：立即置 `saved`，`ended_at=now`，冻结 `accumulated_sec`；返回记录 + 开启 3s 撤销窗口 |
| `undo_stop` | `{ recordId }` | `TimeRecord` | **撤销条「撤销」**：将 `saved` 记录回滚为 `active`（`ended_at=null`、`running_since=now`），回到 RUNNING，累计时长接续 |
| `get_timer_state` | `{}` | `TimerState` | 当前状态（含活动会话与实时累计时长） |
| `switch_item` | `{ itemId, mode: 'end_and_start' \| 'just_switch' }` | `TimerState` | 计时中换事项：分段（结束当前并开新）或仅改归属 |
| `list_records` | `{ itemId?, from?, to?, page, limit }` | `Paginated<TimeRecord>` | 记录明细分页（仅 `saved`） |
| `stats_summary` | `{ itemId?, from?, to? }` | `StatsSummary` | 合计时长/条数（仅 `saved`） |
| `update_record` | `{ id, patch: { itemId?, startedAt?, endedAt?, note? } }` | `TimeRecord` | 编辑记录（含改归属） |
| `delete_record` | `{ id }` | `void` | 软删除单条记录 |
| `resolve_open_record` | `{ action: 'resume'\|'close'\|'discard', endAt? }` | `TimeRecord \| null` | 崩溃恢复：处理启动时发现的 active 会话 |
| `get_settings` | `{}` | `Settings` | 读取全部设置 |
| `update_settings` | `{ patch: Partial<Settings> }` | `Settings` | 更新设置 |
| `set_autostart` | `{ enabled: boolean }` | `boolean` | 开关开机自启，返回实际状态 |
| `get_autostart` | `{}` | `boolean` | 查询自启状态 |
| `register_shortcut` | `{ action: ShortcutAction, accelerator: string }` | `boolean` | [P1] 注册/改键 |
| `show_window` / `hide_window` / `toggle_window` | `{}` | `void` | 悬浮条显隐（托盘/热键调用） |
| `set_always_on_top` | `{ enabled: boolean }` | `void` | 置顶开关 |
| `save_window_position` | `{ x, y }` | `void` | 记录位置（逻辑像素） |
| `quit_app` | `{}` | `void` | 退出（托盘菜单用） |

### 5.3 DTO 形状（字段名 camelCase，Rust 侧 `#[serde(rename_all="camelCase")]`）

```jsonc
// Item
{ "id": 1, "name": "写方案", "color": "#4F7DF3", "status": "active",
  "isSystem": false, "sortOrder": 0, "createdAt": 1760000000000, "updatedAt": 1760000000000 }

// TimeRecord — status: "active" | "saved"（draft 已移除）
{ "id": 10, "itemId": 1, "status": "saved",
  "startedAt": 1760000000000, "endedAt": 1760000180000,
  "accumulatedSec": 180, "runningSince": null, "note": null }

// TimerState — status: "idle" | "running" | "paused"
{ "status": "idle", "session": null, "lastItemId": 1 }

// Paginated<T>
{ "items": [], "total": 100, "page": 1, "limit": 20, "hasMore": true }

// StatsSummary
{ "totalSec": 5400, "recordCount": 12, "byItem": [ { "itemId": 1, "totalSec": 3600 } ] }

// Settings
{ "autostartEnabled": false, "alwaysOnTop": true, "opacityEnabled": true,
  "lastDisplayId": null, "shortcuts": { "toggleWindow": "...", "startPause": "...", "stop": "...", "newItem": "..." } }
```

### 5.4 事件（Rust → 前端 emit）

| 事件名 | Payload | 触发时机 |
|---|---|---|
| `timer:state-changed` | `TimerState` | 开始/暂停/恢复/结束/撤销/恢复处理 |
| `shortcut:triggered` | `{ action: ShortcutAction }` | [P1] 全局热键按下 |
| `tray:toggle-visibility` | `{}` | 托盘点击显隐 |
| `app:open-settings` | `{}` | 托盘/热键要求打开设置 |
| `app:open-new-item` | `{}` | 托盘/热键要求新建事项 |

`ShortcutAction`：`toggle_window` | `start_pause` | `stop` | `new_item`。

### 5.5 默认全局快捷键（[P1]，可配置）

| 动作 | 默认加速键 |
|---|---|
| 显示/隐藏 | `Ctrl+Alt+T` |
| 开始/暂停 | `Ctrl+Alt+S`（设计文档另提 `Ctrl+Alt+Space`，Phase 2 统一为一套） |
| 结束 | `Ctrl+Alt+E` |
| 新建事项 | `Ctrl+Alt+N` |

---

## 6. 数据库表清单（锁定）

> DB 路径：`%APPDATA%\com.tickbar.app\tickbar.db`；`journal_mode=WAL`、`foreign_keys=ON`。

| 表名 | 核心字段 | 索引 | 关联 |
|------|----------|------|------|
| `items` | id, name, color, status(active\|archived), is_system, sort_order, created_at, updated_at, deleted_at | `idx_items_status(status)` | 1 : n → time_records |
| `time_records` | id, item_id(FK), **status(active\|saved)**, started_at, ended_at, accumulated_sec, running_since, note, created_at, updated_at, deleted_at | `idx_records_item_id`、`idx_records_started_at`、`idx_records_item_started`、`idx_records_status`、`uq_records_open UNIQUE(status) WHERE status='active'` | n : 1 → items |
| `settings` | key(PK), value(JSON), updated_at | PK | — |

**关键语义（锁定）**
1. 迁移 `0001_init.sql` 首启种入系统事项 **「未归类」**（`id=1, is_system=1`），不可删除/归档，可改名。
2. `time_records.status` 仅 `'active' | 'saved'`：`active` = 会话进行中（`ended_at IS NULL`）；`running_since` 非 NULL = 正在计时，为 NULL = 已暂停但会话未结束；`saved` = 已结束并落盘。
3. `accumulated_sec` = 累计已计秒数；`running_since` = 当前段起点。**前端实时数字 = `accumulated_sec + (now - running_since)`**。运行中每 15s 落盘一次 `accumulated_sec`（崩溃丢失 ≤30s）。
4. **全局最多一条 `active` 会话**，TimerService 保证 + 部分唯一索引兜底。
5. 时间不变式：`ended_at IS NULL OR ended_at >= started_at`；`(status='active') = (ended_at IS NULL)`。

---

## 7. 视图清单（锁定）

> 桌面悬浮应用，无 Web 路由；"页面"= 形态/面板。所有形态绘制在**固定 384×360 DIP 透明置顶层**内（尺寸永不 resize）。

| 视图 | 触发 | 核心组件 | 对应命令 | 主题 |
|------|------|----------|----------|------|
| 药丸主视图 PillBar | 常驻 | MainButton / TimerDisplay / ItemName / NewItemEntry / CollapseHandle | `get_timer_state` `start_timer` `pause_timer` `resume_timer` `stop_timer` `undo_stop` | 深色 |
| 收起圆点 Collapsed | 点手柄 | StatusRing(28px) + tooltip | 同上 | 深色 |
| 展开面板 Panel | 点「新建事项」 | ItemInput / RecentChips(≤4) / ShortcutHint | `create_item` `list_items` `switch_item` | 深色 |
| 上下文菜单 Menu | 右键长按≥500ms / Menu 键 / Shift+F10 | MenuItem×n（184px 宽） | `pause_timer` `stop_timer` `update_record` `delete_record` `set_always_on_top` | 深色 |
| 撤销条 UndoBar | 结束后 3s | UndoText / UndoButton | `undo_stop` | 深色 |
| 记录汇总面板 Records | 点展开手柄 | DayTab / WeekTab / ItemGroup / RecordRow | `stats_summary` `list_records` `update_record` `delete_record` | 深色 |
| 设置面板 Settings | 托盘/菜单 | AutostartToggle / AlwaysOnTopToggle / OpacityToggle / ShortcutList[P1] | `get_settings` `update_settings` `set_autostart` | 深色 |
| 崩溃恢复对话框 RecoverDialog | 启动检测到 active 会话 | ResumeBtn / CloseBtn / DiscardBtn | `resolve_open_record` | 深色 |
| 托盘菜单 TrayMenu | 点托盘 | 显示/隐藏、新建事项、设置、退出 | `toggle_window` `show_window` `quit_app` | 系统原生 |

---

## 8. 设计 Token（锁定）

> 设计师 Phase 2 **必须**同步产出 `design-tokens.json` + `design-tokens.css`，前端 import 引用。组件 CSS 禁止出现任何裸 hex/rgb（含 `#fff`/`#000`）。

- **主色（强调色）**：Signal Amber `#E9A23B`（纯色，全站零渐变用于主视觉）
- **状态色（三态三色）**：idle `#8B919C` / running `#E9A23B` / paused `#7C93AC`；结束态 `#3FB950`
- **深色中性阶**：L0 `#0E0F12` / L1 药丸 `#1A1C20` / L2 `#22242A` / L3 `#2B2E35` / L4 `#343841`
- **文字**：主 `#F2F4F7`（15.5:1）/ 次 `#C3C8D0`（10.1:1）/ 三级 `#8B919C`（5.38:1）/ `--meta #6E7480`（仅图标/分隔线，禁可读文案）
- **字体**：`Geist Sans` + `Noto Sans SC`；计时数字 `Geist Mono`（`tabular-nums` + `min-width:5ch` + `text-align:right`，不可协商）
- **字号阶梯**：10 / 11 / 12 / 13 / 14 / 16 / 20（timer）/ 28 / 40px
- **药丸几何**：高 48px（紧凑 40px）/ 圆角 24px / 宽自适应 min256·typ288·max360 / 状态环 32px 描边 2px / 热区 44×44 / 收起态命中 36×36
- **圆角**：chip 9999 / 输入框 8 / 菜单·撤销条 12 / 面板 16 / 药丸 24
- **动效**：`--dur-quick 150ms`、`--dur-base 200ms`、`--dur-morph 280ms`、`--dur-confirm 900ms`、`--dur-undo 3000ms`；缓动仅 3 条（standard / exit / morph），**禁止任何弹跳/弹性缓动**
- **图标库**：`lucide-react`（唯一），尺寸 16px（stroke-width 2.5）/ 20px（2）/ 24px（2）
- **主题**：**恒定深色**（品牌识别符号），响应高对比度/浅色壁纸降级（100% 不透明）
- **对标品牌**：主对标 Raycast；辅助 Dynamic Island / Linear / Things 3
- **明确拒绝**：Mica / Acrylic / backdrop-filter 毛玻璃；紫→粉渐变；`#6366F1` 靛蓝默认强调色

---

## 9. 验收标准（锁定——QA 以本文为唯一依据，EARS 格式）

| 编号 | 功能 | EARS 验收标准 | 优先级 |
|------|------|---------------|--------|
| AC-01 | 常驻形态 | While 应用已启动，系统**必须**显示一颗常驻、置顶、不抢焦点、不占任务栏的深色药丸条（环+等宽数字+事项名/新建入口+手柄） | P0 |
| AC-02 | 开始计时 | When 用户左键点击圆形按钮且当前未计时，系统**必须**从 00:00 开始计时并按秒更新，按钮切为暂停图标，环变琥珀 | P0 |
| AC-03 | 暂停 | When 用户左键点击且正在计时，系统**必须**暂停（数字冻结、动效停止、环变钢蓝），且**不得**生成任何记录 | P0 |
| AC-04 | 恢复 | When 用户左键点击且处于暂停，系统**必须**从暂停值继续累加 | P0 |
| AC-05 | 结束并保存（**已裁决**） | When 用户**右键单击**计时区，系统**必须**立即结束当前会话并保存为一条记录（默认归属当前事项），同时展示约 3 秒的撤销条；**不得**弹出阻塞式确认对话框 | P0 |
| AC-06 | 撤销结束 | When 用户在撤销条有效期内点击「撤销」，系统**必须**将刚保存的记录回滚为进行中，累计时长接续，状态回到 running | P0 |
| AC-07 | 撤销条过期 | If 撤销条已过期，the 记录**必须**保持已保存，且界面回到 idle | P0 |
| AC-08 | 事项创建 | When 用户点「新建事项」输入名称并回车，系统**必须**创建该事项并设为当前事项 | P0 |
| AC-09 | 未归类兜底 | If 计时时不存在任何事项，系统**必须**归属系统事项「未归类」(id=1)，且事后可改归属 | P0 |
| AC-10 | 重名提示 | If 用户创建重名事项，系统**必须**内联提示并提供「直接使用该事项」 | P0 |
| AC-11 | 系统事项保护 | If 用户尝试删除/归档「未归类」，系统**必须**拒绝并提示不可删除 | P0 |
| AC-12 | 计时中换事项 | When 计时中切换/新建事项，系统**必须**保留已产生时长并按 `mode` 分段或仅改归属 | P0 |
| AC-13 | 本地持久化 | When 一条记录保存成功，系统**必须**持久化到本地 SQLite，退出重启后仍可读取 | P0 |
| AC-14 | 崩溃恢复 | If 计时进行中被强制关闭，the 系统**必须**在下次启动时提供「继续/结束/丢弃」，丢失时长 ≤30 秒 | P0 |
| AC-15 | 全离线 | Where 用户在本机操作，the 系统**必须**在无网络环境下完成全部计时、保存与查看 | P0 |
| AC-16 | 今日/本周汇总 | When 用户打开记录面板，系统**应该**在 300ms 内展示「今天」「本周」按事项聚合时长与总计 | P0 |
| AC-17 | 记录明细与改归属 | When 用户展开某事项聚合项，系统**应该**列出单条记录（开始时间、时长）并允许改归属/删除 | P0 |
| AC-18 | 空状态 | If 当日无记录，系统**必须**展示引导文案（如"点左侧圆钮开始第一次计时"），而非空白页 | P0 |
| AC-19 | 托盘常驻（**已裁决进 MVP**） | While 应用运行，系统**必须**在任务栏托盘显示图标；左键单击切换悬浮条显隐；右键/菜单含显示、新建事项、设置、退出 | P0 |
| AC-20 | 关闭转隐藏（**已裁决**） | When 用户触发关闭窗口，系统**必须**隐藏窗口而非退出进程，仅在托盘「退出」时真正退出 | P0 |
| AC-21 | 开机自启（**已裁决进 MVP**） | When 用户在设置中开启开机自启，系统**必须**写入 HKCU Run 并在重启后自动启动；关闭时可一键移除、不留隐藏启动项 | P0 |
| AC-22 | 单实例 | If 用户重复启动，the 系统**必须**聚焦已有实例，**不得**出现两个悬浮条同时计时 | P0 |
| AC-23 | 高 DPI/多显示器 | While 在不同 DPI/显示器间移动，the 药丸**必须**位置与尺寸正确；显示器断开后**必须**回到可见区域 | P0 |
| AC-24 | 等宽数字不抖动 | While 计时数字每秒变化，the 药丸宽度**必须**零抖动（`tabular-nums` + 定宽 + 右对齐） | P0 |
| AC-25 | 无 emoji 图标 | Where 任何 UI 界面，系统**不得**使用 emoji 作为功能图标；所有图标**必须**来自 `lucide-react` | P0 |
| AC-26 | 本地统计（默认关闭） | If 用户显式开启「匿名本地统计」，系统**应该**仅在本机记录关键事件，且**不得**自动上传 | P1 |
| AC-27 | 全局快捷键 | Where 应用运行，When 用户按下已注册的全局快捷键，系统**应该**在任意前台应用下完成对应动作 | P1 |

---

## 10. 边界与约束

- **空状态**：无事项→「未归类」；无记录→引导文案（非空白/报错）。
- **错误状态**：写入失败→提示 + 保留内存数据 + 重试 3 次，**绝不丢数据**；数据损坏→安全模式，尽量导出可读记录。
- **边界值**：`<1h` 显示 `MM:SS`，`≥1h` 显示 `HH:MM:SS`（`min-width` 切 8ch），上限 `99:59:59`；跨零点会话归属正确日期。
- **并发**：单实例；重复启动聚焦已有实例。
- **平台**：Windows 10（1903+）/ Windows 11；无管理员权限可用；依赖 WebView2（打包内嵌 bootstrapper）。
- **性能目标**：冷启动到药丸可见 <1.5s（架构目标 <1s）；面板打开 <300ms；空闲内存 <60MB；空闲 CPU <0.1%、RUNNING <0.3%。
- **隐私**：零遥测、零网络请求、不采集窗口标题/键击/截屏；数据目录用户可见、可导出、可清空。
- **可访问性**：键盘全路径可达（Tab/Space/Enter/Esc/Menu）；`focus-visible` 不得清除；`prefers-reduced-motion` 分支必须实现且保留状态可辨性。
- **国际化**：MVP 仅简体中文，代码预留 i18n 接口，不硬编码文案。
- **平台特化（Windows）**：窗口样式 `WS_EX_LAYERED|WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE`；固定 384×360 DIP 透明层 + 动态命中区（click-through 其余区域）；自绘 24px 圆角（不依赖 DWM 自动圆角）；拖拽阈值 4 DIP、吸附阈值/边距 16 DIP；计时用单调时钟（`QueryPerformanceCounter`/`Stopwatch.GetTimestamp()`）+ 休眠检测；全屏应用时降层。
- **安全**：`capabilities` 最小权限白名单；CSP `default-src 'self'`。

---

## 11. 内嵌已知坑（Phase 3 开发前注入，来自架构文档 §9）

| # | 坑 | 根因 | 修法 |
|---|---|---|---|
| K-1 | 透明无边框窗口创建白闪 | 首帧前窗口已可见 | `visible:false`，前端首帧渲染完成后再 `show()`；Windows 加 `noRedirectionBitmap:true` |
| K-2 | `data-tauri-drag-region` 不生效 | capabilities 未放行 | 授予 `core:window:allow-start-dragging` |
| K-3 | 全局热键注册静默失败 | 被占用无报错 | `match` Err → 提示 + 回退备键 + 允许改键，**禁止 unwrap()** |
| K-4 | 插件命令运行时被拒 | capabilities 未逐项放行 | sql / global-shortcut / autostart / window-state / store / single-instance 全部放行 |
| K-5 | 关闭主窗口导致进程退出、托盘失效 | 默认关窗即退出 | 拦截 `CloseRequested` → `hide()`；仅托盘「退出」调 `app.exit(0)` |
| K-6 | 多显示器 DPI 换算错误致位置漂移 | move/resize 事件是物理像素 | 存逻辑坐标需除 `scaleFactor`；恢复时按 work_area 钳制，越界回落主屏 |
| K-7 | 迁移非幂等重复建表报错 | 缺 IF NOT EXISTS | 迁移 SQL 全 `IF NOT EXISTS`；`schema.version` 记录版本 |
| K-8 | 事件订阅泄漏 | WebView 重载后旧监听残留 | `listen()` 的 unlisten 必须在 `useEffect` 清理函数调用 |
| K-9 | WebView2 未安装白屏 | 老 Win10 未预装 | 打包内嵌 WebView2 bootstrapper |
| K-10 | Rust 编译失败 | MSRV 不符 | 锁定 rustc ≥ 1.90 |
| K-11 | invoke 散落难维护 | 组件内直接调用 | 统一经 `src/services/ipc.ts`，集中 try/catch 与错误码映射 |
| K-12 | 按"通用印象"写 API 签名（幻觉） | 未核对锁定版本 | 一切以 §4 锁定版本官方文档为准 |

---

## 12. 端到端验证步骤（Phase 3 验收 + Phase 4 测试依据）

环境：Windows 11，WebView2 已装，Rust ≥1.90，Node ≥22.12。

```bash
# 1. 安装与构建
cd tickbar && npm install
npm run tauri dev          # 开发态；或 npm run tauri build 出安装包

# 2. 形态核验
#   - 出现深色药丸条：无边框、置顶、任务栏无图标；托盘出现图标

# 3. 核心成功流
#   - 点「新建事项」输入「写方案」回车 -> 成为当前事项
#   - 左键圆钮 -> 数字自 00:00 递增（等宽不抖动），按钮变暂停
#   - 再左键 -> 暂停（数字冻结、不产生记录）
#   - 再左键 -> 从暂停值继续
#   - 右键单击 -> 立即保存 + 撤销条出现；记录列表出现「写方案」，时长=实际累计（误差≤1s）
#   - 点撤销条「撤销」-> 回到 RUNNING，累计时长接续；撤销条消失后记录保持已保存

# 4. 未归类与边界流
#   - 无事项直接开始 -> 归属「未归类」(id=1)；可事后改归属
#   - 空名称新建事项 -> 内联 ITEM_NAME_EMPTY，不写入
#   - 删除「未归类」-> 被拒 ITEM_SYSTEM_PROTECTED

# 5. 系统集成（P0-5 / P0-6）
#   - 关闭窗口 -> 退到托盘而非退出
#   - 托盘左键单击 -> 悬浮条显隐切换
#   - 设置开启开机自启 -> HKCU\...\Run 出现条目；重启后自动启动；关闭后条目移除

# 6. 多显示器 / DPI
#   - 拖到副屏 -> 重启 -> 位置恢复副屏
#   - 100% 与 150% 显示器间移动 -> 尺寸位置无异常

# 7. 崩溃恢复
#   - 计时运行中强杀进程 -> 重启 -> 弹「继续/结束/丢弃」三选一，行为正确

# 8. 资源占用
#   - 空闲内存 <60MB；空闲 CPU <0.1%；冷启动 <1.5s
```

**通过判据**：1-8 全部通过 + 代码组织门禁（§4.2）无超限 + emoji 正则零命中 + 无回归。

---

## 13. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-10-16 | 结束计时由「右键→draft 收尾浮层→confirm_stop/cancel_stop」改为「右键单击→直接 saved + `undo_stop` 撤销条」 | 用户裁决：摩擦最低，对齐"1 次点击结束"指标；设计/架构均倾向此方案 | 数据模型去掉 `draft` 态；契约删 `confirm_stop`/`cancel_stop`、增 `undo_stop`；AC-05/06/07 重写；**需 Phase 2 架构师补 ADR-007 并更新 ARCHITECTURE-v1 §6/§7** |
| 2026-10-16 | 系统托盘 + 开机自启由 P1 提升为 P0（MVP） | 用户裁决：RICE=6.00 最高，"永远可见/随手可用"关键，架构已预置成本极低 | MVP 范围新增 P0-5/P0-6；AC-19/20/21；工作量增加 |
| 2026-10-16 | 图标库版本口径统一：以架构选型的 `lucide-react` 为唯一锁定库，版本以安装实际解析为准（设计文档原写 ≥0.460） | 设计/架构版本号不一致 | §4 依赖表；ADR-004 |
| 2026-10-16 | 默认停靠位置锁定为右下角、距边 16 DIP（架构建议 24px，设计 §9 定为 16 DIP） | 消除两文档歧义 | §10 平台特化；AC-23 |
| 2026-10-16 | 计时展示格式锁定：`<1h` MM:SS / `≥1h` HH:MM:SS | 架构待裁决 A-2 | §10 边界值；前端 format.ts |
| 2026-10-16 | 本地匿名统计维持 P1、MVP 不采集 | 架构待裁决 A-5，保持零遥测叙事 | AC-26 标 P1 |
| 2026-10-16 | 后端仓储层改用 `sqlx` 连接池直连 SQLite（仍注册 `tauri-plugin-sql` 并按契约附录 A 放行 sql 权限），二者共用同一 DB 文件（WAL 多连接安全） | `tauri-plugin-sql` 的前端 pool 仅在 JS 端 `Database.load()` 后存在，与"Rust 命令为单一事实来源"冲突 | `src-tauri/repositories/**`；功能等价，建议 Phase 4 由架构师补 ADR-009 固化 |
| 2026-10-16 | 依赖版本偏差：`typescript@5.9.0` npm 不存在 → 改用 `^5.9.3`（仍满足 ^5.9）；`@tauri-apps/plugin-single-instance` npm 无此包（Tauri v2 该插件为 Rust-only、无 JS 绑定）→ 前端不纳入，功能由 Rust crate 承担 | npm 实际解析结果 | `package.json`；不影响功能 |
| 2026-10-16 | Vite 8 为 rolldown 内核，`minify:'esbuild'` 需另装 esbuild → 改为 `minify:'oxc'`（Vite 8 默认） | 构建期报 ERR_MODULE_NOT_FOUND | `vite.config.ts` |
| 2026-10-16 | 接口语义 MVP 取舍：`item.color = ""` 视作「不修改」（不支持置回 NULL）；`record.note > 500` 字符**截断**而非报错；`settings.lastDisplayId = null` 等价「不修改」 | 契约 11 个错误码无对应项，不为边缘 case 扩契约 | 后端 repositories/services 实现细节 |

---

## 附：Phase 2 待办（本 Spec 派生）

1. 架构师：产出 `openapi`-等价物 → 实际为**修订后的 IPC 契约 + `src/types/domain.ts` TS 类型 + Rust DTO**；补 **ADR-007**（一键结束并保存 + 撤销）与 **ADR-008**（托盘/自启进 MVP）；更新 ARCHITECTURE-v1 的数据模型（去 `draft`）与迁移 SQL。
2. 设计师：产出 `design-tokens.json` + `design-tokens.css` + `DESIGN.md`（9 节）+ 页面级 Override（药丸 / 展开面板 / 菜单 / 撤销条 / 设置 / 记录面板）。
3. QA：依据 §9 验收标准先写测试用例（Phase 2 写测试，Phase 4 评级）。
