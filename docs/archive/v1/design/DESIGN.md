# Timing DESIGN.md

> 生成日期：2026-10-16 | 设计师：颜好看 | 阶段：Phase 2 设计细化
> 基于：Spec v1.0 §7/§8/§9/§10 + UIUX 文档 v1 + ADR-001~006
> 三轴刻度：**Variance = 7 / Motion = 5 / Density = 8**
> 设计寄存器：**Product Register（产品型）** — 设计服务产品，标杆是「赢得熟悉感」而非「独特性」
> 平台轴：**Windows 桌面（Tauri 2 + React 19）**，固定 384x360 DIP 透明置顶层，无 Web 路由
> 索引：Token 源文件 `design-tokens.json` / `design-tokens.css`；页面级 Override 见 `pages/`

---

## 1. Visual Theme & Atmosphere（视觉主题与氛围）

**设计方向：Floating Instrument（悬浮仪表）**
不是「一个计时器 App 的悬浮窗」，而是「桌面上的一个精密仪表」——像一支黄铜秒表的表盘，安静、精确、随时可用。

**三个声音词（Voice Words）：**
- **Brass-precise（黄铜般精密）** — 字距严谨、数字等宽、1px 线不含糊
- **Holdable（可握持）** — 药丸有实体感：实色底 + 内描边 + 外阴影，像一枚可以拿起来的物件
- **Unneurotic（不焦虑）** — 无红外闪烁、无进度条逼迫、无弹跳动效。计时是陪伴，不是监工

**氛围描述：** 近黑仪表底 + 等宽数字 + 一枚琥珀色信号环。静止时像关机，运行时像心跳。在同屏的 Slack / 浏览器 / IDE 之上，它应当是最安静但最容易被眼睛找到的那 3 平方厘米。

**对标品牌：**
- 主对标 **Raycast**（近黑底 + 极低饱和中性层次 + 单一强调色 + "一个输入条承载全部交互"）
- 辅助 **Apple Dynamic Island**（形态语言）/ **Linear**（排版纪律）/ **Things 3**（克制哲学）

**明确不对标：** Toggl Track（表单化、步骤多）/ Sunsama（规划型、信息过载）/ Notion（内容型、无限嵌套）。它们是"要打开的应用"，Timing 是"一直在那里的状态"。

---

## 2. Color Palette & Roles（色彩与角色）

### 2.1 A1-identity（品牌核心）

| 角色 | Token | 色值 | 说明 |
|---|---|---|---|
| 深渊底 | `--bg` | `#0E0F12` | L0，投影基色 / 撤销条底 |
| 药丸底 | `--surface` | `#1A1C20` | L1，默认背景 |
| 抬升 | `--surface-2` | `#22242A` | L2，hover / 展开面板底 |
| 高亮面 | `--surface-3` | `#2B2E35` | L3，按下 / chips / 菜单 hover |
| 顶层 | `--surface-4` | `#343841` | L4，输入框底 / 菜单按下 |
| 主文本 | `--fg` | `#F2F4F7` | 15.5:1 |
| 次级文本 | `--fg-2` | `#C3C8D0` | 10.1:1 |
| 三级文本 | `--muted` | `#8B919C` | 5.38:1 |
| 强调色 | `--accent` | `#E9A23B` | Signal Amber 信号琥珀，**纯色零渐变** |
| 默认描边 | `--border` | `#33373F` | 面板 / 菜单外描边（装饰） |
| 缩进描边 | `--border-soft` | `#26292F` | 药丸内部 1px 分隔线（装饰） |

### 2.2 A2-semantic（语义色）

| 角色 | Token | 色值 | 说明 |
|---|---|---|---|
| 成功 | `--success` / `--state-ended` | `#3FB950` | 保存成功，6.72:1 |
| 警告 | `--warn` | `#D29922` | 超时 / 休眠缺口，6.76:1 |
| 危险 | `--danger` | `#F2555A` | 仅用于"销毁数据"类动作，5.05:1 |
| 信息 | `--info` | `#7C93AC` | 复用钢蓝 |
| 待机 | `--state-idle` | `#8B919C` | 中性、待命 |
| 计时中 | `--state-running` | `#E9A23B` | 暖、活，7.88:1 |
| 已暂停 | `--state-paused` | `#7C93AC` | 冷、静，钢蓝，5.39:1 |

