# TickBar V0.2.0 变更方案（UI 对标 Timing v1.7.0 + 功能新增）

> 日期：2026-10-16
> 触发：用户需求变更「TickBar UI 设计仿照 Timing_v1.7.0，并参考它新增功能」
> 判定：**大改**（新增数据库表 + 新增 ≥2 视图 + 改变产品形态）→ 回到 Phase 0 重新定范围
> 状态：**已确认** → 进入 V0.2.0-1（三文档）

---

## A. 决策记录（用户已拍板 4 项）

| # | 决策项 | 结论 |
|---|--------|------|
| 1 | 对齐范围 | **全面对标** —— UI 全对齐 + 全部可借鉴功能，等于把 TickBar 做成 Timing 的 Tauri 跨平台版 |
| 2 | 主色 | **改用 Timing 的蓝 `#4DA3E8`**（弃 Signal Amber `#E9A23B`） |
| 3 | 主题 | **加浅色主题**（深/浅双主题可切） |
| 4 | 数据格式 | **保持 SQLite**（不改成 Markdown，不与 Obsidian 打通） |
| 5 | 版号 | **V0.2.0**（V0.1.0 = 已建成的 MVP） |

**技术栈与架构主干不变**。

---

## A2. 架构影响三分档（回答「确定的架构会不会变」）

| 档位 | 内容 | 是否变 |
|------|------|--------|
| **主干（不动）** | Tauri 2.12.4 + React 19.3 + TS + Vite + Zustand + SQLite + lucide-react；四层架构（表现→命令→业务→数据，依赖只向下）；计时状态机归 Rust（单一事实来源）；IPC = invoke + emit（无 REST）；单文件 ≤300 行、入口只装配；崩溃恢复 15s 落盘；单 active 会话约束；UQ 唯一槽；ADR-001~008 | **不变** |
| **已有项扩写** | 数据模型（3 表 → 5 表）、IPC 契约（29 → ~48 命令）、视图清单（9 → 14） | **扩展，非推翻** |
| **V0.2.0 全新增** | 多窗口管理（便利贴）、后台提醒调度、倒计时状态机扩展、双主题 Token 切换 | **新增，配 ADR-009+** |

---

## B. 功能范围

### B.1 保留（v1 已有，本次做几何/视觉对齐）

| # | 功能 | V0.2.0 变更 |
|---|------|---------|
| 1 | 药丸悬浮条（左键开始/暂停，右键结束，3s 撤销条） | 几何对齐：高 48→34、色环 ⌀32→⌀22、圆角 24→h/2 |
| 2 | 事项归类 + 时间记录 | 无功能变更，仅视觉 |
| 3 | 本地持久化 + 崩溃恢复（15s 落盘，丢失 ≤30s） | 无变更 |
| 4 | 托盘 + 开机自启 | 托盘菜单改**自绘玻璃 + 状态块 + 按状态裁剪** |
| 5 | 设置面板 | 改造为**三页签**：外观配色 / 扩展 / 通用 |

### B.2 新增（对齐 Timing）

| # | 功能 | 说明 | 复杂度 |
|---|------|------|--------|
| 6 | **小条随事项名伸缩** | 宽 116–288，`BarW = base + taskW`，taskW ≤ 164 | 低 |
| 7 | **待办事项** | 新增/编辑/删除/勾选完成，一行一条 | 中 |
| 8 | **事项窗口** | 四状态（已完成/进行中/待进行/待办）+ 表头汇总 + 空态 | 中 |
| 9 | **便利贴** | 钉桌面备注窗，可拖拽缩放，未悬停全透只剩正文，右上角删除/收纳 | **高（多窗口）** |
| 10 | **提醒铃** | 事项/待办提醒，到点弹系统通知 | 中（后台调度） |
| 11 | **倒计时** | 正计时 + 倒计时双模式，时长菜单 | 中（状态机扩展） |
| 12 | **常用事项 / 固定任务** | 快速开始菜单（最近 5 条 + 常用预设） | 低 |
| 13 | **深浅双主题** | 两套设计令牌，可切换 | 中 |
| 14 | **四色可配** | 计时中 / 提醒 / 完成 / 小条底色 | 低 |
| 15 | **自绘玻璃菜单** | 小条右键 / 事项右键 / 托盘三处统一，键盘 ↑↓/Enter/Esc 导航 | 中 |

### B.3 缓做 / 不做

| 功能 | 结论 | 原因 |
|------|------|------|
| 插件系统（obsidian-sync / timer-window） | **缓做（v0.3）** | 与「数据保持 SQLite」决策冲突；Tauri 插件架构需独立设计 |
| Obsidian 同步 | **不做** | 用户已定数据格式为 SQLite |
| 全局快捷键 | 维持 P1 | 与 v1 一致，不阻塞 |

---

## C. 数据模型（SQLite，v1 三表 → V0.2.0 五表）

| 表 | 变更 | 核心字段 |
|----|------|----------|
| `items` | **改造** | 加 `remind_at`（提醒时间）、`is_pinned`（固定任务） |
| `time_records` | **改造** | 加 `mode`（countup/countdown）、`target_sec`（倒计时目标） |
| `settings` | **扩展** | 加 `theme_mode`、`accent_running` / `accent_warn` / `accent_done` / `accent_bar`、`countdown_presets` |
| `notes` | **新增** | `id / item_id / content / pos_x / pos_y / width / height / created_at / updated_at` |
| `todos` | **新增** | `id / title / planned_at / remind_at / done_at / sort_order / created_at` |

