# TickBar V0.2.0 设计规范（DESIGN-V0.2.0.md）

> 生成日期：2026-10-16 | 设计师：颜好看 | 阶段：V0.2.0-2 / V0.2.0-3
> 依据：`docs/CHANGE-PLAN-V0.2.0.md` §F + 参考项目 `Timing_v1.7.0/README/DESIGN/DESIGN-SYSTEM.md`（791 行，已实测落地）
> Token 源：`design-tokens-V0.2.0.json` + `design-tokens-V0.2.0.css`（三层：primitive → semantic → component）
> 三轴刻度：**Variance = 6 / Motion = 5 / Density = 8**（Density=8 驾驶舱模式：紧凑、靠 1px 线分隔，不用通用卡片盒子）
> 设计寄存器：**Product Register（产品型）** — 设计服务产品，标杆是「赢得熟悉感」
> 平台轴：**Windows 桌面（Tauri 2 + React 19 + WebView2）**，多窗口（小条置顶层 / 设置 / 事项 / 便利贴）
> 页面提示词：`docs/design/pages-V0.2.0/`（10 份）

---

## 0 · 怎么用这份稿 & 与 Timing 的对齐映射

### 0.1 阅读顺序

1. 先读本节 §0.2 对齐映射表 —— 搞清「哪些照搬 Timing、哪些因 Web 技术栈必须改写」。
2. 再读 §1–§9 —— 完整设计契约。
3. 实现时以 `design-tokens-V0.2.0.css` 的变量名为准；页面级差异见 `pages-V0.2.0/`。

### 0.2 与 Timing 设计系统的对齐映射表

> **原则**：**视觉与令牌 1:1 照搬，实现载体因技术栈改写**。Timing 是单进程 WinForms（GDI+ 自绘控件），TickBar 是 Tauri WebView（DOM + CSS）。凡是「控件怎么画」的差异，都归第二张表。

#### A. 直接搬（视觉 / 令牌 / 规格，1:1 照搬）

| # | Timing 出处 | 内容 | 落点 |
|---|---|---|---|
| 1 | §2.2 / §2.3 | 深/浅两套完整色值（浮层底 `#0E0F12`、面板 `#0E1015`、卡片 `#14161C`、输入 `#1B1E25`、hover `#232833`、ink 四档 …） | `design-tokens-V0.2.0.css` §1/§2 |
| 2 | §2.4 | 全部对比度实测数据（深 17.14 / 11.46 / 6.16 / 4.93；浅 17.76 / 9.13 / 5.86 / 4.64 …） | 同文件头部注释 + JSON `contrastAudit`（脚本 `_contrast_check.py` 复算一致；AC-53 后浅色 `ink-4` 由 4.34 → 4.64） |
| 3 | §2.5 | 字号阶梯 7 档（15 / 14 / 13 / 12.5 / 11.5 / 11 / 11.5-mono）+ 字重 650/600/500/400 | `typography.fontSize` |
| 4 | §2.6 | 间距 4·8·12·16·20·24·32 + 圆角 6/10/12/14/pill + 阴影 shadow-plate / shadow-pop / inset-hi | `space` / `radius` / `shadow` |
| 5 | §3.1 | 六档按钮语义（solid / accent / neutral / ghost / danger / icon） | §4.1 + `color.component.btn*` |
| 6 | §3.2 / §3.3 | 滑条（轨道 4 / 钮 14 / 数值胶囊 54×26）；开关 38×22 | §4.2 / §4.3 |
| 7 | §3.4 | 分段控件（槽 + gap 2 + 段高 28 + 选中底 + 顶部内高光） | §4.4 |
| 8 | §3.5 / §3.6 | 卡片行（`--card-pad-x` 14 / 行 `9px 0` + 底 1px 线）；取色行（色点 18 + hex 胶囊 + 箭头） | §4.5 / §4.6 |
| 9 | §3.7 | 滚动条 6px / 提示气泡（自绘，取代系统 ToolTip）/ 信息位等宽 11 | §4.7 |
| 10 | §4.1 | **小条几何**：高 34 / 圆角 h/2 / 色环 ⌀22 stroke 2.6 / 宽随事项伸缩 / 右内边距 7 / 柄盒 10 / 圆角括号柄 | §5.3 + `pages-V0.2.0/pill-bar.md` |
| 11 | §4.1.1 | **宽度机制 `BarW = BarBase + TaskW`，`TaskW ≤ 164`** | §5.3 |
| 12 | §4.2 | 便利贴：默认 320×232 / 圆角 12 / 去整窗 Opacity / 头 36 / 两个 26×26 图标按钮 / 正文下沉底 + 自绘滚动条 / 内联删除确认条 | `pages-V0.2.0/sticky-note.md` |
| 13 | §4.3 | 设置面板：392×660 / 50 标题栏 / 分段页签 / 卡片分组 / 58 底栏 / `neutral` 完成按钮 / 通用页「左标签右控件」三行 | `pages-V0.2.0/settings-panel.md` |
| 14 | §4.4 | 事项窗口：336 宽 / 表头主+副 / 四状态分层 / 待办区三级语气 / 40 底栏 / 图标空态 | `pages-V0.2.0/todos-panel.md` |
| 15 | §4.5 | 悬浮菜单（应用内）自绘玻璃 / 行高 30 / 状态块 / 条件项 | `pages-V0.2.0/context-menu.md` |
| 15b | §4.5 | 托盘菜单**保留系统原生菜单**，只重排信息架构（分组/分隔线/启用·禁用/勾选/标注） | `pages-V0.2.0/tray-menu.md` |
| 16 | §6.4 | `ColorDone` 默认 `#4CC38A`（「计时中」与「完成」不再同色） | `--color-done` 默认 `--ok` |
| 17 | 全局 | 图标 16px 描边型、零 emoji；`tabular-nums` 计时数字 | `icon` + `.timer-digits` |

#### B. 因技术栈需调整（WinForms → Tauri WebView）

| # | Timing（WinForms / GDI+） | TickBar V0.2.0（Tauri 2 + React 19 + CSS） | 原因 |
|---|---|---|---|
| 1 | `Design.cs` 静态色字段 + 过渡别名 | `design-tokens-V0.2.0.css` CSS 变量 + `design-tokens-V0.2.0.json` | Web 用 CSS 变量天然支持主题切换 |
| 2 | `TrackBar` → 自绘 `SliderRow`（C#，保留 `ValueChanged`） | HTML `<input type="range">` 自绘（`appearance:none`）或 React 受控组件 | DOM 原生控件可完全样式化 |
| 3 | `CheckBox` → 自绘 `ToggleSwitch`（保留 `Checked`） | React `<button role="switch" aria-checked>` | 语义化 + 键盘可达 |
| 4 | 三个独立页签按钮 → `SegmentedTabs`（自绘） | React 分段控件（`role="tablist"`） | 同上 |
| 5 | `SwatchRow`（色点 + hex 胶囊 + 箭头） | React 取色行组件 | 同上 |
| 6 | `IconButton 26×26`（自绘） | React `<button>` + lucide-react 图标 | 尺寸/形态规范不变 |
| 7 | `RoundedForm`：`Region` 圆角 + `CS_DROPSHADOW` | CSS `border-radius` + `box-shadow`（WebView2 原生支持） | 不再需要 1-bit 掩码，无锯齿 |
| 8 | `ThinScrollBar`（自绘 6px） | CSS `::-webkit-scrollbar` / `scrollbar-width: thin` | 浏览器原生可样式化 |
| 9 | `ContextMenuStrip` → `GlassMenu`（自绘，`HideGraceMs`） | React 自定义菜单 + `KeyboardEvent` ↑↓ / Enter / Esc / Home / End | 需要自建键盘导航（Timing 迁自绘后也无原生键盘路径，见其 §8-9） |
| 10 | 系统 `ToolTip` → `HoverTip` | HTML/CSS tooltip 组件 | — |
| 11 | `Form.Opacity = 0.94`（整窗） | 只对**背景板**用 alpha（`color-mix`），文字/描边保持不透明 | 整窗透明会统一降对比度 |
| 12 | `S(float)` DPI 换算，禁裸像素 | 全 DIP（CSS px）+ Tauri 处理缩放；禁写物理像素 | 平台机制不同 |
| 13 | 单窗体（设置/事项是同一窗内的绘制）| **多窗口**：小条置顶层 / 设置 / 事项 / 便利贴各自独立 `WebviewWindow` | 注意 见 §9.5 + 冲突项 |
| 14 | 托盘图标 `.ico`（Rust 提供） | 不变（Rust 侧 `.ico` 16/20/24/32） | OS 原生资源 |
| 15 | **托盘菜单**：`ContextMenuStrip` → 自绘 `GlassMenu` | **保留系统原生 Win32 菜单（不自绘）**；只对齐**信息架构**（分组/分隔线/启用·禁用/勾选/快捷键标注）。原生外观由系统决定 | 已裁定，见 §9.5 冲突项 #2（已闭环） |