### 2.3 B-slot 别名（组件层引用这些，不直接引用原始值）

`--fg-2` / `--meta` / `--pill-bg` / `--pill-bg-hover` / `--pill-border` / `--menu-bg` / `--menu-item-hover` / `--input-bg` / `--input-placeholder` / `--chip-bg` / `--chip-text` / `--undo-bg` / `--undo-action` / `--accent-hover` / `--accent-on` / `--focus-ring` / `--divider` / `--text-disabled`

> **`--meta` 说明：** 3.63:1，**仅限图标 / 分隔线 / 禁用文案**，禁止承载可读正文。这是全项目唯一的"低对比合法用途"白名单。

### 2.4 C-extension（本项目专属，不在通用色板内）

- `--edge-inner` `rgba(255,255,255,0.08)` — 药丸顶部 1px 内高光，模拟物理金属边缘（**非毛玻璃**）
- `--accent-halo` `radial-gradient(...)` — 运行中光晕，不透明度上限 0.10（**全项目唯一允许的渐变**）
- `--scrim` `rgba(14,15,18,0.56)` — 对话框遮罩（不使用 `backdrop-filter`）

### 2.5 每屏强调色使用量（Density=8 下的硬约束）

- **药丸内最多 1 处**（状态环 + 其光晕算 1 处）
- **展开面板内最多 2 处**（输入框焦点环 + 主按钮）
- 其余全部中性色。这是防"AI 彩虹屁设计"的核心闸门。

### 2.6 配色来源

本项目为**自建深色中性阶**，不走 `color-palettes.md` 通用套色。理由：`--accent` 为 Signal Amber `#E9A23B`（深色效率工具中极罕见，主动规避 `#6366F1` 靛蓝默认值）；中性阶色相锁定 220度以上冷灰，规避暖中性奶油带。语义色沿用通用 `#3FB950 / #D29922 / #F2555A` 三档以保持工程熟悉度。

---

## 3. Typography（排版）

### 3.1 字体栈

```css
--font-ui:      "Geist Sans", "Noto Sans SC", -apple-system, "Segoe UI Variable Text", "Microsoft YaHei UI", sans-serif;
--font-display: var(--font-ui);   /* 标题复用界面字体，靠字重拉层级 */
--font-mono:    "Geist Mono", "JetBrains Mono", "Cascadia Mono", Consolas, monospace;
```

**字体解耦原则：** 本项目**不使用** Inter / DM Sans / Playfair 等训练数据默认值（命中反射拒绝清单）。Geist 的 `a / g / t / r` 字形与 Inter 有明确差异（更方、终端更平切、更接近瑞士工程制图），不是换皮。
**本地内联：** 三套字体与 Lucide SVG 必须打包进应用，**禁止请求 Google Fonts CDN**——悬浮工具在断网时必须是完整体验。

### 3.2 字号阶梯（48px 药丸专用的紧凑寄存器，非 Web 尺度）

| Token | 字号 / 行高 | 字重 | 字距 | 用途 |
|---|---|---|---|---|
| `--text-2xs` | 10px / 12px | 500 | `+0.06em` | 极小徽标（超时角标 4h+） |
| `--text-xs` | 11px / 16px | 500 | `+0.02em` | 快捷键提示 / 撤销条 / 菜单加速键 |
| `--text-sm` | 12px / 18px | 500 | `+0.01em` | 「新建事项」/ chips / 辅助说明 |
| `--text-base` | 13px / 20px | 510 | `0` | 事项名 / 菜单项 |
| `--text-md` | 14px / 22px | 510 | `0` | 展开面板输入框 / 菜单主项 |
| `--text-lg` | 16px / 24px | 590 | `-0.01em` | 展开面板标题 |
| `--text-timer` | **20px / 24px** | 510 | `0` | **药丸内计时数字（默认）** |
| `--text-timer-lg` | 28px / 32px | 510 | `-0.01em` | 展开面板大计时 |
| `--text-timer-xl` | 40px / 44px | 510 | `-0.02em` | 专注模式（v2，本期仅预留） |

### 3.3 字重三档体系

