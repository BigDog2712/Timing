# 页面 Override：药丸主视图 PillBar

> 覆盖对象：`DESIGN.md` + `design-tokens.json`（MASTER = 全局源）
> 本文件只写**差异字段**，未提及项一律沿用 MASTER / Token 源。
> 触发：应用常驻（AC-01） | 主题：恒定深色 | 层：`--z-pill` (10)
> 对应命令：`get_timer_state` `start_timer` `pause_timer` `resume_timer` `stop_timer` `undo_stop`
> 相关验收：AC-01 / AC-02 / AC-03 / AC-04 / AC-05 / AC-06 / AC-24 / AC-25

---

## 1. 布局与尺寸标注

固定置顶层 `--window-w` 384 x `--window-h` 360 DIP（**永不 resize**）；药丸锚定层内，默认停靠屏幕右下角、距边 `--snap-margin` 16 DIP。

```
+-----------------------------------------------------------------------+
|  药丸本体：高 --pill-h 48 / 圆角 --radius-pill 24 / 宽自适应            |
|  内边距：上下 --space-1 2 / 左右 --space-1 2                            |
|                                                                       |
|   [ 环 ]   00:00   |  事项名（1fr, 截断）                 [ 手柄 ]     |
|   44x44   min5ch   1pxx20   1fr max11中文字符            44x44        |
|   热区    数字区    分隔线                                热区         |
+-----------------------------------------------------------------------+
   ^ 环视觉 32px 直径 / 描边 --ring-stroke 2
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 药丸高 | `--pill-h` 48px（`--pill-h-compact` 40px，设置可切） | DIP；150% DPI -> 72 物理像素 |
| 圆角 | `--radius-pill` 24px（= 高 / 2，真胶囊） | 变形到面板时过渡到 `--radius-lg` 16px |
| 宽度 | 内容自适应 `--pill-w-min` 256 / `--pill-w-typ` 288 / `--pill-w-max` 360 | 不用固定宽 |
| 左侧环 | 视觉 `--ring-size` 32px，描边 `--ring-stroke` 2px；热区 `--hit-target` 44x44 | 环内空白直径 28px |
| 数字区 | 左距环 `--space-5` 12px，`min-width: 5ch`（`--timer-digits`） | 20px Geist Mono 时 5ch ~= 60px |
| 内部分隔线 | 1px x `--space-7` 20px，色 `--divider`（`--border-soft`）；左 `--space-5` 12 / 右 `--space-4` 10 | 仅在有事项名时出现 |
| 事项名 | `1fr`，超 `--size.nameMaxChars` 11 中文字符后省略号；超长保留**开头** | "品牌视觉改版..." 优于 "...改版第一轮" |
| 右侧手柄 | 图标 `--icon-md` 20px（`chevron-right`），热区 `--hit-target` 44x44 | 收起入口 |
| 描边 | 1px `--pill-border`（`--edge-inner`）内描边，**无外边框** | 模拟金属边缘；配合外阴影成实体感 |
| 外阴影 | `--pill-shadow`（`--elev-raised`） | 靠阴影浮起，**不用毛玻璃** |
| 运行光晕 | `--accent-halo`，56x56，铺在环下方，不透明度上限 0.10 | 全项目唯一允许的渐变 |

---

## 2. 组件树

```
<PillBar data-state="idle|running|paused|ended">
+-- <StatusRing/>            环 32px + 可选 halo 56x56 + 可选环内图标 16px
|   +-- <RingIcon/>          hover/paused/ended 时淡入的 16px Lucide 图标
+-- <TimerDisplay/>          .timer-digits （Geist Mono / tabular-nums / 5ch / 右对齐）
+-- <PillDivider/>           1px x 20px 分隔线（有事项名时显示）
+-- <ItemName/>              事项名（1fr，截断，hover 400ms 出完整名 tooltip）
+-- <NewItemEntry/>          空状态替代 ItemName：plus 16px + 文案
+-- <CollapseHandle/>        20px chevron-right @ 44x44 热区
```

---

## 3. 状态与交互

### 3.1 四态视觉矩阵（核心）

| 属性 | IDLE | RUNNING | PAUSED | ENDED（瞬时 900ms） |
|---|---|---|---|---|
| 药丸底 | `--pill-bg` | `--pill-bg` | `--pill-bg` | `--pill-bg` |
| 环描边色 | `--state-idle` | `--state-running` | `--state-paused` | `--success`（900ms 后回 `--state-idle`） |
| 环描边宽 | 2px | 2px | 2px | 2px -> 3px（强调） |
| 环内图标 | 无（hover 出 `play` 16px） | 无（hover 出 `pause` 16px） | 常显 `pause` 16px，色 `--state-paused` | `check` 16px，色 `--success` |
| 计时数字色 | `--fg` | `--fg`（**保持高对比**） | `--fg-2` | `--fg-2` |
| 事项名区 | 「新建事项」+ `plus`（`--muted`） | 事项名（`--fg-2`） | 同 RUNNING 但 `--muted` | 事项名 + 绿色 `check` |
| 光晕 | 无 | `--accent-halo` 呼吸 `--dur-breath` 2400ms | 无 | 绿光晕 300ms 淡出 |
| 动效 | 无 | 1Hz tick（`--dur-tick` 1000ms）+ 呼吸 | **完全静止** | 绿色收束 |

> **关键决策：** 计时数字在 RUNNING 保持 `--fg`（15.5:1）不变琥珀。状态由环 + 光晕承载，数字只负责可读性。

> **关于 "ENDED"（防误读）：** 它**不是**计时器状态机的第四个状态——状态机仅 `idle | running | paused`（IPC-CONTRACT-v2 已移除 `draft`）。ENDED 是一次 **900ms 的瞬时视觉确认**（色 `--success` + `--dur-confirm`），随后自动回归 IDLE。撤销条是本交互唯一新增的形态，**设计内不存在任何"待确认收尾浮层 / 阻塞确认对话框"**（AC-05 明确禁止）。

### 3.2 交互态（每一可交互元素必覆盖）

| 状态 | 药丸本体 | 环形按钮 | 事项名/手柄 |
|---|---|---|---|
| Default | `--pill-bg` + 1px `--pill-border` | 环 2px 状态色 | 文字 `--muted` |
| Hover（`--dur-quick` 150ms） | 底 `--pill-bg-hover`，描边 -> `rgba(255,255,255,0.12)`，阴影 `--pill-shadow-hover` | 环内淡入 16px 动作图标，环色提亮 8% | 文字 -> `--fg`，底 `--surface-3` 圆角 pill |
| Active（`--dur-instant` 100ms） | 底 `--pill-bg-active`，`scale(0.985)` | `scale(0.92)`，光晕不透明度 +0.04 | 底 `--surface-4`，`scale(0.97)` |
| Focus-visible | `--focus-ring` 双环（2px 间隙 + 2px 琥珀） | 同左 | 同左 |
| Dragging | 底 `--pill-bg-drag`，阴影 `--pill-shadow-drag`，`scale(1.02)`，`cursor: grabbing` | - | - |
| Loading（首次启动） | 宽度从 28px 圆点展开到完整形态（`--dur-morph` 280ms），数字骨架 `--:--` 用 `--meta`（**静态不闪烁**） | 环画半圆弧 240ms | - |
| Error（保存失败） | 环闪 `--danger` 一次（180ms） | 同左 | 撤销条换红色提示见 `undo-bar.md` |
| Empty（无活跃事项） | 事项名区显示「新建事项」+ `plus` | hover 出 `play` | - |
| Disabled | **不适用**（药丸永不 disabled） | 无事项时开始按钮仍可用（先弹新建面板） | - |

### 3.3 输入与去抖

- 左键点环：IDLE -> RUNNING / RUNNING -> PAUSED / PAUSED -> RUNNING。
- 右键单击（按下->抬起 < `--size.clickMaxMs` 400ms）：立即结束并保存 -> ENDED + 撤销条。
- 右键长按 >= `--size.longPressMs` 500ms：弹出上下文菜单（见 `context-menu.md`）。
- 连点环：`--size.debounceMs` 200ms 去抖，忽略重复触发。
- 双击条身：无绑定；条身仅用于拖拽（阈值 `--drag-threshold` 4px）。

### 3.4 键盘路径

`Tab`/`Shift+Tab` 四焦点站循环 -> 环 / 事项名区 / 新建入口 / 手柄；`Space` 开始暂停；`Enter` 结束并保存；`Menu`/`Shift+F10` 开菜单；`Esc` RUNNING 下**不**结束（防误触丢数据）。

---

## 4. 引用的 Token 名

- 颜色：`--pill-bg` `--pill-bg-hover` `--pill-bg-active` `--pill-bg-drag` `--pill-border` `--divider` `--surface-3` `--surface-4` `--fg` `--fg-2` `--muted` `--meta` `--state-idle` `--state-running` `--state-paused` `--success` `--danger` `--accent-halo` `--focus-ring`
- 尺寸：`--window-w` `--window-h` `--pill-h` `--pill-h-compact` `--pill-w-min` `--pill-w-typ` `--pill-w-max` `--ring-size` `--ring-stroke` `--hit-target` `--snap-margin` `--drag-threshold` `--space-1` `--space-4` `--space-5` `--space-7` `--radius-pill` `--icon-sm` `--icon-md`
- 阴影：`--pill-shadow` `--pill-shadow-hover` `--pill-shadow-drag`
- 动效：`--dur-instant` `--dur-quick` `--dur-base` `--dur-morph` `--dur-confirm` `--dur-tick` `--dur-breath` `--ease-standard` `--ease-morph`
- 排版：`--font-mono` `--text-timer` `--weight-emphasize`（见 `.timer-digits`）
- 层级：`--z-pill`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标（Lucide 名） | 尺寸 | stroke-width | 用途 |
|---|---|---|---|
| `play` | `--icon-sm` 16px | 2.5 | IDLE hover 时环内显示（启动语义） |
| `pause` | `--icon-sm` 16px | 2.5 | RUNNING hover / PAUSED 常显 |
| `check` | `--icon-sm` 16px | 2.5 | ENDED 态环内对勾 + 事项名区 |
| `plus` | `--icon-sm` 16px | 2.5 | 空状态「新建事项」入口 |
| `chevron-right` | `--icon-md` 20px | 2 | 右侧收起手柄 |

> 禁用清单：任何 emoji 与 `U+2713` / `U+2714` / `U+26A0` / `U+274C` 等字符符号，一律用上表 Lucide 图标替代。

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 强调色可见用量 | 每屏 <= 2 处 | **药丸内 <= 1 处**（环 + 光晕算 1 处） | Density=8 硬约束，防视觉噪音 |
| 计时数字色 | `--fg` | RUNNING 下**不变色**，保持 `--fg` | 长时阅读舒适度 + 状态由环承载 |
| 命中区 | 44x44 | 条身拖拽阈值 4px（< 4px 视为点击） | 防手抖误拖（Windows 平台特化） |