> **落地不变的红线**（Timing §5.3 同款）：Tokens 必须覆盖所有颜色/间距/圆角/时长；文字对比度 ≥4.5:1；`context-menu` 键盘可达（托盘菜单为系统原生，键盘由 OS 提供）；四状态在**灰度打印**下仍可区分。

---

## 1 · Visual Theme & Atmosphere（视觉主题与氛围）

**设计方向：Ambient Instrument（在场景中的仪表）**

不是「一个计时器 App」，而是「桌面上一个随时在读数、且读起来不费力的仪表」。对标 Timing 的「克制的深色玻璃 + 单一蓝色信号 + 精确等宽数字」。

**三个声音词（Voice Words）：**
- **Legible-first（可读优先）** — V0.2.0 最硬的一条：浮层文字一律用不透明 ink 令牌（深色下最低 `#7A8292` = 4.93:1），**禁止**半透明白字压在未知壁纸上（Timing §1 诊断的第 11 条硬伤）。
- **Instrumented（仪表感）** — 色环 + 等宽数字 + 1px 线；信息靠层次说话，不靠装饰。
- **Quiet-but-present（安静但在场）** — 半透明玻璃底（94%/74%）让它浮在壁纸上而不遮挡；静止时几乎隐形，运行时色环轻轻说话。

**氛围描述：** 深色玻璃浮层 + 四档中性 ink + 一枚 Accent Blue 信号环。同屏的 IDE / 浏览器 / 通讯工具之上，它是「最安静但最容易被找到」的那 3 平方厘米。浅色主题为白天 / 亮壁纸场景，用加深后的同色相蓝 `#1669AD` 保持可读。

**对标品牌：**
- 主对标 **Timing v1.7.0**（本项目的直接来源，深色玻璃 + 蓝信号 + 等宽数字）
- 辅助 **Raycast**（近黑底 + 极低饱和中性层次 + 单一强调色）/ **Linear**（排版纪律）/ **Apple HIG**（形态连续性）

**明确不对标：** Toggl Track（表单化、多步）/ Sunsama（规划过载）/ Notion（无限嵌套）。它们是「要打开的应用」；TickBar 是「一直在那里的状态」。

**与 V0.1.0 的三处气质变更（有意为之）：**
1. 主色 Signal Amber `#E9A23B` → **Accent Blue `#4DA3E8`**（对齐 Timing）。
2. 恒定深色 → **深/浅双主题**。
3. 抛弃运行光晕（radial-gradient halo）—— Timing 的小条不发光，状态由**色环颜色 + 数字**承载。这也顺带彻底规避了「渐变 + 发光 + 毛玻璃」三位一体的 AI 模板套路。

---

## 2 · Color Palette & Roles（色彩与角色）

### 2.1 分层原则（Timing §2.1 原样沿用）

```
用户可配的『小条底色』(--color-bar)  →  只管「小条 / 浮层」
    小条悬停板 / 便利贴 / 提醒框 / 倒计时卡 / 自绘菜单

固定的灰阶令牌                        →  只管「常驻窗口」
    --bg-panel / --bg-card / --bg-field / --bg-field-hi / --bg-seg
```

这条线保证「用户改小条底色」不会污染设置面板的灰阶体系。

### 2.2 深色主题（A1-identity）

| 角色 | Token | 值 | 用途 |
|---|---|---|---|
| 浮层底（＝小条底色） | `--bg-plate` | `#0E0F12` | 浮层底 / 小条（**用户可配 `--color-bar`**） |
| 浮层下沉区 | `--bg-inset` | `#1B1E25` | 便利贴正文编辑区 |
| 面板外壳 | `--bg-panel` | `#0E1015` | 设置 / 事项窗口 |
| 分组卡片 | `--bg-card` | `#14161C` | 卡片 |
| 控件底 | `--bg-field` | `#1B1E25` | 输入框 / 滑条胶囊 |
| 控件 hover | `--bg-field-hi` | `#232833` | hover / `neutral` 按钮底 |
| 分段槽 / 选中段 | `--bg-seg` / `--bg-seg-on` | `#171A21` / `#262B36` | 分段控件 |
| 描边三档 | `--line` / `--line-2` / `--line-3` | `rgba(255,255,255,.06/.10/.16)` | 分隔线 / 控件描边 / hover 描边 |
| 前景四档 | `--ink` / `--ink-2` / `--ink-3` / `--ink-4` | `#F2F3F5` / `#C9CED8` / `#8B93A2` / `#7A8292` | 正文 / 次级 / 三级 / 四级 |
| 强调（计时中） | `--accent` | `#4DA3E8` | **用户可配 `--color-running`** |
| 强调前景 | `--accent-ink` | `#8FC6F5` | 链接 / 强调底上文字 |
| 强调底 / 描边 | `--accent-wash` / `--accent-line` | 14% / 32% 蓝 | 当前行底 / accent 按钮 |
| 提醒 | `--warn` | `#E8A33D` | **用户可配 `--color-warn`** |
| 危险 | `--danger` | `#E5484D` | 破坏性动作 |
| 完成 | `--ok` | `#4CC38A` | **用户可配 `--color-done`** |
| danger 实心底 | `--danger-solid` | `#E1292F` | 白字 4.61:1（AC-53：`#E5484D` 作实心底白字仅 3.91）|

### 2.3 浅色主题（A1-identity）

| 角色 | Token | 值 | 备注 |
|---|---|---|---|
| 浮层底 | `--bg-plate` | `#F2F3F5` | 浅色小条底色默认 |
| 面板 / 下沉区 | `--bg-panel` / `--bg-inset` | `#FFFFFF` | |
| 卡片 | `--bg-card` | `#F7F8FA` | |
| 控件底 / hover | `--bg-field` / `--bg-field-hi` | `#F1F3F7` / `#E6E9EF` | |
| 描边三档 | `--line` / `--line-2` / `--line-3` | `rgba(16,20,28,.07/.12/.18)` | |
| 前景四档 | `--ink` / `--ink-2` / `--ink-3` / `--ink-4` | `#16181D` / `#41485A` / `#5C6577` / `#656E7D` | `ink-4` 对 plate 4.64:1（**可作正文小字**） |
| 强调（非文本） | `--accent` | `#1669AD` | **由计时中色经 `DeepenForNonText` 派生**（Timing 落地订正 D-1） |
| 强调（文字 / 链接） | `--accent-ink` | `#1F63AA` | 5.77:1 on card |
| 提醒 | `--warn` | `#A05E00` | 由 `#E8A33D` 保色相（H=35）加深至**对 plate 4.62:1**（文字/非文本通用） |
| 危险 | `--danger` | `#D02C33` | 保色相（H=358）加深至**对 plate 4.62:1** |
| 完成 | `--ok` | `#0C7E47` | 由 `#4CC38A` 保色相（H=151）加深至**对 plate 4.62:1** |
| danger 实心底 | `--danger-solid` | `#D02C33` | 白字 5.13:1（＝浅色 `--danger`）|