| 级别 | 字重 | 用途 | 禁止 |
|---|---|---|---|
| Read | 400 | 说明文字 / 撤销条正文 | 不用于数字 |
| Emphasize | **510** | 计时数字 / 菜单项 / 事项名 / 按钮 | — |
| Announce | 590 | 展开面板标题 / 大计时 | 不用于 14px 以下 |

**规则：** 48px 高度内只用 2 档字重（510 / 590），第 3 档（400）只在展开面板里出现。

### 3.4 字距规则

- ALL CAPS（`SPACE` / `ESC` / `ENTER`）**统一大写 + `letter-spacing: 0.06em`**，11px
- 中文**永不**加字距（一加立刻显得廉价）
- 标题负字距只对大于等于 16px 的拉丁文生效

### 3.5 计时数字硬规范（不可协商）

```css
.timer-digits {
  font-family: var(--font-mono);
  font-size: var(--text-timer);
  font-weight: var(--weight-emphasize);       /* 等宽数字不要 600+，会糊 */
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "zero" 1;
  letter-spacing: 0;
  min-width: 5ch;                             /* "00:00" 定宽 */
  text-align: right;                          /* 右对齐 + 定宽 = 数字原地变化 */
  white-space: nowrap;
}
.timer-digits[data-hours="true"] { min-width: 8ch; }
```

**这是全项目最重要的一条排版规则。** 计时数字必须在不换行、不宽度跳动的前提下每秒变化；任何宽度抖动都会让产品显得廉价（AC-24）。

**格式切换（契约锁定，与 IPC-CONTRACT-v2 §计时展示一致）：** `<1h` -> `MM:SS`（`min-width: 5ch`）；`>=1h` -> `HH:MM:SS`（`min-width: 8ch`，两位小时）；上限 `99:59:59`。前端实现于 `format.ts`，与 Token 的 `typography.timerDigits` 一一对应。

**计时器状态口径（契约锁定）：** 状态机只有 `idle | running | paused` 三态（v2 已移除 `draft`）。设计中出现的"ENDED / 结束态"是**一次 900ms 的瞬时视觉确认**（色 `--success` + `--dur-confirm`），不是第四个状态机状态；撤销条是唯一的新增形态，**不存在任何"待确认收尾浮层"**。

---

## 4. Components（组件规范）

### 4.1 圆形状态环按钮（RingButton）— 药丸左侧核心

| 状态 | 规格 |
|---|---|
| Default | 环 32px 直径，描边 2px 状态色，环内无图标 |
| Hover | 环内淡入 16px 动作图标（`play` / `pause`），环色提亮 8%，`--dur-quick` |
| Active | `transform: scale(0.92)`，光晕不透明度 +0.04，`--dur-instant` |
| Focus-visible | `--focus-ring` 双环（2px 间隙 + 2px 琥珀环） |
| Paused | 常显 16px `pause`，色 `--state-paused` |
| Ended | 16px `check`，色 `--success`，描边 2px -> 3px |
| Loading | 环画半圆弧（240ms，`--ease-standard`，不用旋转 spinner） |
| Error | 环闪 `--danger` 一次（180ms） |

### 4.2 药丸（Pill）

| 状态 | 规格 |
|---|---|
| Default | 底 `--pill-bg`，1px `--edge-inner` 内描边，阴影 `--elev-raised` |
| Hover | 底 `--pill-bg-hover`，描边 -> `rgba(255,255,255,0.12)`，阴影 -> `--elev-raised-hover`，150ms |
| Active | 底 `--pill-bg-active`，`transform: scale(0.985)`，100ms |
| Dragging | 底 `--pill-bg-drag`，阴影 `--elev-drag`，`scale(1.02)`，`cursor: grabbing` |
| Focus-visible | `--focus-ring` |
| Disabled | **不适用**（药丸永不 disabled） |
| Empty | 无活跃事项 -> 事项名区显示「新建事项」+ `plus` 16px |

### 4.3 输入框（ItemInput）

| 状态 | 规格 |
|---|---|
| Default | 高 36px，圆角 `--radius-sm`，底 `--input-bg`，文字 14px/510 `--fg`，placeholder `--muted` |
| Focus | 底 `--input-bg-focus`，2px `--focus-ring`（**本屏唯一一处强调色**） |
| Error | 1px `--danger` 描边 + 下方 11px `--danger` 内联提示 |
| Disabled | 不适用 |

