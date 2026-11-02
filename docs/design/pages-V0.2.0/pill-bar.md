# 页面：药丸主视图 PillBar（V0.2.0 · 改造）

> 覆盖对象：`DESIGN-V0.2.0.md` + `design-tokens-V0.2.0.{json,css}`（MASTER = 全局源）
> 本文件只写**差异字段**与**本页规格**，未提及项一律沿用 MASTER / Token 源。
> 触发：应用常驻 | 主题：**深/浅双主题** | 层：`--z-pill` (10)
> 对应命令：`get_timer_state` `start_timer` `pause_timer` `resume_timer` `stop_timer` `undo_stop` `start_countdown`
> V0.2.0 变更：**几何全面对齐 Timing**（高 48→34 / 色环 ⌀32→⌀22 stroke 2.6 / 圆角 24→h/2 / 宽随事项伸缩 / 删除运行光晕）
> **2026-10-16 UI 统一（对齐 Timing 截图实测 + MainForm.cs 源码常量）**：色环 ⌀22→**⌀16 stroke 2.4**（RingD 14 + 命中余量，命中区 ::before 扩到 ⌀24）/ 计时数字 14 mono→**20px Segoe UI Semibold 观感（tabular-nums 保 AC-24）**/ 事项名 13/500→**14 Bold 全墨**/ **删除分隔线**（Timing 无）/ 新增**状态墨度** idle .75 / paused .88 / 透明态文字投埃 `--shadow-ink`（悬停淡出）/ 运行态改 **90° 旋转弧**（3.2s/圈，spin 113°/s）/ 暂停态改 **270° 静弧**（--color-warn = Timing RingPause #E8A33D）/ 环内**不再放图标**（Timing 同款；图标锁 16/20/24 档，⌀16 环不容；状态由环色+弧形承载）
> 相关验收：AC-01~06 / AC-24 / AC-25
> **2026-10-19 V0.3.6 弧语义再统一**：本文件下方表格里的「底轨 35%」「倒计时暂停=冻结弧」
> 已被 `docs/decisions/ADR-024.md` 取代——底轨只剩 SVG track 一处（37%）、暂停在两模式下
> 统一 270° 静弧、旋转改为显式 `data-spin`（倒计时 running **不旋转**）。以 ADR-024 为准；
> 本页其余字段（几何 16/2.4、状态墨度、环内不放图标）仍然有效。

---

## 1. 几何与尺寸标注（对齐 Timing §4.1）

```
+-----------------------------------------------------------------------------------+
|  小条本体：高 --pill-h 34 / 圆角 --radius-pill (h/2 = 17) / 宽 116–288（自适应）    |
|  内边距：0 7 0 8（左 8 / 右 7）    内部 gap：--space-2 8                            |
|                                                                                   |
|  [ 色环 ⌀22 ]  00:00  事项名（flex 0 1 auto, max 164）              [ 柄 ）]      |
|   stroke 2.6   min 53px  截断省略号                                  10 格         |
|                 ^ 时间 min-width 53px，数字原地变化                                 |
+-----------------------------------------------------------------------------------+
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 小条高 | `--pill-h` **34px**（`--pill-h-compact` 30px，设置可切） | DIP |
| 圆角 | `--radius-pill` = `calc(--pill-h/2)` = **17px**（真胶囊） | 变形到面板时过渡到 `--radius-lg` 12px |
| 宽度 | `width: auto`，`--pill-w-min` 116 → `--pill-w-max` 288 | **不做定宽**（见 §1.1） |
| 内部 gap | `--space-2` **8px**（环↔时间、时间↔事项名） | |
| 内边距 | `--pill-pad-l` 8 / `--pill-pad-r` 7 | 右比左紧：右端放柄 |
| 色环 | `--ring-size` **⌀16**，`--ring-stroke` **2.4**；运行=90°旋弧 / 暂停=270°静弧（warn 色）/ 倒计时=递减弧；底轨 = 同色 35%（Timing RingTrackAlpha 95/255） | Timing 对齐（RingD 14 + 命中余量） |
| 时间 | `--text-timer-pill` **20** / `--weight-semibold` 600 / `--font-timer`（Segoe UI）+ `tabular-nums` / `min-width 5ch` | Timing TimeEm 28 在 53px 盒内自动收缩 → 实测有效 ≈19-20 |
| 事项名 | `--text-task-pill` **14** / `--weight-strong`(650→YaHei Bold) / 全墨 `--ink` / `max-width: --task-w-max` 164 / 省略号 | Timing TaskEm 14 YaHei Bold；暂停变暗由状态墨度 0.88 承载，不再单独 muted |
| 抓取柄 | 格宽 `--grip-w` 10，命中 `--grip-hit-w` 10；SVG 12×22，`stroke 2.2`，路径 `M5.6 3.6 C9 6.6, 9 15.4, 5.6 18.4` | **仅 hover 显示** |
| 底色 | `--pill-bg`（= `--color-bar`，用户可配） | |
| 内描边 | 1px `--pill-border-in`（`--line-2`），**无外边框** | |
| 空闲投影 | `--shadow-balloon`（两层贴边硬影） | Timing 对齐（原三趟盒式模糊） |
| 运行光晕 | **无**（V0.2.0 删除；状态由色环承载） | 规避「发光+玻璃」AI 套路 |

### 1.1 宽度是动态的（不可按定宽画）

```
BarW = BarBase + TaskW
  BarBase = padL 8 + ring 22 + gap 8 + time 53 + gap 8 + grip 10 + padR 7 = 116
  TaskW   <= MaxTaskW 164