> **AC-53 生效说明**：浅色语义色原先仅按「卡面 4.50:1」标定，但实际文字会落在比 `--bg-card` 更暗的 `--bg-plate #F2F3F5`（小条 / 浮层底）上，复算只有 4.31–4.34:1，未过 AA。现按**最坏底 `--bg-plate`** 重新标定：`ink-4` 与 `warn/danger/ok` 均保色相（H 不变、仅降亮度）加深至对 plate ≥4.5:1。因只动亮度、不动色相，非文本用法（描边 / 色点 / 进度）观感几乎不变，且仍远超其 3:1 阈值。

> 注意 **浅色强调色不是硬编码**：`--accent` 浅色值 = `DeepenForNonText(ColorRunning, --bg-panel, 3.0)`（保色相、按 0.05 步进加深至 ≥3:1）。用户改「计时中」颜色时，浅色主题自动重算。默认落 `#1669AD`。

### 2.4 B-slot 别名（组件只引用这些）

`--pill-bg` `--pill-border-in` `--pill-grip-ink` · `--menu-bg` `--menu-item-hover` `--menu-text` `--menu-danger` `--menu-group-label` · `--input-bg` `--input-border` `--input-placeholder` · `--btn-accent-bg/ink/line` `--btn-neutral-bg/ink` `--btn-ghost-ink` `--btn-danger-bg` `--btn-solid-bg/ink` `--btn-icon-ink` · `--card-bg` `--card-line` · `--todo-row-current` `--todo-bar-current` `--todo-name-done` `--todo-overdue` `--todo-no-time` · `--note-body-bg` `--note-foot-ink` · `--focus-ring`

### 2.5 C-extension（本项目专属）

- `--glass-panel-bg` `color-mix(#0E0F12 94%, transparent)` — 浮层/菜单玻璃底（**有明确功能目的**，见 §6.4）
- `--glass-hover-bg` `color-mix(#0E0F12 74%, transparent)` — 小条悬停板玻璃底
- `--inset-highlight` `inset 0 1px 0 rgba(255,255,255,.06)` — 选中段/悬停板顶部内高光
- `--ring-track` `rgba(255,255,255,.20)` — 色环未填充轨道

### 2.6 每屏强调色使用量（Density=8 硬约束）

- **小条内 ≤ 1 处**（色环算 1 处；数字用 `--ink` 不变色）
- **面板 / 窗口内 ≤ 2 处**（如：当前行竖条 + 主按钮）
- 其余全部中性色。这是防「AI 彩虹屁设计」的核心闸门。

### 2.7 配色来源

自建双主题中性阶 + Timing 语义色。**主动规避** Tailwind 默认 `#6366F1` 靛蓝与紫→粉渐变（P0-2）。强调色 Accent Blue `#4DA3E8` 为 Timing 品牌色，深浅双主题各自满足 AA —— 实测数据见 `_contrast_check.py` 与 JSON `contrastAudit`。

---

## 3 · Typography（排版）

### 3.1 字体栈（对齐 Timing：改用 Microsoft YaHei UI）

```css
--font-ui:      "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", system-ui, -apple-system, sans-serif;
--font-display: var(--font-ui);    /* 标题复用界面字体，靠字重/字号拉层级 */
--font-mono:    "Cascadia Mono", "Consolas", "SFMono-Regular", "Segoe UI Mono", ui-monospace, monospace;
```

- **英文界面字体全部为系统字体**（Microsoft YaHei UI 为 Windows 中文界面标准），零 Google Fonts CDN 依赖 —— 悬浮工具断网时必须是完整体验。
- **等宽数字用系统 mono fallback 链**（Cascadia Mono → Consolas → …），保证 `tabular-nums` 在任意 Windows 机器上可用。
- 数字场景统一加 `font-variant-numeric: tabular-nums` + `font-feature-settings: "tnum" 1, "zero" 1`。

### 3.2 字号阶梯（对齐 Timing §2.5，7 档）

| Token | 字号 / 行高 | 字重 | 用途 |
|---|---|---|---|
| `--text-title` | 15px / 1.3 | 650 | 设置 / 事项窗口标题 |
| `--text-num` | 14px / 1.0 | 650 | 小条时间（`tabular-nums`） |
| `--text-body` | 13px / 1.6 | 400 / 500 / 600 | 正文 / 控件文本 / 编辑区 / 任务名 |
| `--text-sm` | 12.5px / 1.45 | 400 / 500 | 按钮 / 页签 / 取值 |
| `--text-xs` | 11.5px / 1.5 | 400 | 说明 / 页脚 / 插件描述 |
| `--text-cap` | 11px / 1.4 | 600 | 分组小标题（`letter-spacing: 0.08em`） |
| `--text-mono` | 11.5px / 1.4 | 400 | hex 值 / 版本号 / 信息位 |

> 12.5 / 11.5 为**半像素档**（Timing 原值，48px 内紧凑寄存器需要）。已在 Token 层收敛，组件不得自由取数。

### 3.3 字重三级 + 强档（含 YaHei UI 落地映射 注意）

| 级别 | 值 | 用途 |
|---|---|---|
| Read | 400 | 正文 / 说明 |
| Medium | 500 | 控件文本 / 任务名（**中文回落 400**） |
| Semibold | 600 | 分组标题 / 已完成行名（**中文回落 700**） |
| Strong | 650 | 标题 / 时间数字（**中文回落 700；数字走 mono 拉丁字面**） |

> **Windows 字体落地裁定（架构 §6.f 已定）**：`Microsoft YaHei UI` 仅 **300 / 400 / 700** 三字面，无 500/600/650。
> - **中文层级只用 {400, 700}** —— 层级改由**字号 + 颜色（`--ink*`）+ 字距**承载（Density=8 的做法）。
> - **禁伪粗体**：`html { font-synthesis-weight: none }` —— 缺字面时不做合成加粗（避免糊）。
> - **计时数字走 `--font-mono` 拉丁字面**：数字能吃到完整字重档，不受中文字面限制（`--weight-strong` 650 可如实生效）。
> - **MVP 不内联 CJK 字体**（避免 +10~20MB）。Spec 阶段按 WebView2 实测锁定每个层级的最终组合。
> - CSS 内 `--weight-medium: 500` / `--weight-semibold: 600` / `--weight-strong: 650` 保留为**语义意图**；中文类元素声明处回落 400/700。

### 3.4 字距

- 分组小标题 / ALL CAPS **统一 `letter-spacing: 0.08em`**（11px）。
- 中文**永不**加字距（一加立刻显得廉价）。
- 15px 标题负字距 `-0.01em`。

### 3.5 计时数字硬规范（不可协商）

```css
.timer-digits {
  font-family: var(--font-mono);
  font-size: var(--text-num);            /* 14px */
  font-weight: var(--weight-strong);     /* 650；等宽数字不要 700+，会糊 */
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "zero" 1;
  letter-spacing: 0;
  min-width: 53px;                       /* MM:SS 定宽（对齐 Timing TimeW 53）*/
  text-align: right;                     /* 右对齐 + 定宽 = 数字原地变化 */
  white-space: nowrap;
  color: var(--ink);
}
.timer-digits[data-hours="true"] { min-width: 72px; }   /* HH:MM:SS */
```

**格式切换（契约锁定）：** `<1h` → `MM:SS`（`min-width 53px`）；`>=1h` → `HH:MM:SS`（`min-width 72px`）；上限 `99:59:59`。实现于 `format.ts`，与 Token 的 `typography.timerDigits` 一一对应。

**状态口径：** 计时状态机 `idle | running | paused`；倒计时为 `running` 的子模式（`mode: countup | countdown` + `target_sec`）。「ENDED」仍是 **900ms 瞬时视觉确认**（`--ok` 色 + `--dur-confirm`），不是第四状态。

---

## 4 · Components（组件规范）

### 4.1 按钮（六档，语义唯一 — Timing §3.1）