### 4.4 Chips（RecentChips）

`--chip-h` 28px，圆角 `--radius-chip`，左右内边距 `--chip-pad-x`，文字 12px/500 `--chip-text`，底 `--chip-bg`。
Hover：底 `--chip-bg-hover` + 1px `--border-strong`。**数量上限 4 个**（工作记忆容量）。

### 4.5 菜单（ContextMenu）

宽 184px，圆角 `--radius-md`，底 `--menu-bg`，内边距上下 4px / 左右 0。
菜单项高 32px，左内边距 10px，图标 16px + 8px + 13px 文字。
Hover：底 `--menu-item-hover`，文字 `--fg`。**禁止 3px 彩色左边框**。
危险项（`trash-2`「丢弃本次记录」）：文字 `--menu-danger`。
分隔线：1px `--border-soft`，上下 4px。

### 4.6 图标

**统一 SVG 图标库：`lucide-react`（唯一，全项目不混用）**，尺寸 16 / 20 / 24px 三档；**16px 时 `stroke-width: 2.5`，20px / 24px 时 `2`**，保证视觉线重一致。
**零 emoji 作为功能图标**（详见 §7 与 §9）。

> **例外：系统托盘图标不是 Lucide 组件。** 托盘图标由 Rust 侧提供 `.ico`（含 16/20/24/32px 多尺寸）与 `.png`，按 Windows 系统托盘规范渲染，尺寸由 Shell 决定（逻辑 16px / 200% DPI 32px），**前端不参与绘制**。托盘菜单为系统原生菜单（`tauri::tray` + `Menu`），不使用任何自定义 CSS 与 Token。这与"药丸/面板内图标必须 lucide-react"并不冲突：前者是 OS 原生资源，后者是应用内 UI 图标。

### 4.7 组件状态矩阵（9 态覆盖）

| 组件 | Default | Hover | Focus | Active | Disabled | Loading | Error | Empty | Success |
|---|---|---|---|---|---|---|---|---|---|
| Pill | O | O | O | O | N/A | O | O | O | O |
| RingButton | O | O | O | O | N/A | O | O | O | O |
| ItemInput | O | O | O | O | N/A | N/A | O | O | O |
| Chip | O | O | O | O | N/A | N/A | N/A | N/A | N/A |
| MenuItem | O | O | O | O | O | N/A | N/A | N/A | N/A |
| RecordsPanel | O | O | O | O | N/A | O | O | O | N/A |

---

## 5. Layout & Spacing（布局与间距）

### 5.1 间距系统（4px 网格）

`--space-1..12` = 2 / 4 / 8 / 10 / 12 / 16 / 20 / 24 / 32 / 40 / 48px。
> 2px 与 10px 为 48px 药丸内的**必要亚级**（48px 高内塞 4 区，8px 网格过粗），已在 Token 层收敛，**组件不得自由取数**。

### 5.2 圆角阶梯

| Token | 值 | 用途 |
|---|---|---|
| `--radius-chip` | 9999px | chips / 药丸内按钮 |
| `--radius-sm` | 8px | 输入框 / tooltip |
| `--radius-md` | 12px | 菜单 / 撤销条 |
| `--radius-lg` | 16px | 展开面板 / 对话框 |
| `--radius-pill` | 24px | 药丸（= 高度 / 2，真胶囊形态，**非过度圆角**） |

### 5.3 尺寸标注

固定置顶层 **384x360 DIP**（永不 resize）；药丸高 48px（紧凑 40px）；宽自适应 min 256 / typ 288 / max 360px；状态环 32px；热区 44x44；收起态命中 36x36（见 §8 偏差说明）；面板宽 300px。

### 5.4 容器策略

**这是桌面悬浮应用，不是 Web 页面——无响应式栅格、无断点、无 max-width 容器。**
- 唯一"容器"是固定 384x360 的透明置顶层。
- 药丸/圆点/面板均为该层内用 `transform` + `border-radius` 绘制的元素，形态间连续变形。
- 命中测试由应用层按"当前可见元素矩形"动态定义，其余区域 click-through。

---

## 6. Depth & Elevation（深度与阴影）

