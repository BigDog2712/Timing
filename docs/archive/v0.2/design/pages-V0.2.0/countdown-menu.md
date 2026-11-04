# 页面：时长菜单 CountdownMenu（V0.2.0 · 新增）

> 覆盖对象：`DESIGN-V0.2.0.md` + `design-tokens-V0.2.0.{json,css}`
> **图例**：本文 ASCII 示意图中的 ○ / ● / ◐ 仅为实现层 SVG/CSS 图形的示意记号，非图标资产；实现一律使用 lucide-react SVG。
> 触发：小条右键菜单「倒计时 …」/ 事项右键「倒计时 …」| 主题：深/浅双主题 | 层：`--z-menu` (60)
> 来源：对齐 Timing `GlassMenu`（倒计时 时长菜单）
> 形态：自绘玻璃菜单（与 `context-menu.md` 同一套语言）
> 对应命令：`start_countdown` `set_countdown_preset` | settings：`countdown_presets`
> 注意 与架构交叉：倒计时 = 状态机扩展（`mode: countdown` + `target_sec` + 到点行为）

---

## 1. 布局与尺寸标注

```
+--------------------------------------+  min-width --menu-w 184 / padding 6 / r-lg 12
| ● 摸会儿鱼              12:34         |  ← 顶部状态块（计时中时才有）
| 倒计时 · 剩 07:26                     |
+--------------------------------------+
|  倒计时 · 选择时长                    |  ← 分组标题（11/600/.08em/--ink-4）
|  [timer]  5 分钟                    05:00   |  ← 预设项：图标 + 名 + 右侧等宽时长（出厂默认 5/15/25/45）
|  [timer]  15 分钟                   15:00   |
|  [timer]  25 分钟                   25:00   |
|  [timer]  45 分钟                   45:00   |  ◀ hover 底 --bg-field-hi
|  ────────────────────────────         |  ← 1px --line, margin 5 6
|  [timer]  自定义…                           |  ← 打开输入（分钟/秒）
|  ↻  结束当前并开始                    |  ← 当前在计时时才出现
+--------------------------------------+
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 容器 | `min-width --menu-w` 184 + `padding --menu-pad` 6 + `--radius-lg` 12 | |
| 底 | 玻璃 `--menu-bg`（94% / 浅色 97%）+ 1px `--line-2` + `--shadow-float` | |
| 行高 | `--menu-item-h` 30；`padding 0 --menu-item-pad-x` 9；gap `--menu-icon-gap` 10；`radius 6` | |
| 行文字 | `--menu-text`（`--ink-2`）；hover → `--bg-field-hi` 底 + `--ink` 字 | |
| 图标 | 16px 描边型，`--ink-4`；hover → `--ink-3` | |
| 右侧信息位 | 等宽 11 / `--ink-4`（预设时长 05:00 等） | |
| 状态块 | `--bg-field` 底 + 1px `--line` + `radius 8` + `padding 9 10` | 复用应用内 `MenuStatusBlock`（托盘菜单为原生，无状态块） |

---

## 2. 组件树

```
<CountdownMenu>
+-- <MenuStatusBlock/>      计时中时：●任务名 … 12:34 / 倒计时 · 剩 07:26
+-- <MenuGroup label="倒计时">
|   +-- <MenuItem icon="timer"  label="5 分钟"  info="05:00"/>
|   +-- <MenuItem icon="timer"  label="10 分钟" info="10:00"/>
|   +-- <MenuItem icon="timer"  label="15 分钟" info="15:00"/>
|   +-- <MenuItem icon="timer"  label="25 分钟" info="25:00"/>
+-- <MenuSeparator/>
+-- <MenuItem icon="timer" label="自定义…"/>        打开 <CustomDurationInput/>
+-- <MenuItem icon="repeat" label="结束当前并开始"/>  （计时中才有）
```

---

## 3. 状态与交互

### 3.1 预设来源（AC-62）

预设来自 `settings.countdown_presets`，**用户可增删改**；出厂默认一组 **5 / 15 / 25 / 45 分钟** 作起点。用户改预设后菜单实时反映。

### 3.2 交互态

| 状态 | 菜单项 | 状态块 | 自定义输入 |
|---|---|---|---|
| Default | `--ink-2` 字 / `--ink-4` 图标 | 静态展示 | — |
| Hover（`--dur-quick`） | 底 `--bg-field-hi` + 字 `--ink` + 图标 `--ink-3` | — | — |
| Active | 底 `--bg-field-hi`，`scale(0.99)` | — | — |
| Selected / Current | **不适用**（时长无「当前选中」概念） | — | — |
| Focus-visible | `--focus-ring` 双环（键盘导航时） | — | 输入框 `--focus-ring` |
| Loading | 点击预设后 1 帧：行尾信息位换 spinner（`--ink-3`） | — | — |
| Error | 自定义非法（0 / 超上限）→ 输入框 1px `--danger` + 行下 11px 提示 | — | 同左 |
| Empty | `countdown_presets` 为空 → 仅「自定义…」一项 | — | — |
| Edge | 自定义上限 99:59:59；输入 < 1 分钟 → 提示「最短 1 分钟」；当前在计时但非倒计时 → 「结束当前并开始」文案准确 | — | — |

### 3.3 倒计时的状态机语义（设计侧口径 — 对齐 AC-62）

- 倒计时 = `running` 的子模式：`mode: countdown` + `target_sec`。
- 小条色环在倒计时下显示**递减弧**（剩余比例），时间数字倒数（仍 `tabular-nums` + 定宽）。
- **到点默认行为 = 通知 + 视觉提示**（对齐提醒的告知语义；不默认结束）。
- 「**自动结束并保存**」为**用户可配开关，默认关闭**（防误结束正在进行的记录）→ AC-62。开关落在设置面板「通用」页。
- **不新增全局快捷键**（全局快捷键整体维持 P1）；经小条 / 菜单选时长即可。
- 视觉上到点先走 900ms ENDED 确认；若开了「自动结束并保存」，确认后即落盘保存。
- 倒计时进行中再次打开本菜单 → 「结束当前并开始」置顶并可用。

### 3.4 键盘路径

`↑↓ / Home / End` 移动；`Enter` 选中；`Esc` 关闭；数字键可快速选中对应项（可选加速）。

---

## 4. 引用的 Token 名

- 颜色：`--menu-bg` `--line` `--line-2` `--bg-field` `--bg-field-hi` `--ink` `--ink-2` `--ink-3` `--ink-4` `--accent` `--danger` `--focus-ring`
- 尺寸：`--menu-w` `--menu-item-h` `--menu-item-pad-x` `--menu-icon-gap` `--menu-pad` `--menu-status-h` `--radius-lg` `--radius-md` `--icon-sm`
- 阴影：`--shadow-float`
- 动效：`--dur-base` `--dur-quick` `--ease-standard`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke | 用途 |
|---|---|---|---|
| `timer` | 16px | 2.5 | 各时长预设项 |
| `repeat` | 16px | 2.5 | 「结束当前并开始」 |
| `clock` | 16px | 2.5 | 自定义… |
| `bell` | 16px | 2.5 | 状态块（可选，提醒联动） |

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 状态块 | 仅应用内悬浮菜单有（**托盘菜单为原生，无**） | 本菜单在**计时中**也显示 | 倒计时上下文需要「当前任务」 |
| 时长信息位 | 通用信息位 | **等宽 11 显示 mm:ss** | 数字列对齐，扫读快 |