| 变体 | 底 | 字 | 描边 | 用在哪 |
|---|---|---|---|---|
| `solid` | `--solid-bg` | `--solid-ink` | 无 | 最高优先级动作（仅确认型对话框） |
| `accent` | `--accent-wash` | `--accent-ink` | `--accent-line` | 主动作（开始计时 / 保存 / 新增待办） |
| `neutral` | `--bg-field-hi` | `--ink` | 无 | 常规终结动作（设置面板「完成」，13.29:1） |
| `ghost` | 透明 | `--ink-3` → hover `--ink` | `--line-2` | 次要动作（打开目录 / 取消） |
| `danger` | `--danger` | `#FFFFFF` | 无 | 确认删除 |
| `icon` | 透明 | `--ink-3` | 无 | 标题栏图标按钮（删除 / 关闭 / 收起） |

尺寸：`md` 高 28 / `padding 0 12` / 字 12.5·500；`sm` 高 24 / `padding 0 9` / 字 12。图标按钮统一 **26×26**，`--radius-sm`；危险场景 hover = `--danger-wash` 底 + `--danger` 字。

> 禁止 **不要把品牌蓝做「实心主按钮」**：实测 `--ink #F2F3F5` on `#4DA3E8` 只有 **2.45:1**。要蓝色主按钮，用 `accent` tint 档（8.57:1）。
> 注意 `neutral` ≠ `solid`：`solid` 语义是「整个窗口只有它最重要」（如单确定/取消对话框）；设置面板是长表单，底栏只是收尾 → 用 `neutral`。

### 4.2 滑条（自绘，取代 `TrackBar`）

轨道高 4、`--radius-full`、底 `--track`；已填充段 `--accent`；钮 14px 白圆 + `0 1px 4px rgba(0,0,0,.5)` + 1px 内描边 + 6px `--accent-wash` 光环。数值显示 54×26 等宽胶囊（`--bg-field` + `--line` + `--radius-sm`）。**取消刻度线**。

### 4.3 开关（自绘，取代 `CheckBox`）

38×22，槽 `--track`；开 = `--accent`；钮 18px 白圆；`left 2px → 18px`，`--dur-exit` 180ms。React `<button role="switch" aria-checked>`。

### 4.4 分段控件（取代三个独立页签）

外槽 `--bg-seg` + 1px `--line` + `--radius-md` + `padding 3` + `gap 2`；段等宽、高 28、`radius 7`、字 12.5·500、`--ink-3`；选中段 `--bg-seg-on` 底 + `--ink` 字 + `0 1px 2px rgba(0,0,0,.35)` + 顶部内高光。

### 4.5 卡片与行

卡片 `--bg-card` + 1px `--line` + `--radius-lg` + 左右 `padding 14`；行 `padding 9px 0` + 底 1px `--line`（末行无）；行内布局「标签左 `--text-body · --ink` + 弹性空白 + 控件右」。

> Density=8：**窗口内优先用 1px 线 + 间距分组，不用通用卡片盒子**。仅设置面板的分组用卡片；事项窗口的清单直接用 `divide-y` 式 1px 线。

### 4.6 取色行（取代色块按钮）

`[色点 18×18 r-sm]` `[名称 13·--ink]` `[弹性空白]` `[hex 胶囊]` `[箭头 11·--ink-4]`。色点自带 `inset 0 0 0 1px rgba(255,255,255,.20)` 保证纯黑/纯白有边界。hex 胶囊等宽 11.5、`--bg-field`、`--line`、高 26、`padding 0 10`。

### 4.7 徽标 / 滚动条 / 提示气泡

- **徽标** `height 20 / padding 0 8 / --radius-full / 字 11·500 / --accent-wash 底 + --accent-ink 字 + --accent-line 描边 + 5px 同色圆点`。
- **滚动条** 宽 6（面板滚动区 8，含 2px 透明边距）、thumb `--radius-full`、`--line-3`、无箭头、无轨道底。
- **提示气泡** `--bg-field` + 1px `--line-2` + `--radius-md` + `padding 6 10` + 字 12 + `--shadow-pop`；键位用内嵌 kbd（`--kbd-bg` 底 + `--line-2` 描边 + `--radius-sm`）。**取代系统 ToolTip**。
- **信息位** 菜单右侧短信息（条数/日期/键位）统一等宽 11 · `--ink-4`。

### 4.8 图标（lucide-react，唯一）

- 尺寸 16px（行内）/ 20px（按钮内）/ 24px（独立）。
- 描边：16px → `stroke-width 2.5`；20/24px → `2`（保证线重一致）。
- **零 emoji**，禁用 `U+2713 / U+2714 / U+26A0 / U+274C` 等字符符号。
- 系统托盘图标为由 Rust 侧 `.ico`（16/20/24/32）提供的 OS 原生资源，前端不绘制（这不违反「应用内图标必须 lucide」）。

### 4.9 组件状态矩阵（9 态覆盖）

| 组件 | Default | Hover | Focus | Active | Disabled | Loading | Error | Empty | Success |
|---|---|---|---|---|---|---|---|---|---|
| Pill | O | O | O | O | N/A | O | O | O | O |
| RingButton | O | O | O | O | N/A | O | O | O | O |
| ItemInput | O | O | O | O | O | N/A | O | O | O |
| TodoRow | O | O | O | O | N/A | N/A | N/A | O | O |
| MenuItem | O | O | O | O | O | N/A | N/A | N/A | N/A |
| SegmentedTab | O | O | O | O | O | N/A | N/A | N/A | N/A |
| StickyNote | O | O | O | O | N/A | O | O | O | N/A |
| ThemePicker | O | O | O | O | N/A | N/A | N/A | N/A | N/A |
| Reminder | O | O | O | O | N/A | N/A | O | N/A | O |

---

## 5 · Layout & Spacing（布局与间距）

### 5.1 间距（4px 网格）

`--space-1..7` = 4 / 8 / 12 / 16 / 20 / 24 / 32。
语义档：`--row-pad-y` 9 / `--card-pad-x` 14 / `--panel-pad` 16 / `--menu-pad` 6。

### 5.2 圆角阶梯

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 6 | 按钮 / 输入框 / 图标按钮 / 色点 |
| `--radius-md` | 10 | 分段控件 / 主题卡 / 提示气泡 |
| `--radius-lg` | 12 | 卡片 / 便利贴 / 菜单 |
| `--radius-xl` | 14 | 设置面板外壳 |
| `--radius-pill` | `calc(--pill-h/2)` = 17 | 小条（真胶囊） |

> 卡片圆角上限 12–14px（**禁止 ≥24px 的过度圆滑**）。

### 5.3 药丸条新几何（对齐 Timing §4.1）

| 项 | V0.1.0 | **V0.2.0** |
|---|---|---|
| 高 | 48 | **34**（`--pill-h`） |
| 圆角 | 24 | **`calc(--pill-h/2)` = 17（真胶囊）** |
| 色环 | ⌀32 stroke 2 | **⌀22（`--ring-size`）stroke 2.6（`--ring-stroke`）** |
| 色环轨道 | 无 | `--ring-track` `rgba(255,255,255,.20)`（浅色 `rgba(16,20,28,.16)`） |
| 宽 | 自适应 256–360 | **随事项名伸缩 116–288**（见下） |
| 内边距 | 上下 2 / 左右 2 | **`0 7 0 8`**（左 8 / 右 7，右端放柄故更紧） |
| 内部 gap | 12 / 10 | **8**（环↔时间、时间↔事项名） |
| 时间列 | `min-width 5ch` | **`min-width 53px`**（对齐 Timing TimeW 53） |
| 事项名 | 截断 11 中文 | `flex: 0 1 auto; max-width: 164px` + 省略号 |
| 抓取柄 | `chevron-right` 20px | **圆角括号 `）`**（`viewBox 12×22`、`stroke 2.2`、路径 `M5.6 3.6 C9 6.6, 9 15.4, 5.6 18.4`），**仅 hover 显示** |
| 柄盒 | 44 热区 | 格宽 10 / 命中 10 / SVG 12×22（格内居中，左右各溢 1px） |
| 空闲投影 | 三趟盒式模糊 | **两层贴边硬影** `--shadow-balloon` |
| 运行光晕 | `--accent-halo` 呼吸 | **删除**（Timing 小条不发光；用色环颜色承载状态） |

**宽度机制（不做定宽）：**

