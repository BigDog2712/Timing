# 页面：事项窗口 TodosPanel（V0.2.0 · 新增）

> 覆盖对象：`DESIGN-V0.2.0.md` + `design-tokens-V0.2.0.{json,css}`
> 本文件只写**本页规格**与**差异字段**。
> 触发：小条右键「今日计时」/ 托盘菜单 / 常用事项 | 主题：深/浅双主题 | 层：`--z-panel` (20)
> 来源：对齐 Timing §4.4 `TodoListPanel` + `TodoDigestPanel`
> 窗口：**独立窗口**，宽 `--todos-w` 336，高自适应（最小 ≈220 / 最大 ≈560，超出滚动）
> 对应命令：`todo_list` `todo_create` `todo_update` `todo_delete` `todo_toggle` `time_records_today` `open_todos_window`
> 相关验收：四状态（已完成/进行中/待进行/待办）在**灰度打印**下仍可区分

---

## 1. 布局与尺寸标注

```
+--------------------------------------------------------------+  宽 --todos-w 336
| 表头 32：今日计时 · 4 条（12.5/600 --ink｜· 4 条 12.5/400 --ink-3）  共 2 小时 15 分 |  ← 等宽 11.5 --ink-3
+--------------------------------------------------------------+
| (on) 上厕所   10:00                                   10 分  |  ← 已完成：名 --ink-4 / 时长删除线
| ▌( ) 摸会儿鱼 10:10                                  12 分  |  ← 进行中：--accent-wash 底 + 左 3px 竖条
| ( ) 吃饭   [bell] 12:00                              待进行  |  ← 待进行：--ink-4 常规
| ( ) 写周报   17:30                                   待进行  |
+--------------------------------------------------------------+  1px --line 分隔
| 待办事项 · 3                                        预计执行  |  ← 小标题 10.5/600/.08em/--ink-4
| ▌摸会儿鱼                                            10:10   |  ← 进行中的待办：--accent-ink 600 + 竖条
|  剪头发                                              15:00   |
|  取快递                                            已逾期   |  ← --color-warn（逾期，走 --todo-overdue）
|  交周报                                            未设时间  |  ← --ink-4
+--------------------------------------------------------------+  高 40 底栏
| [ ＋ 新增待办 (flex 1.3) ] [ [pencil] 编辑事项 (flex 1) ]            |
+--------------------------------------------------------------+
```

> **分区说明（数据模型约束）**：设计稿把「待进行」列在「今日计时」区；但本数据模型 `time_records` **无 `planned_at`**，无法表达「计划中的今日记录」，故实现中「待进行」并入下方 **「待办事项」区**（`todos.planned_at` 才是「计划」的载体）。四状态语义（已完成 / 进行中 / 待进行 / 待办）仍全部可达 —— 「待进行」＝ 待办区中已排期、尚未开始的行。

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 宽 | `--todos-w` 336px | 固定宽 |
| 圆角 | `--radius-lg` 12 | |
| 底 | 玻璃 `--menu-bg`（94% + blur 18 saturate 150%） | 对齐 Timing；**文字用不透明 ink** |
| 描边 | 1px `--line-2` + `--shadow-plate` | |
| 表头高 | `--todos-head-h` 32 | |
| 行高 | `--todos-row-h` 26 | |
| 行内边距 | `0 6 0 10`（表头 `0 14`） | |
| 状态标记 | `--todos-mark-size` 15（圆）；未完成 `--todo-mark-ring`（1.5px 描边空圈）；完成 `--todo-mark-done` 实心 + 9px `--todo-mark-done-ink` 勾 | |
| 待办行高 | `--todos-pending-row-h` 24；上限 8（`--todos-pending-max`） | |
| 底栏高 | `--todos-foot-h` 40 | |

---

## 2. 组件树

```
<TodosPanel>
+-- <PanelHeader/>        主「今日计时 · N 条」+ 副「共 X 小时 Y 分」（等宽）
+-- <RecordList/>         已完成 / 进行中 / 待进行 三类行
|   +-- <RecordRow data-status="done|running|upcoming">
|         +-- <TodoMark/>   圆标记（ring | done）
|         +-- <Name/>       名（+ 可选 bell 12px --color-warn）
|         +-- <Time/>       计划时间（等宽 11 --ink-4）
|         +-- <Duration/>   时长（等宽 11.5 --ink-2 右对齐 min-width 50）
+-- <PendingSection/>     待办事项分组
|   +-- <SectionLabel/>     「待办事项 · N」+ 右侧「预计执行」
|   +-- <PendingRow data-tone="normal|overdue|none">  三级语气
+-- <PanelFooter/>         40 高：accent sm「＋新增待办」+ ghost sm「编辑事项」
+-- <EmptyState/>          图标块 + 两行 + accent 按钮
```

---

## 3. 状态与交互

### 3.1 四状态视觉分层（核心 — 灰度可辨）

| 状态 | 圆标记 | 名字 | 时间 | 时长 | 底 |
|---|---|---|---|---|---|
| **已完成** | `--ok` 实心圆 + 深色勾 | `--ink-4` | `--ink-4` 等宽 11 | 等宽 11.5 + **删除线**（`text-decoration-color: --line-3`） | 无（hover `--todo-row-hover`） |
| **进行中**（当前） | `--todo-mark-ring` 空圈（1.5px） | `--ink` · 600 | `--ink-4` 等宽 11 | `--todo-time-current`（`--accent-ink`）等宽 11.5 | `--todo-row-current`（`--accent-wash` 14%）+ 左 3px `--todo-bar-current` 竖条 |
| **待进行** | 空圈 | `--ink-2` | `--ink-4` 等宽 11 | 「待进行」`--todo-no-time` 常规字重 | 无 |
| **待办项** | 无圆标记（列表条目） | 三级语气（见下） | — | 计划时间右对齐等宽 11 | 分区，`--line` 分隔 |