### 6.1 阴影阶梯

| Token | 值 | 用途 |
|---|---|---|
| `--elev-flat` | `none` | 平面 |
| `--elev-ring` | `0 0 0 1px rgba(255,255,255,0.08)` | 内描边环 |
| `--elev-raised` | `0 8px 24px rgba(0,0,0,0.44), 0 2px 6px rgba(0,0,0,0.32)` | 药丸默认 |
| `--elev-raised-hover` | `0 10px 28px rgba(0,0,0,0.50)` | 药丸 hover |
| `--elev-float` | `0 12px 32px rgba(0,0,0,0.50)` | 菜单 / 撤销条 |
| `--elev-panel` | `0 16px 40px rgba(0,0,0,0.52)` | 展开面板 |
| `--elev-drag` | `0 20px 48px rgba(0,0,0,0.60)` | 拖拽中 |

### 6.2 深色层次表达

**深色模式通过亮度递进表达层级，而非阴影。** L0 -> L4 是五个亮度台阶；阴影只用于"从桌面上浮起"这一个语义（药丸/面板/菜单相对桌面）。

### 6.3 z-index（单窗口内部堆叠）

`base 0 / pill 10 / panel 20 / settings 30 / undo 40 / tooltip 50 / menu 60 / dialog 70`。

### 6.4 模糊与毛玻璃：**明确拒绝**

**不使用 Mica / Acrylic / `backdrop-filter`。** 三条工程理由（刻意的设计决策，非偷懒）：
1. 48px 高小面积上做模糊，视觉收益趋近 0，但 GPU 采样成本固定存在；
2. 模糊会让文字对比度随壁纸**不可预测**，违反"深色底 + 高对比浅色文字"的 P0 要求；
3. "渐变 + 发光边框 + 毛玻璃"三位一体是 AI 模板的标志性套路，主动规避。
药丸改用 **96% 不透明实色底 + 1px 内描边 + 双层外阴影** 获得"实体感"。

---

## 7. Do's & Don'ts（设计守则）

### 7.1 应该做（Do）

1. 所有颜色/间距/圆角/时长一律 `var(--*)` 引用，零裸值。
2. 计时数字保持 `tabular-nums` + `min-width: 5ch` + `text-align: right`，RUNNING 下也用 `--fg`（15.5:1）。
3. 状态用**颜色 + 形状双通道**表达：RUNNING 琥珀实环，PAUSED 钢蓝虚线环，IDLE 中性灰。
4. 图标只用 Lucide，16/20/24px 三档，16px 时 `stroke-width: 2.5`。
5. 每屏强调色：药丸 <=1 处，面板 <=2 处。
6. 每个动效必须携带信息；同一时刻动画元素 <=3 个，RUNNING 稳态仅 2 个。
7. 空状态给引导文案而非空白（AC-18）。
8. `focus-visible` 永不被清除；`prefers-reduced-motion` 分支保留状态可辨性。

### 7.2 不应该做（Don't）

1. **禁止 emoji 作为功能图标**（含 `U+2713` 对勾 / `U+26A0` 警告 / `U+2714` / `U+274C` 等字符符号）——一律用 Lucide `check` / `circle-alert`。
2. **禁止紫 -> 粉渐变**（`#7C3AED` / `#A855F7` / `#9333EA` / `#EC4899` 任意组合）与"渐变 + 发光边框 + 毛玻璃"三位一体。
3. **禁止 `#6366F1` 靛蓝默认强调色**。本产品强调色为 Signal Amber `#E9A23B`。
4. **禁止 Mica / Acrylic / `backdrop-filter` 毛玻璃**（详见 §6.4）。
5. **禁止任何弹跳 / 弹性缓动**（`ease-back` / `spring` / `cubic-bezier(0.68,-0.55,0.265,1.55)` 等）与任何线性缓动（除进度/旋转）。
6. **禁止 3px 彩色左边框**强调卡片/列表项（用背景色区分）。
7. **禁止 `background-clip: text` 渐变文字**；**禁止"1px 边框 + 大于 16px 模糊阴影"同时出现**（幽灵卡片）。
8. **禁止 `outline: none` 清除焦点**；**禁止在组件 CSS 里写裸 hex/rgb（含 `#fff` / `#000`）**。
9. **禁止用红色表达"完成/结束"**——红色只属于"销毁数据"类动作；结束用绿色 `--success`。
10. **禁止空洞文案**（"Welcome to" / "Lorem ipsum" / "Sign up today"）；全部用具体中文动作与真实数据格式（`00:12:41` / `品牌视觉改版`）。
11. **禁止动画 `width / height / margin / padding / font-size / filter`**（形态变形为文档化例外，见 §6 与 `motion.rules.documentedException`）。