> 提醒不单独建表，落 `items.remind_at` / `todos.remind_at`，减少表数量。
> 迁移脚本全 `IF NOT EXISTS`，与 v1 幂等共存；老库升级走 `ALTER TABLE ADD COLUMN`。

---

## D. IPC 命令（v1 29 条 → V0.2.0 约 48 条）

| 分组 | 新增命令 |
|------|----------|
| note | `note_create` / `note_update` / `note_delete` / `note_list` / `note_get` |
| todo | `todo_create` / `todo_update` / `todo_delete` / `todo_list` / `todo_toggle` |
| window | `open_note_window` / `close_note_window` / `open_todos_window` / `open_settings_window` |
| theme | `theme_get` / `theme_set` / `accent_get` / `accent_set` |
| timer | `start_countdown` / `set_countdown_preset` |
| reminder | `reminder_set` / `reminder_clear` / `reminder_pending` |

**新增事件**：`reminder-fired` / `theme-changed` / `note-window-opened` / `note-window-closed`

---

## E. 视图清单（v1 9 个 → V0.2.0 14 个）

| 视图 | 状态 | 说明 |
|------|------|------|
| pill-bar 药丸条 | 改造 | 几何对齐 Timing |
| collapsed 收起态 | 保留 | |
| context-menu 上下文菜单 | 改造 | 自绘玻璃 + 键盘导航 |
| tray-menu 托盘菜单 | 改造 | 状态块 + 按状态裁剪 |
| records-panel 记录面板 | 保留 | |
| settings-panel 设置面板 | 改造 | 三页签 |
| recover-dialog 崩溃恢复 | 保留 | |
| undo-bar 撤销条 | 保留 | |
| **todos-panel 事项窗口** | 新增 | 四状态清单 |
| **sticky-note 便利贴** | 新增 | 独立多窗口 |
| **reminder-popover 提醒** | 新增 | |
| **theme-picker 主题/配色** | 新增 | |
| **countdown-menu 时长菜单** | 新增 | |
| **common-items 常用事项** | 新增 | |

---

## F. 设计令牌 V0.2.0（整体重做）

| 维度 | v1（旧） | V0.2.0（新，对齐 Timing） |
|------|----------|----------------------|
| 主色 | Signal Amber `#E9A23B` | **Accent Blue `#4DA3E8`** |
| 主题 | 恒定深色 | 深/浅双主题 |
| 字体 | Geist Sans + Noto Sans SC + Geist Mono | **Microsoft YaHei UI**（等宽数字用系统 mono fallback） |
| 浮层底 | 自定义深色 | `#0E0F12`（plate） |
| 面板底 | — | `#0E1015`（panel）/ `#14161C`（card） |
| ink 四档 | 三态三色 | `#F2F3F5` / `#C9CED8` / `#8B93A2` / `#7A8292` |
| 语义色 | running/paused/ended | accent `#4DA3E8` / warn `#E8A33D` / danger `#E5484D` / ok `#4CC38A` |
| 圆角阶梯 | 单一 24 | 6 / 10 / 12 / 14 + 胶囊 h/2 |
| 图标 | lucide-react 16/20/24 | 不变（Timing 也是 16px 描边型，无 emoji） |

> 全部令牌沿用 Timing 已实测的对比度数据（WCAG 复算），深/浅两套各自满足 AA。

---

## G. 交付阶段

| 阶段 | 内容 | 产出 |
|------|------|------|
| V0.2.0-0 | 需求定范围 | 本文档 |
| V0.2.0-1 | 并行调研 + 三文档 | PRD-V0.2.0 / ARCHITECTURE-V0.2.0 / UIUX-V0.2.0 → **用户确认** |
| V0.2.0-2 | Spec 生成 | Spec-V0.2.0 + design-tokens V0.2.0 |
| V0.2.0-3 | 设计细化 | 各页面提示词 |
| V0.2.0-4 | 并行开发 | 前端重构 + 后端加表加命令 |
| V0.2.0-5 | 测试 + 交付 | QA 报告 + 交付包 |

### 交付节奏建议（小步快跑）

「全面对标」体量大，建议**拆两批交付**，先拿到可用增量：

- **批 1（一眼就是 Timing）**：UI 令牌对齐 + 小条几何 + 双主题 + 四色可配 + 自绘菜单 + 待办事项 + 事项窗口
- **批 2（重功能）**：便利贴（多窗口）+ 提醒（后台调度）+ 倒计时 + 常用事项

---

## H. 三个必须先说清的架构点

1. **便利贴 = 多窗口**（最大复杂点）
   每个便利贴是一个独立 `WebviewWindow`，要管窗口生命周期：创建 / 关闭 / 重启恢复 / 位置持久化 / 多显示器。

2. **提醒 = 后台调度**
   Rust 侧需要常驻定时器扫描 `remind_at`，到点触发系统通知（`tauri-plugin-notification`）。要考虑休眠唤醒后的补偿。

3. **倒计时 = 状态机扩展**
   现有 `active|saved` 两态要加倒计时语义（`target_sec` + 到点行为：自动结束 / 铃声 / 通知），单调时钟逻辑复用。

---

## I. 待确认（已确认）

1. 本方案整体 OK
2. ⏳ 是否拆两批交付（推荐）
3. ⏳ 插件系统缓到 v0.3（推荐）

确认后进入 **V0.2.0-1：并行派发 PM / 架构师 / 设计师，产出三文档**。