**待办项三级语气（不用图标也能分清）：**
- 进行中的待办：`--accent-ink` · 600 + 左 3px `--accent` 竖条。
- **逾期**：`--todo-overdue`（走**可配色** `--color-warn`，默认回落 `--warn`；AC-54）。
- **未设时间**：`--todo-no-time`（`--ink-4`）。
- 常规：`--ink-2`。

> **为什么当前行底从 45% alpha 降到 14%**：原来是 `rgba(accent, .45)` 叠在半透玻璃上 —— 三层 alpha 相乘，最终亮度不可控。改为固定 `--accent-wash` 后，「底 + 竖条 + 名字提亮」三处共同表达「这是当前行」，比单靠一块高亮底更稳、也更清楚（Timing §4.4 理由）。
> **提醒铃**：任务名后 12px `bell`（`--color-warn` 色，可配色），有 `remind_at` 时显示。
> **可达性提示（AC-54 复验）**：逾期与提醒铃均**条件渲染**（分别需 `todos.planned_at` 已过 / `remind_at` 存在）；批1 UI 暂无录入这两个字段的入口 ⇒ 真机验证「提醒色」前，需先造一条带计划/提醒时间的待办（详见 QA 报告）。

### 3.2 交互态

| 状态 | 行 | 圆标记 | 底栏按钮 |
|---|---|---|---|
| Default | `--ink-2` / 当前行 `--ink` | ring `--line-3` | accent «新增待办» / ghost «编辑事项» |
| Hover（`--dur-quick`） | 底 `--todo-row-hover` | ring → `--line-3` 提亮 | accent 底加深 / ghost 字 → `--ink` |
| Active | 底 `--bg-field-hi`，`scale(0.995)` | `scale(0.9)` | `scale(0.98)` |
| Focus-visible | `--focus-ring` 双环 | 同左 | 同左 |
| Loading（首次） | 表头 `--ink-3` 骨架 + 3 行骨架（`--bg-field` 占位） | — | 按钮 disabled |
| Empty | 见 §3.3 | — | 仅「＋新增待办」 |
| Error | 顶行 inline `--danger` 文案 + 重试 ghost 按钮 | — | 保留 |
| Success | 勾选完成 → 圆标记变 `--ok` 实心（`--dur-base`）+ 名加删除线 | — | — |
| Edge | 待办 > 8 条 → 超出折叠（「还有 N 条」）；超长名 → 省略号；时长为 0 → 显示「< 1 分」 | — | — |

### 3.3 空态（图标 + 两行 + 按钮）

```
   +--------+
   |  clock |   34×34 圆角图标块（--bg-field 底 + --radius-md）
   +--------+
   今天还没有计时记录            13 / --ink-2
   左键小条开始，或从下面新建一条   11.5 / --ink-4
   [ ＋ 新增待办 ]              accent sm，居中
```

### 3.4 键盘路径

`↑↓` 在记录/待办行间移动；`Space` 勾选/取消完成；`Enter` 编辑选中行；`Delete` 直接删除 + 底部撤销条（3s 可撤销，**不弹阻塞式确认对话框**）；`Tab` 到底栏按钮；`Esc` 关窗。

---

## 4. 引用的 Token 名

- 颜色：`--menu-bg` `--line` `--line-2` `--ink` `--ink-2` `--ink-3` `--ink-4` `--accent` `--accent-ink` `--accent-wash` `--ok` `--ok-ink` `--warn` `--color-warn` `--danger` `--todo-row-hover` `--todo-row-current` `--todo-bar-current` `--todo-time-current` `--todo-name-done` `--todo-mark-ring` `--todo-mark-done` `--todo-mark-done-ink` `--todo-overdue` `--todo-no-time` `--todo-summary-ink` `--focus-ring`
- 尺寸：`--todos-w` `--todos-head-h` `--todos-row-h` `--todos-mark-size` `--todos-pending-row-h` `--todos-foot-h` `--radius-lg` `--radius-md` `--space-2` `--space-3` `--icon-sm` `--btn-sm-h`
- 阴影：`--shadow-plate`
- 动效：`--dur-quick` `--dur-base` `--ease-standard`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke | 用途 |
|---|---|---|---|
| `plus` | 16px | 2.5 | 「＋新增待办」 |
| `pencil` | 16px | 2.5 | 「编辑事项」 |
| `bell` | 12px | 2.5 | 任务名后有提醒时（`--color-warn`） |
| `clock` | 24px | 2 | 空态图标块 |
| `check` | 9px | 3 | 已完成行圆标记内勾（绘制在 `--ok` 实心圆上，色 `--ok-ink`） |

> 完成勾**不用** `U+2713`，用 lucide `check`（或内联 SVG path，同语义）。

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 分组容器 | 卡片盒子 | **1px 线 + 间距分组**（清单不用卡片） | Density=8 驾驶舱模式 |
| 当前行强调 | ≤2 处 | 竖条 + 底 + 数字色，同属 1 处语义 | 避免「一块高亮底」独木难支 |
| 底 | 玻璃 94% | 固定玻璃 94%（**不随小条底色变**） | 半透底上文字对比度必须可控（Timing §8-10） |

---

## 7. 与架构的交叉点（已裁定）

- **窗口**：独立窗口，**固定 label `todos`**（`open_todos_window`）；宽 `--todos-w` 336，高自适应（超出滚动）。
- **几何持久化**：**不入库** —— 由 **`tauri-plugin-window-state` 按 label 自动维护**位置/尺寸。**本页无 `pos_x`/`monitor_id` 等 DB 几何字段**。
- **主题同步**：本窗**自订阅 `theme-changed`**。