### 7.3 行业反模式（效率工具类）

- 表单化记录流程（Toggl 式多步）——本产品核心护城河是"右键 1 次结束"。
- 徽章/成就/打卡分享等游戏化——与个人时间记录价值无关。
- 番茄钟/专注屏蔽——属"专注工具"能力，非时间记录核心。

---

## 8. Responsive & Accessibility（响应式与无障碍）

### 8.1 响应式策略

**桌面固定形态，无断点。** 需要处理的是：
- **DPI**：全量 DIP，响应 `WM_DPICHANGED`，禁硬编码物理像素（150% 下 48 DIP -> 72 物理像素）。
- **多显示器**：记住所在显示器 + 相对右下角偏移（默认距右 16 / 距下 16 DIP）；显示器拔掉回落主屏。
- **窗口**：固定 384x360 永不 resize；命中区动态限定于可见元素矩形。

### 8.2 无障碍

- **对比度**：所有可读文字 >= 5.38:1；`--meta`（3.63:1）限定图标/分隔线/禁用文案。
- **键盘全路径**：`Tab` / `Shift+Tab` 在四个焦点站循环；`Space` 开始暂停；`Enter` 结束保存；`Esc` 取消面板（RUNNING 下不结束）；`Menu` / `Shift+F10` 开菜单；方向键在菜单/chips 间移动。
- **focus-visible**：`--focus-ring` 双环 7.88:1，不得清除。
- **prefers-reduced-motion**：关闭 tick/呼吸，用 3px 粗环 / 虚线环保留状态可辨性。
- **颜色不独占语义**：状态同时用颜色 + 图标/形状表达。

### 8.3 触摸 / 命中目标

- 药丸内热区 44x44px。
- **收起态命中区 36x36 的偏差说明（必须在 spec 标注）：** 主动小于 44px。理由：Timing 是**常驻置顶覆盖层**，44px 隐形命中区会遮挡底层应用 44x44 范围的点击——这在 Windows 上比"目标略小"严重得多（PowerToys 调研列为头号坑）。补偿：桌面鼠标下 36px 已舒适（Windows 官方小组件规范建议最小触控目标 32px 量级）；提供全局热键路径；悬停即出 tooltip。

### 8.4 5 态覆盖

每个有状态 UI 组件覆盖 **Loading / Empty / Error / Populated / Edge**（见 `pages/` 各文件"状态与交互"小节）。

---

## 9. Agent Implementation Guide（实现指南）

### 9.1 Tailwind config（如启用）

> 本项目形态高度定制（胶囊 + 动态命中 + 形态变形），Tailwind 仅用于 utility 辅助；**所有设计值仍以 `design-tokens.json` 为准**。