```
BarW = BarBase + TaskW
  BarBase = padL 8 + ring 22 + gap 8 + time 53 + gap 8 + grip 10 + padR 7 = 116
  TaskW  <= MaxTaskW = 164         （超出 → 省略号）
  ⇒ 极短事项 ≈ 116 / 常规 ≈ 200 / 到上限 ≈ 280（硬上限 --pill-w-max 288）
```

CSS：`.bar { width: auto } .bar .task { flex: 0 1 auto; max-width: var(--task-w-max) }` —— **禁止按定宽画**。

> 抓取柄形态与右缘收边沿用 Timing：`M5.6 3.6 C9 6.6, 9 15.4, 5.6 18.4`（单条三次贝塞尔，形如 `）`），颜色 `--pill-grip-ink`（深 74% 白 / 浅 55% 黑），hover 才从 `opacity 0 → 1`（`--dur-exit`）。

### 5.4 尺寸标注

| 窗口 / 元素 | 尺寸 |
|---|---|
| 小条置顶层 | 384×360 DIP（透明，永不 resize；容纳悬停板 / 菜单） |
| 小条 | 高 34 / 宽 116–288 |
| 设置面板 | 392×660（标题 50 / 页签 48 / 底栏 58 / 内容区 504） |
| 事项窗口 | 宽 336（高自适应；表头 32 / 行 26 / 待办行 24（上限 8）/ 底栏 40） |
| 便利贴 | 320×232（头 36 / 正文最小 112 / 页脚 34）；缩放硬钳制 160×120 – 900×900 且受 `work_area` 收窄（舒适上限 640×480 软提示） |
| 悬浮菜单 | min-width 184 |
| 托盘菜单 | 系统原生自算（不自绘，无固定尺寸；`--tray-w` 退役） |
| 命中区 | 常规 44；图标按钮 26；收起态 36 |

### 5.5 容器策略

**桌面悬浮应用，非 Web 页面 —— 无响应式栅格、无断点、无 max-width 容器。**
- 「容器」是各窗口 / 浮层本身；元素用 `transform` + `border-radius` 绘制，形态间连续变形。
- 全量 DIP，响应 DPI 变化；禁硬编码物理像素。
- 命中测试按「当前可见元素矩形」动态定义，其余区域 click-through。

---

## 6 · Depth & Elevation（深度与阴影）

### 6.1 阴影阶梯

| Token | 值 | 用途 |
|---|---|---|
| `--shadow-flat` | `none` | 平面 |
| `--shadow-ring` | `0 0 0 1px var(--line-2)` | 内描边环 |
| `--shadow-pop` | `0 12px 32px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.35)` | 悬停板 / 提示气泡 |
| `--shadow-plate` | `0 18px 48px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.40)` | 便利贴 / 浮层 |
| `--shadow-float` | `0 12px 32px rgba(0,0,0,.45)` | 菜单 |
| `--shadow-panel` | `0 16px 40px rgba(0,0,0,.52)` | 常驻窗口 |
| `--shadow-balloon` | `0 1px 2px rgba(0,0,0,.72), 0 0 1px rgba(0,0,0,.90)` | 小条空闲态贴边硬影 |
| `--inset-top` | `inset 0 1px 0 rgba(255,255,255,.06)` | 选中段顶部内高光 |

> 浅色主题的阴影整体降为「弱、偏中性」版本（见 CSS §2），避免在亮底上炸出黑块。

### 6.2 深色层次表达

**深色靠亮度递进表达层级，不靠阴影**：`#0E0F12 → #0E1015 → #14161C → #1B1E25 → #232833`。阴影只用于「从桌面上浮起」一个语义（小条 / 面板 / 菜单相对桌面）。

### 6.3 z-index

`base 0 / pill 10 / panel 20 / note 20 / settings 30 / undo 40 / tooltip 50 / menu 60 / dialog 70`。

### 6.4 玻璃（backdrop-filter）：**「板式拟玻璃」—— 有条件采用（架构 §6.g 已裁定）**

结论：**反转无坑，前提是「板式拟玻璃」**。核实确认 `backdrop-filter` **只作用于 WebView 内部层级、不穿透 OS 窗口管理器**（不碰 OS Acrylic/Mica），因此：

1. **板式拟玻璃 = 高不透明度板（菜单 `94%` / 便利贴 `97%`）+ 文字 100% 不透明**。可读性由此**静态保证**（这正是 Timing §1 第 11 条硬伤的解），且无平台降级 / 拖拽抖动。
2. **默认不启用 OS 效果**（不加 `set_effects(Acrylic)`）；若将来真要桌面透过模糊，须 `set_effects(Acrylic)`——Win11 22H2+，标 **K-27**。
3. **主小条（pill窗口）禁挂任何模糊** —— 含悬停板一律用**高不透明度板（无 `backdrop-filter`）**，保拖拽顺滑。`--pill-hover-plate` 已是「94% 板、无模糊」。
4. **与 K-1 白闪无因果** —— 白闪是 WebView2 预绘制默认底色；模糊层只略抬高首帧合成成本，仍守 `visible:false` 握手。

**玻璃使用范围：** 应用内菜单（`context-menu` / `countdown-menu` / `common-items`）· 便利贴 · 事项窗口 · 提醒卡。**主小条除外；系统托盘菜单除外**（托盘菜单为原生 Win32 菜单，不经 WebView，无玻璃一说）。
**仍禁止：** 装饰性模糊铺满大面板 · `filter: blur()` 用在文字/整窗 · 渐变 + 发光边框 + 毛玻璃三位一体。

---

## 7 · Do's & Don'ts（设计守则）

### 7.1 应该做（Do）

1. 所有颜色/间距/圆角/时长一律 `var(--*)` 引用，零裸值。
2. **浮层文字一律用不透明 ink 令牌**（浅色 `--ink-4` 对 plate 4.64:1、深色 `--ink-4` 对 field 4.32:1）；只在背景板上保留 alpha。
3. 计时数字保持 `tabular-nums` + `min-width 53px` + `text-align: right`，RUNNING 下也用 `--ink`。
4. 状态用**颜色 + 形状双通道**：进行中 `--accent` 实环，暂停虚线环，待机中性环。
5. 图标只用 lucide-react，16/20/24px 三档，16px 时 `stroke-width 2.5`。
6. 每屏强调色：小条 ≤1 处，面板 ≤2 处。
7. 深色靠亮度递进分层次；窗口内优先 1px 线分组，而非堆卡片。
8. `focus-visible` 永不被清除；`prefers-reduced-motion` 分支保留状态可辨性。
9. 空状态给图标 + 文案 + 操作按钮（不给空白）。

### 7.2 不应该做（Don't）

1. **禁止 emoji / 字符符号作功能图标**（`U+2713` `U+26A0` `U+2714` `U+274C` 等）→ 用 lucide `check` / `circle-alert`。
2. **禁止紫 → 粉渐变**（`#7C3AED` / `#A855F7` / `#9333EA` / `#EC4899` 任意组合）与「渐变 + 发光边框 + 毛玻璃」三位一体。
3. **禁止 `#6366F1` 靛蓝默认强调色**。本项目强调色为 Accent Blue `#4DA3E8`。
4. **禁止装饰性毛玻璃**（铺满大面板的模糊）；浮层玻璃须按 §6.4 三条功能约束使用。
5. **禁止任何弹跳 / 弹性缓动**（`ease-back` / `spring` / `cubic-bezier(0.68,-0.55,0.265,1.55)`）与线性缓动（除进度/旋转）。
6. **禁止 3px 彩色左边框**强调卡片/列表项（用 `--accent-wash` 底 + 竖条组合，或用描边色区分）。
7. **禁止 `background-clip: text` 渐变文字**；**禁止「1px 边框 + ≥16px 模糊阴影」同时出现**（幽灵卡片）。
8. **禁止 `outline: none` 清除焦点**；**禁止在组件 CSS 写裸 hex/rgb（含 `#fff`/`#000`）**。
9. **禁止用红色表达「完成/结束」**——红只属于「销毁数据」类动作；结束用 `--ok`。
10. **禁止空洞文案**（"Welcome to" / "Lorem ipsum" / "Sign up today"）；全部用具体中文动作与真实数据格式（`00:12:41` / `品牌视觉改版`）。
11. **禁止动画 `width/height/margin/padding/font-size/filter`**（形态变形为文档化例外）。