```

| 事项 | 逻辑宽 |
|---|---|
| 极短（"摸鱼"） | **≈116** |
| 常规（"重构事项窗口"） | **≈200** |
| 到上限（墨迹 > 164 → 省略号） | **≈280（硬上限 288）** |

CSS：`.bar { width: auto } .bar .task { flex: 0 1 auto; max-width: var(--task-w-max); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }`

---

## 2. 组件树

```
<PillBar data-state="idle|running|paused|ended" data-theme="dark|light">
+-- <StatusRing/>            环 ⌀22 + stroke 2.6（SVG），无光晕
|   +-- <RingIcon/>          hover / paused / ended 时淡入的 16px Lucide 图标
+-- <TimerDisplay/>          .timer-digits（mono / tabular-nums / 53px / 右对齐）
+-- <PillDivider/>           1px × 20px 分隔线（有事项名时显示，色 --pill-divider）
+-- <ItemName/>              事项名（flex 0 1 / max 164 / 省略号）
+-- <NewItemEntry/>          空状态替代：plus 16px + 「新建事项」（--ink-3）
+-- <GripHandle/>            圆角括号 ）（SVG 12×22，仅 hover）
```

---

## 3. 状态与交互

### 3.1 四态视觉矩阵（核心）

| 属性 | IDLE | RUNNING | PAUSED | ENDED（瞬时 900ms） |
|---|---|---|---|---|
| 小条底 | `--pill-bg` | `--pill-bg` | `--pill-bg` | `--pill-bg` |
| 环描边色 | `--state-idle`（`--ink-3`） | `--color-running`（`--accent`） | `--ink-3` 淡 | `--color-done`（`--ok`） |
| 环描边宽 | 2.6px | 2.6px | 2.6px | 2.6 → 3px（强调） |
| 环内图标 | 无（hover 出 `play` 16px） | 无（hover 出 `pause` 16px） | 常显 `pause` 16px | `check` 16px |
| 倒计时模式 | — | 环画**递减弧**（剩余比例）+ 时间倒数 | 冻结弧 | 到点 → `check` |
| 计时数字色 | `--ink` | `--ink`（**保持高对比**） | `--ink-2` | `--ink-2` |
| 事项名区 | 「新建事项」+ `plus`（`--ink-3`） | 事项名（`--ink-2`） | 同 RUNNING，`--ink-3` | 事项名 + `check` |
| 动效 | 无 | 1Hz tick（`--dur-tick`） | **完全静止** | 绿色收束 `--dur-confirm` |

> **关键决策 1**：计时数字在 RUNNING 保持 `--ink` 不变色 —— 状态由**色环**承载，数字只负责可读性（AC-24）。
> **关键决策 2**：倒计时为 RUNNING 的子模式（`mode: countdown` + `target_sec`），色环显示剩余比例弧；到点行为（自动结束 / 铃声 / 通知）由状态机决定，视觉上先走 ENDED 确认。
> **关于 ENDED**：不是第四状态机状态，是 900ms 瞬时视觉确认，随后回 IDLE。撤销条是唯一新增形态（`undo-bar.md`）。

### 3.2 交互态

| 状态 | 小条本体 | 色环按钮 | 事项名 / 柄 |
|---|---|---|---|
| Default | `--pill-bg` + 1px `--pill-border-in` + `--shadow-balloon` | 环 2.6px 状态色 | 文字 `--ink-2` |
| Hover（`--dur-quick` 150ms） | 底 → 悬停板 `--pill-hover-plate`（**高不透明度板 94%，无 `backdrop-filter`** — 架构裁定保拖拽顺滑）+ 1px `--line-2` + `--inset-top` + `--shadow-pop` | 环内淡入 16px 动作图标 | 文字 → `--ink`；柄 `opacity 0 → 1` |
| Active（`--dur-instant` 100ms） | 底 → `--bg-field-hi`，`scale(0.985)` | `scale(0.92)` | 底 `--accent-wash`，`scale(0.97)` |
| Focus-visible | `--focus-ring` 双环 | 同左 | 同左 |
| Dragging | 底 → `--bg-field-hi`，`--shadow-plate`，`scale(1.02)`，`cursor: grabbing` | — | — |
| Loading（首启） | 从 28px 圆点展开到完整形态（`--dur-morph` 280ms），数字骨架 `--:--` 用 `--ink-4`（**静态不闪烁**） | 环画半圆弧 240ms | — |
| Error（保存失败） | 环闪 `--danger` 一次（180ms） | 同左 | 撤销条换红提示（`undo-bar.md`） |
| Empty（无活跃事项） | 事项名区「新建事项」+ `plus` | hover 出 `play` | — |
| Disabled | **不适用**（小条永不 disabled） | 无事项时开始仍可用（先弹新建面板） | — |

### 3.3 输入与去抖

- 左键点环：IDLE → RUNNING / RUNNING → PAUSED / PAUSED → RUNNING。
- 右键单击（按下→抬起 < `--click-max-ms` 400ms）：立即结束并保存 → ENDED + 撤销条。
- 右键长按 >= `--long-press-ms` 500ms：弹出自绘玻璃上下文菜单（`context-menu.md`）。
- 左键点事项名：切「常用事项」菜单（`common-items.md`）。
- 连点环：`--debounce-ms` 200ms 去抖。
- 双击条身：无绑定；条身仅用于拖拽（阈值 `--drag-threshold` 4px）。

### 3.4 键盘路径

`Tab`/`Shift+Tab` 四焦点站循环 → 环 / 数字区 / 事项名 / 柄；`Space` 开始暂停；`Enter` 结束并保存；`Menu`/`Shift+F10` 开菜单；`Esc` RUNNING 下**不**结束（防误触丢数据）。

---

## 4. 引用的 Token 名

- 颜色：`--pill-bg` `--pill-border-in` `--pill-hover-plate` `--pill-divider` `--pill-grip-ink` `--ink` `--ink-2` `--ink-3` `--ink-4` `--accent` `--color-running` `--color-done` `--ok` `--danger` `--accent-wash` `--bg-field-hi` `--line-2` `--ring-track` `--focus-ring`
- 尺寸：`--window-w` `--window-h` `--pill-h` `--pill-h-compact` `--radius-pill` `--pill-w-min` `--pill-w-max` `--task-w-max` `--pill-pad-l` `--pill-pad-r` `--ring-size` `--ring-stroke` `--grip-w` `--grip-hit-w` `--grip-svg-w` `--grip-svg-h` `--space-2` `--hit-target` `--snap-margin` `--drag-threshold`
- 阴影：`--shadow-balloon` `--shadow-pop` `--shadow-plate`
- 动效：`--dur-instant` `--dur-quick` `--dur-exit` `--dur-base` `--dur-morph` `--dur-confirm` `--dur-tick` `--ease-standard` `--ease-morph`
- 排版：`--font-mono` `--text-num` `--text-body` `--weight-strong`
- 层级：`--z-pill`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标（Lucide 名） | 尺寸 | stroke-width | 用途 |
|---|---|---|---|
| `play` | 16px | 2.5 | IDLE hover 时环内显示 |
| `pause` | 16px | 2.5 | RUNNING hover / PAUSED 常显 |
| `check` | 16px | 2.5 | ENDED 态环内对勾 |
| `plus` | 16px | 2.5 | 空状态「新建事项」入口 |

> 抓取柄 **不是 lucide 图标**，是自绘 SVG 圆角括号 `）`（`viewBox 12×22`，路径见 §1）。
> 禁用清单：任何 emoji 与 `U+2713` / `U+2714` / `U+26A0` / `U+274C` 等字符符号。

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 强调色可见用量 | 每屏 ≤ 2 处 | **小条内 ≤ 1 处**（色环算 1 处） | Density=8 硬约束 |
| 计时数字色 | `--ink` | RUNNING 下**不变色** | 长时阅读舒适度；状态由环承载 |
| 阴影 | `--shadow-plate` | 空闲态用 `--shadow-balloon`（贴边硬影） | 让字在任意壁纸上清晰（不靠模糊影） |
| 高 | `--pill-h` 34 | 紧凑档可切 30 | 保留 v1 的「紧凑」设置能力 |
| 运行光晕 | MASTER 无 | 本页显式**无** | V0.2.0 删除（对齐 Timing） |