```js
// tailwind.config.js
export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg:        'var(--bg)',
        surface:   'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        'surface-4': 'var(--surface-4)',
        fg:        'var(--fg)',
        'fg-2':    'var(--fg-2)',
        muted:     'var(--muted)',
        meta:      'var(--meta)',
        border:    'var(--border)',
        'border-soft': 'var(--border-soft)',
        accent:    'var(--accent)',
        'accent-on': 'var(--accent-on)',
        'state-idle':    'var(--state-idle)',
        'state-running': 'var(--state-running)',
        'state-paused':  'var(--state-paused)',
        'state-ended':   'var(--state-ended)',
        success: 'var(--success)',
        warn:    'var(--warn)',
        danger:  'var(--danger)',
      },
      fontFamily: {
        ui:    ['"Geist Sans"', '"Noto Sans SC"', 'sans-serif'],
        mono:  ['"Geist Mono"', '"JetBrains Mono"', '"Cascadia Mono"', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', '12px'],
        xs:    ['11px', '16px'],
        sm:    ['12px', '18px'],
        base:  ['13px', '20px'],
        md:    ['14px', '22px'],
        lg:    ['16px', '24px'],
        timer: ['20px', '24px'],
      },
      fontWeight: { read: '400', emphasize: '510', announce: '590' },
      spacing: {
        1: '2px', 2: '4px', 3: '8px', 4: '10px', 5: '12px',
        6: '16px', 7: '20px', 8: '24px', 9: '32px', 10: '40px', 12: '48px',
      },
      borderRadius: { chip: '9999px', sm: '8px', md: '12px', lg: '16px', pill: '24px' },
      boxShadow: {
        ring:   'var(--elev-ring)',
        raised: 'var(--elev-raised)',
        float:  'var(--elev-float)',
        panel:  'var(--elev-panel)',
        drag:   'var(--elev-drag)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        exit:     'var(--ease-exit)',
        morph:    'var(--ease-morph)',
      },
      transitionDuration: {
        instant: '100ms', quick: '150ms', exit: '180ms',
        base: '200ms', morph: '280ms',
      },
      zIndex: { pill: '10', panel: '20', settings: '30', undo: '40', tooltip: '50', menu: '60', dialog: '70' },
    },
  },
};
```

### 9.2 CSS 变量定义

见同目录 `design-tokens.css`（`:root` 全量 + 降级分支 + `.timer-digits` 规则 + reduced-motion）。

### 9.3 TS import 示例

```ts
import tokens from './design-tokens.json';

// 颜色：语义层（组件只消费这一层）
const accent = tokens.color.semantic.accent.value;              // "#E9A23B"（经 primitive 别名解析）
const stateRunning = tokens.color.semantic.stateRunning.value;

// 尺寸 / 动效
const pillH = tokens.size.pillH.value;                          // "48px"
const morph = tokens.motion.duration.morph.value;               // "280ms"
const easeMorph = tokens.motion.easing.morph.value;             // "cubic-bezier(0.32, 0.72, 0, 1)"
```

> 别名形如 `"{color.primitive.brand.accent}"`。若构建链不含 DTCG 解析器，请在构建期做一次扁平化（把 `"{...}"` 解析为实际值），或直接消费 `design-tokens.css` 的 CSS 变量。

### 9.4 框架特定提示（Tauri 2 + React 19）

1. **形态变形在单窗口内完成**：窗口固定 384x360，永不 resize；药丸/圆点/面板用 `transform` + `border-radius` 绘制，命中测试由应用层按可见矩形动态定义。
2. **不允许 `backdrop-filter` / `filter: blur()`**：会破坏对比度可预测性与 GPU 预算。
3. **计时 tick 只 repaint 环所在 56x56 区域**，不做整窗 repaint（RUNNING 稳态 CPU < 0.3%）。
4. **事件订阅清理**：`listen()` 的 unlisten 必须在 `useEffect` 清理函数调用（防 WebView 重载后监听泄漏）。
5. **前端实时数字** = `accumulatedSec + (now - runningSince)`，基于 Rust 下发的 `startedAt` 本地推算，避免高频 IPC。

### 9.5 已知坑（Phase 3 前注入，源自 Spec §11）

| # | 坑 | 修法要点 |
|---|---|---|
| K-1 | 透明无边框窗口白闪 | `visible:false`，首帧完成后再 `show()` |
| K-2 | `data-tauri-drag-region` 不生效 | 放行 `core:window:allow-start-dragging` |
| K-5 | 关窗致进程退出、托盘失效 | 拦截 `CloseRequested` -> `hide()`，仅托盘退出调 `exit(0)` |
| K-6 | 多显示器 DPI 换算致位置漂移 | 存逻辑坐标需除 `scaleFactor`，恢复按 work_area 钳制 |
| K-8 | 事件订阅泄漏 | `useEffect` 清理函数调用 unlisten |
| K-11 | `invoke` 散落难维护 | 统一经 `src/services/ipc.ts`，集中错误码映射 |

### 9.6 提交前自查

```regex
[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}]
```
emoji 正则零命中；组件 CSS 无裸 hex/rgb；计时数字规则已实现；`focus-visible` 与 `prefers-reduced-motion` 分支已实现。

---

*文档结束 · Timing DESIGN.md · 颜好看 · 2026-10-16*