### 7.3 行业反模式（效率 / 时间记录工具）

- 表单化记录流程（Toggl 式多步）——核心护城河是「右键 1 次结束」。
- 徽章/成就/打卡分享等游戏化——与个人时间记录价值无关。
- 番茄钟/专注屏蔽——属「专注工具」能力，非本产品核心。
- 「一半是灰的」长菜单——托盘菜单**按状态裁剪（方案 Ⅰ 定案，不可用项不生成）**（见 `tray-menu.md` §3.1）。

---

## 8 · Responsive & Accessibility（响应式与无障碍）

### 8.1 响应式策略

**桌面固定形态，无断点。** 需要处理：
- **DPI**：全量 DIP，响应 DPI 变化，禁硬编码物理像素。
- **多显示器**：记住所在显示器 + 相对右下角偏移（默认距右/下 `--snap-margin` 16 DIP）；显示器拔掉回落主屏。
- **多窗口**：便利贴 / 事项 / 设置各自独立窗口；位置持久化（见架构文档）。

### 8.2 无障碍

- **对比度**：正文 / `ink-2` / `ink-3` / `ink-4` ≥ 4.5:1（**AC-53：浅色 `ink-4` 已由 `#707A8A`(对 plate 3.91) 提升至 `#656E7D`(对 plate 4.64)，可作正文小字，不再限大字**）；语义色作文字 ≥4.5:1——浅色 `warn/danger/ok` 已加深至对 `--bg-plate` 4.62:1（深/浅两套实测见 §2 与 JSON `contrastAudit`）。**注意**：「danger **实心底** + 白字」双主题均须用 `--danger-solid`（深 `#E1292F` 4.61 / 浅 `#D02C33` 5.13），不得用 `--danger` 当实心底（深色白字仅 3.91，AC-53）。
- **键盘全路径**：`Tab` / `Shift+Tab` 循环；`Space` 开始暂停；`Enter` 结束保存；`Esc` 取消面板（RUNNING 下不结束）；`Menu` / `Shift+F10` 开菜单；菜单内 `↑↓ / Home / End / Enter / Esc`。
- **focus-visible**：双环 `--focus-ring`（2px 间隙 + 2px 强调环），不得清除。
- **prefers-reduced-motion**：关闭 tick/呼吸，用 3px 粗环 / 虚线环保留状态可辨性。
- **颜色不独占语义**：状态同时用颜色 + 图标/形状。

### 8.3 触摸 / 命中目标

- 常规热区 44×44。
- **图标按钮 26×26**（同尺寸同形态）。
- **收起态命中区 36×36 的偏差说明**：主动小于 44px。理由：TickBar 是常驻置顶覆盖层，44px 隐形命中区会遮挡底层应用 44×44 的点击（在 Windows 上比「目标略小」严重得多）。补偿：鼠标场景 36px 已舒适；提供全局热键路径；悬停即出 tooltip。

### 8.4 5 态覆盖

每个有状态组件覆盖 **Loading / Empty / Error / Populated / Edge**（见 `pages-V0.2.0/` 各文件「状态与交互」小节）。

---

## 9 · Agent Implementation Guide（实现指南）

### 9.1 Tailwind config（如启用）

> 形态高度定制，Tailwind 仅作 utility 辅助；**所有设计值以 `design-tokens-V0.2.0.css` 为准**。

```js
// tailwind.config.js
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        plate: 'var(--bg-plate)', inset: 'var(--bg-inset)', panel: 'var(--bg-panel)',
        card: 'var(--bg-card)', field: 'var(--bg-field)', 'field-hi': 'var(--bg-field-hi)',
        seg: 'var(--bg-seg)', 'seg-on': 'var(--bg-seg-on)',
        line: 'var(--line)', 'line-2': 'var(--line-2)', 'line-3': 'var(--line-3)',
        ink: 'var(--ink)', 'ink-2': 'var(--ink-2)', 'ink-3': 'var(--ink-3)', 'ink-4': 'var(--ink-4)',
        accent: 'var(--accent)', 'accent-ink': 'var(--accent-ink)',
        warn: 'var(--warn)', danger: 'var(--danger)', ok: 'var(--ok)',
      },
      fontFamily: { ui: ['"Microsoft YaHei UI"', '"Segoe UI"', 'system-ui'], mono: ['"Cascadia Mono"', '"Consolas"', 'monospace'] },
      fontSize: { title: ['15px', '1.3'], num: ['14px', '1.0'], body: ['13px', '1.6'], sm: ['12.5px', '1.45'], xs: ['11.5px', '1.5'], cap: ['11px', '1.4'] },
      spacing: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 7: '32px' },
      borderRadius: { sm: '6px', md: '10px', lg: '12px', xl: '14px', pill: '17px', full: '9999px' },
      boxShadow: { pop: 'var(--shadow-pop)', plate: 'var(--shadow-plate)', float: 'var(--shadow-float)', panel: 'var(--shadow-panel)' },
      transitionDuration: { instant: '100ms', quick: '150ms', exit: '180ms', base: '200ms', morph: '280ms' },
      transitionTimingFunction: { standard: 'var(--ease-standard)', exit: 'var(--ease-exit)', morph: 'var(--ease-morph)' },
    },
  },
};
```

### 9.2 CSS 变量 / TS import

```ts
import tokens from './design-tokens-V0.2.0.json';
const accentDark = tokens.color.semantic.accent.dark;   // "#4DA3E8"
const theme = tokens.meta.theme;                        // dual-theme
const pillH  = tokens.size.pillH.value;                 // "34px"
```
主题切换：`document.documentElement.dataset.theme = 'light' | 'dark'`（CSS 变量随之切换，无重排）。

### 9.3 框架特定提示（Tauri 2 + React 19 + WebView2）

1. **多窗口**：设置 / 事项 / 便利贴各自 `WebviewWindow`；分发 `theme-changed` 事件让所有窗口同步主题。
2. **玻璃**：`backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate))` 仅用于浮层；不要铺满大面板。
3. **计时 tick 只 repaint 环所在区域**，不做整窗 repaint（RUNNING 稳态 CPU < 0.3%）。
4. **事件订阅清理**：`listen()` 的 unlisten 必须在 `useEffect` 清理函数调用。
5. **前端实时数字** = `accumulatedSec + (now - runningSince)`，基于 Rust 下发的 `startedAt` 本地推算，避免高频 IPC。
6. **主题初始值**：在 `<html>` 上尽早写 `data-theme`（首帧前），避免亮/暗闪烁（对应 K-1 白闪坑）。

### 9.4 已知坑（Phase 3 前注入）

| # | 坑 | 修法要点 |
|---|---|---|
| K-1 | 透明无边框窗口白闪 | `visible:false`，首帧完成后 `show()`；`data-theme` 首帧前写好 |
| K-2 | `data-tauri-drag-region` 不生效 | 放行 `core:window:allow-start-dragging` |
| K-5 | 关窗致进程退出、托盘失效 | 拦截 `CloseRequested` → `hide()`，仅托盘退出调 `exit(0)` |
| K-6 | 多显示器 DPI 换算致位置漂移 | 存逻辑坐标需除 `scaleFactor`，恢复按 work_area 钳制 |
| K-7 | 多窗口主题不同步 | 主窗口 `theme_set` 后 `emit('theme-changed')` 广播全部窗口 |
| K-8 | 事件订阅泄漏 | `useEffect` 清理函数调用 unlisten |
| K-11 | `invoke` 散落 | 统一经 `src/services/ipc.ts` |

### 9.5 注意 需架构协同确认的三点（技术栈差异）

1. **多窗口模型**：V0.1.0 是单窗（384×360 内绘制药丸/面板/菜单）；V0.2.0 需 **设置 392×660 / 事项 336 / 便利贴 320×232 独立窗口**。窗口生命周期、位置持久化、多显示器、主题广播 → 需架构文档 + ADR-009+ 落地。**本设计已按多窗口给出各窗尺寸。**
2. **托盘菜单外观（已裁定：保留原生）**：Tauri v2 托盘菜单是 `muda` **原生 Win32 菜单**，无法自绘。曾评估「禁用原生、光标处弹透明 `WebviewWindow` 自绘玻璃菜单（方案 B）」，**架构裁定不采用方案 B、保留原生菜单（ADR-013 结论 = 方案 A；B 降级 v0.3+ 备查、保留不删）**——即**放弃玻璃/圆角/状态块等外观，只对齐信息架构**（分组/分隔线/启用·禁用/勾选/快捷键标注）。多窗口目录**不含 `tray-menu` 窗**（该窗仅方案 B 需要）。**已闭环**，设计侧终稿见 `pages-V0.2.0/tray-menu.md`。
3. **字体字重**：`Microsoft YaHei UI` 无 500/600/650 字面（见 §3.3），中文层级需回落 400/700 或改由字号+颜色承载。**请前端确认实际渲染后写进 Spec。**

### 9.6 提交前自查

```regex
[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}]
```
emoji 正则零命中；组件 CSS 无裸 hex/rgb；计时数字规则已实现；`focus-visible` 与 `prefers-reduced-motion` 分支已实现；深/浅两套变量同时存在。

---

## 10 · 双主题切换机制 + 四色可配如何落到 Token

### 10.1 主题切换

- **载体**：`<html data-theme="dark|light">`（**属性切换，非 class**）。两套变量在同一 CSS 文件内（`:root` 默认深色 / `:root[data-theme="light"]` 覆盖），切换时**无 JS 重排、无闪烁**。
- **持久化 + 首屏无白闪（与架构对齐，K-1）**：`index.html` 放**内联引导脚本**，同步读 `localStorage('tickbar.theme')` 设 `data-theme`，再挂 React。令牌文件提供 `html { background: var(--bg) }` 且 `:root` 内给 `--bg` 默认值 —— 即使「仅设了 `data-theme`、CSS 未全量就绪」也不会白闪。
- **多窗口同步（架构 §6.a）**：主窗口 `theme_set` 后广播 `theme-changed`，**各窗各自订阅**并更新自身 `data-theme`（**主窗不代转**）。同理便利贴 / 事项 / 设置窗均自订阅 `theme-changed`。
- **降级**：`color-scheme` 随主题切换，使系统滚动条/表单控件底色跟随。
- **V0.1.0 过渡别名**：CSS 提供 `--bg / --surface / --fg / --fg-2 / --muted / --meta / --border` 等过渡别名（分别指向 `--bg-plate / --bg-panel / --ink / --ink-2 / --ink-3 / --ink-4 / --line-2`），供引导脚本与旧代码引用；**新代码一律用 V0.2.0 规范名**。

### 10.2 四色可配 → Token 映射

| 设置项（settings 表） | Config Token | 语义 Token | 深色默认 | 浅色默认 |
|---|---|---|---|---|
| `accent_running`（计时中） | `--color-running` | `--accent` | `#4DA3E8` | `#1669AD` |
| `accent_warn`（提醒） | `--color-warn` | `--warn` | `#E8A33D` | `#A05E00` |
| `accent_done`（完成） | `--color-done` | `--ok` | `#4CC38A` | `#0C7E47` |
| `accent_bar`（小条底色） | `--color-bar` | `--bg-plate` | `#0E0F12` | `#F2F3F5` |

**落法（team-lead 裁定 · AC-53/54）：**
1. 用户在设置面板改色 → 写 `settings` 表对应字段 → 前端写 `document.documentElement.style.setProperty('--color-*', value)`。
2. **出厂默认态不派生（关键）**：值 == 该主题默认（`DEFAULT_ACCENTS`）→ **不 setProperty**，直接回落分主题令牌（`--accent` / `--warn` / `--ok`）⇒ **令牌即像素、审计值即出厂像素**。
3. **仅自定义态派生**：值 != 默认时才 `setProperty`，并按规范算法派生（浅色基准底 `--bg-plate`、深色基准底 `--bg-panel`）：
   - **保色相加深**：H（色相）不变、仅降亮度。实现可用 **RGB 各通道等比步进（×0.95）**——L<0.5 时数学上等价于 HSL 保 H/S 降 L；也可显式在 HSL 空间按 L 步进。禁止改色相 / 只去饱和（褪色）。
   - 目标：**文字位 ≥4.5:1**（如「已逾期」`--todo-overdue`、菜单危险项）；**非文本位 ≥3:1**（环 / 竖条 / 描边 / 色点）。
4. **可配色的消费面（AC-54）**：`--todo-overdue` 由 `var(--warn)` 改为 **`var(--color-warn)`**，「提醒色」才真正可配生效；`--color-running` / `--color-done` 的消费者为 ring / 色点（非文本，门槛 3:1）。

> **审计校准（AC-53）**：因历史实现 `theme.ts:88-98` 采用「RGB×0.95、底=纯白、target 3.0」且**默认态也派生**，浅色 ring/done 实际渲 `#4593D1` / `#3E9F70` ≠ 令牌 `#1669AD` / `#0C7E47`，导致「审计值 ≠ 出厂像素」。按上述第 2 条改为「默认不派生」后，**审计即审分主题令牌值**；自定义态才审派生值。脚本身（`_contrast_check.py` / `_ac53_selfcheck.mjs`）已按此口径标注。
5. 派生结果**不改用户存的原始色**，只在渲染层派生 —— 尊重用户配色（Timing 落地订正 D-1 同款口径）。

### 10.3 行为常量与语义红线（对齐 PRD §2.11 / AC-61~64）

| 主题 | 设计口径 | 落点 |
|---|---|---|
| **提醒 ≠ 结束计时** | 提醒只做「告知」，**不做「自动结束计时」**；「到点自动结束」归倒计时 | `reminder-popover.md` §3.1 / `countdown-menu.md` §3.3 |
| **提醒聚合（AC-61）** | 同一时间窗 **±60s**（`size.reminderMergeWindowMs`）内多条 → 合并一条聚合通知（「N 条事项到点」）；点通知打开**事项窗口** | `reminder-popover.md` §3.4 |
| **休眠唤醒补偿（AC-61）** | 错过的提醒**合并补发一条**（「有 N 条提醒已过期」），行标逾期色，逐条可清除，**不弹阻塞框** | `reminder-popover.md` §3.5 |
| **提醒不占小条宽度** | 提醒铃只在事项窗口行内标注 + 到点短暂高亮，**不把小条撑长** | `pill-bar.md` / `todos-panel.md` |
| **倒计时到点（AC-62）** | 默认 **通知 + 视觉提示**；「自动结束并保存」为**用户开关、默认关闭**；**不新增全局快捷键**；`countdown_presets` 可增删改（默认 5/15/25/45 分） | `countdown-menu.md` §3.1/§3.3 |
| **便利贴关联（AC-63）** | 一张便利贴**只关联一个事项**（`notes.item_id` 单值）或解绑为**随记**（null），**不支持一对多** | `sticky-note.md` §3.2 |
| **便利贴置顶/可输入（AC-64）** | **默认 always-on-top**；「未悬停全透」下**正文仍可获焦可输入** | `sticky-note.md` §3.1/§3.2 |
| **便利贴缩放（两层钳制）** | 硬钳制 160×120 – 900×900（`--note-w/h-min/max`，代码强制，**仅此可拦截拖拽**）；运行时再受 `work_area` 收窄（实际最大 = `min(900, work_area)`）；舒适上限 640×480（`--note-w/h-comfort-max`，软提示/吸附，**不拦截拖拽**） | `sticky-note.md` §1/§7 |
| **便利贴几何持久化** | 落 DB `notes`：`pos_x/pos_y/width/height`（逻辑 REAL）+ `is_open`；**不存 `monitor_id`**（恢复时现算 `work_area`）；`Moved/Resized ÷ scaleFactor`，300ms 去抖（K-15/K-23） | `sticky-note.md` §7 |
| **单例窗几何** | `main`/`settings`/`todos` 固定 label → 由 `tauri-plugin-window-state` 自动维护，**不入库** | `settings-panel.md` §7 / `todos-panel.md` §7 |
| **常用事项** | 最近 **5** 条（`size.commonRecentCount`）+ 固定任务不设硬上限、滚动、软提示 ≤8 | `common-items.md` §3.1 |

> 对应 Token：`size.reminderMergeWindowMs` / `size.commonRecentCount` / `size.commonPinnedSoftCap` / `size.note{W,H}{Min,Max}` / `size.note{W,H}ComfortMax` / `size.noteGeomPersistDebounceMs` / `size.noteConfirmStackBelowW`（见 `design-tokens-V0.2.0.json`）。
>
> **Token 归属分层（架构已定，避免 Spec 放错层）**：
> - `note{W,H}Min/Max` + `noteGeomPersistDebounceMs` ← 与窗配置 / `domain.ts` 常量（`NOTE_MIN_*` / `NOTE_MAX_*` / `NOTE_GEOM_DEBOUNCE_MS`）一一对应。
> - `note{W,H}ComfortMax` ← **软提示**，仅设计/前端消费，**架构不联动**。
> - `noteConfirmStackBelowW` ← **组件内部布局断点（表现层）**，仅便利贴组件消费，**不进窗配置、不进 `domain.ts`**。

---

## 11 · 反 AI 模板自检（对照 8 硬红线 + 13 项自检）

### 11.1 八条硬红线

| # | 红线 | 本稿结论 | 证据 |
|---|---|---|---|
| 1 | 禁止紫→粉渐变主视觉 | 无（通过） | 全项目零渐变；强调色为纯色 `#4DA3E8`；已删运行光晕 |
| 2 | 禁止 emoji 作功能图标 | 无（通过） | 锁定 lucide-react；正则零命中；`icon.rule` 显式禁用 `U+2713` 等 |
| 3 | 禁止默认系统字体直出 | 无（通过） | `Microsoft YaHei UI` + mono fallback 链；7 档字号 + 4 档字重层级明确 |
| 4 | 禁止硬编码颜色 | 无（通过） | 全部经 CSS 变量；唯一例外 `#FFFFFF`（`--btn-danger-ink` 白字）与 shadow 内 rgba |
| 5 | 禁止 Lorem / 空洞占位 | 无（通过） | 全部具体中文动作（「开始正计时」「今日还没有记录」「计时最短秒数」）+ 真实格式（`00:12:41`） |
| 6 | 必须先冻结图标与字体 | 已冻结（通过） | `icon.library = lucide-react`；字体栈在 `typography.fontFamily` 锁定 |
| 7 | 必须有可访问交互 | 有（通过） | `:focus-visible` 双环 + 全键盘路径 + `prefers-reduced-motion` |
| 8 | 必须有完整 Design Token | 有（通过） | 三层 Token（primitive/semantic/component）+ 色彩/间距/圆角/阴影/动效完整 |

### 11.2 P0 三条绝对规则

- 通过 **无 emoji 功能图标** —— 正则扫描零命中，全部 lucide。
- 通过 **无紫→粉渐变** —— 零渐变，纯色品牌蓝。
- 通过 **无 AI 模板味** —— 无 "Welcome to" / "Lorem ipsum"；小条/面板展示真实产品内容（时间数字、真实事项名、真实菜单项）。

### 11.3 设计系统 8 项检查

- [x] 所有颜色通过 Design Token 引用
- [x] 间距全为 4px 整数倍（9px 行内距为 Timing 收敛值，已入 Token）
- [x] 字体同时指定中文字体 + mono fallback（+ `--icon-*` 尺寸）
- [x] 标题/正文/等宽三种字体有明确层级
- [x] 小条/面板展示真实产品内容，而非口号 + 抽象图形
- [x] 已选定对标（Timing v1.7.0 / Raycast / Linear），全产品一致
- [x] 按钮含必要状态（Default/Hover/Focus/Active/Disabled/Loading）
- [x] 表单有验证错误、列表有空状态

### 11.4 质量标准 5 项

- [x] 图标库锁定 lucide-react，尺寸统一 16/20/24px
- [x] 无纯黑 `#000` / 纯灰 `#808080` 直出（最深为 `#0E0F12`，已带蓝调）
- [x] 对比度达标（正文 ≥4.5:1，实测见 §2）；动画 ≤400ms（confirm/undo 为语义时长）；支持 reduced-motion
- [x] 无响应式需求（桌面固定形态），但已覆盖多显示器 / DPI / 多窗口
- [x] 组件状态矩阵覆盖 9 态（§4.9）

### 11.5 绝对禁令自查

- OK 无双色侧条纹边框（当前行用 `--accent-wash` 底 + 竖条组合，非仅彩色左边框）
- OK 无渐变文字（`background-clip: text` 零使用）
- OK 无默认毛玻璃（玻璃仅用于浮层，功能目的见 §6.4）
- OK 无 Hero 指标模板（小条非营销 Hero）
- OK 无「相同卡片网格」无限重复（清单用 1px 线分组）
- OK 无「每节小写追踪标签」/「编号 section 标记」（桌面应用，无营销 section）
- OK 无文字溢出容器（长事项名走 `task-w-max` 164 截断）
- 注意 「幽灵卡片」已规避：卡片统一为 `1px 线 + --radius-lg + 无阴影`；阴影只出现在浮层
- OK 无过度圆角（卡片 12 / 面板 14，未 ≥24）
- OK 无重复结构动效（小条 tick / 菜单出场时长各自匹配内容）
- OK 无奶油/米色背景默认（中性阶为冷灰 `#0E0F12 ~ #232833`，浅色为中性 `#F2F3F5`）

---

## 12 · 图标清单（lucide-react，全项目汇总）

> 尺寸语义：`--icon-sm` 16px（行内）/ `--icon-md` 20px（按钮内）/ `--icon-lg` 24px（独立）。16px 用 `stroke-width 2.5`；20/24px 用 `2`。

| 场景 | 图标（lucide 名） | 尺寸 |
|---|---|---|
| 小条 · 开始 / 暂停 / 结束 | `play` / `pause` / `check` | sm 16 |
| 小条 · 新建事项 | `plus` | sm 16 |
| 小条 · 抓取柄 | 自绘圆角括号 `）`（非 lucide） | SVG 12×22 |
| 菜单 · 常用项 | `list` `clock` `book-open` `moon` / `sun` `settings-2` `eye-off` | sm 16 |
| 事项窗口 · 表头 / 底栏 | `plus` `pencil` | sm 16 |
| 事项窗口 · 提醒铃 | `bell` | sm 16（`--warn` 色） |
| 事项窗口 · 空态 | `clock` | lg 24 |
| 便利贴 · 删除 / 关闭 | `trash-2` / `x` | sm 16（`stroke 1.5`） |
| 菜单 · 计时控制 | `pause` `square` `ban` `play` | sm 16 |
| 菜单 · 编辑 / 提醒 / 备注 / 便利贴 / 复制 | `pencil` `bell` `message-square-plus` `message-square` `sticky-note` `copy` | sm 16 |
| 菜单 · 危险 | `trash-2` | sm 16（`--danger`） |
| 菜单 · 退出 | `power` | sm 16（`--danger`） |
| 菜单 · 设置 / 关于 | `settings-2` / `info` | sm 16 |
| 菜单 · 打开 | `folder-open` `file-text` `calendar-days` `arrow-left` `map-pin` | sm 16 |
| 提醒弹窗 | `bell` `clock` `x` | sm 16 / md 20 |
| 倒计时菜单 | `timer` `repeat` `bell` | sm 16 |
| 主题/配色 | `sun` `moon` `rotate-ccw` `chevron-right` | sm 16 |
| 取色行 | `chevron-right` | 11px（`--ink-4`） |
| 提示气泡 kbd | 无图标（纯文字键位） | — |

> 每页更细的图标用法见对应 `pages-V0.2.0/*.md` 的「用到的 Lucide 图标」小节。

---

*文档结束 · TickBar DESIGN-V0.2.0.md · 颜好看 · 2026-10-16*
