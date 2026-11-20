# Timing 主窗口（大窗）UI 优化设计方案 · 可执行版

- 日期：2026-11-20 · 产出：UI 设计全栈专家团（视觉 / 体验 / 前端工程 三阶段 + 主理人汇编）
- 范围：**仅主窗口大窗（分析窗 activity：首页 dashboard / 数据 data,history / 设置 settings / 映射 mapping / 关于 about）**。悬浮计时条（Dot/Pill/把手簇小窗）本轮**冻结**，仅继承统一令牌，不改形态与交互。
- 上游依据：`docs/design/PLAN-20261119-UI重构设计方案.md`、`UI-REFACTOR-P1-视觉方向.md`、`UI-REFACTOR-P2-体验规范.md`、`B6-验收核对报告.md`；本轮三份：`UI-REFACTOR-P1-视觉方向.md`(增量)、`Timing-大窗体验规范-P2-ux.md`、`Timing-大窗工程落地校验-P3-fe.md`。
- 读者：后续执行的 AI / 工程师。**每条含：目标 / 具体做法（真实落点+行号）/ 影响范围 / 验收标准（脚本或人工可判）/ 优先级 P0·P1·P2。**
- 纪律：所有落点已经前端工程校验，三处与代码现状不符的原始设想已在本文**纠偏替换**，不保留错误落点。

---

## 1. 现状问题归纳与优化目标

### 1.1 四大问题（用户口径）与根因

| 问题 | 具体表现 | 根因（代码层） |
|---|---|---|
| **窗口过大** | 默认 1100×736、最小 900×636 占屏重；超宽屏下内容被拉伸稀释 | `main_window.rs` 尺寸常量偏大；shell 主列**无内容最大宽度**（`topbar.css` 的 `.at-shell` 只有 padding） |
| **组件分布不均** | 首页自由摆位画布可留大空洞；数据概览三块等权无主图；设置卡高参差节奏跳动 | 画布卡可任意摆放、无出厂权重顺序；留白缺统一节奏 |
| **信息层级混乱** | 三页视觉页头已下线（仅 `sr-only` h1），层级全靠卡内部，缺"一眼先读到什么"的统一主次 | 无 Primary/Secondary/Tertiary 口径；首页默认布局无权重；一屏多个同级大数 |
| **视觉风格不一致** | 同一按钮/卡片在主窗与分析窗圆角、字号、禁用态各不同，像两个产品 | 两套令牌各说各话（上一轮已建语义桥，但组件状态未全量锁令牌） |

### 1.2 优化目标（可验收）

1. **瘦身**：默认窗口 −5%/−8%，最小窗口下探，超宽屏正文不无限拉伸。
2. **一眼可读**：每页有唯一视觉重心（Primary），进页面 1 秒读到答案。
3. **分布均衡**：同层同留白节奏，无空卡占位，一屏强调色面板 ≤2。
4. **一套语言**：大窗全组件状态（default/hover/active/focus/disabled）锁统一语义令牌，裸 hex 仅存 primitives。
5. **可判定**：每条规则由脚本（DOM 查询 / 测试断言 / 门禁命令）或人工客观核对，不靠"看着舒服"。

### 1.3 硬约束（继承，全程不可破）

- 单文件 ≤600 有效行（`npm run check:size` 棘轮，只减不增）；`main_window.rs` 已冻结 670 行，**只许改数字不许重构**。
- 分层 L1–L10 只能向下（`npm run check:layers`）；IPC 契约不动（`npm run check:contract`）。
- 组件 CSS 0 裸 hex（`npm run check:css-hex`）；禁用态"硬白"必须经 `tokens.css` 令牌，不能在组件写 `#fff`。
- 13 个 `handleCatalog` id、`settingsGroups` 顺序与 id、`View` 枚举均不可改名/改序。
- 首页默认布局改动**只动出厂/重置默认**；归一化 `loadDefaultLayout()` 已优先读用户存档，不回拨老用户。

### 1.4 三处原始设想已纠偏（前端校验结果，执行时按本文为准）

| 原始设想 | 校验结论 | 本文采用 |
|---|---|---|
| 改 `dashboard.css:71` `.at-grid` 加 @container 列数断档 | `.at-grid` 是 v2 **死代码**，`dashboardBoardLayout.test.ts:38` 断言渲染结果不得含 `at-grid` | **退回**：首页列数不自动随窗宽；响应式列数若需要，落点改数据页 `.data-app-metric-strip`（§5.2） |
| 窗口尺寸只改 `main_window.rs` + `useMainWindowSizeMemory.ts` 两处 | 漏第三处 `tiers.css` 画布派生常量，不同批改会导致画布版式按旧尺寸排、被裁 | **三源联动**（§3.1） |
| 信息密度两档按**窗宽 1040** 自动切、改 dashboard.css、padding 16/12 | 密度 token 实际在 `tiers.css`、现状按**窗高**切档、padding 现状 20；画布是整体 zoom、卡内逐值锁死 timing-board.exe | **降级 P2**，限定非画布视图（data/settings），padding 基准改用现状 20（§6.3） |

---

## 2. 统一视觉规范（P0 · 解决"风格不一致"）

> 根因是两窗令牌各说各话。下面每个组件状态**只认统一语义令牌**，这是本轮最高优先级。

### 2.1 全局刻度（继承上一轮，不新增）

- 间距 7 档：`--space-1..7 = 4/8/12/16/20/24/32`（4px 栅格）
- 圆角 5 档：`--radius-sm6 / md10 / lg14 / xl18 / full9999`
- 字号 7 档：`10 / 11 / 12 / 13 / 14 / 18 / display`（消灭半像素，**不新增档**，见 §2.4）
- 字重 2 档：`400 regular / 700 emphasis`（medium 等别名保留名字、值指向 400/700）
- 阴影（大窗）2 档：`--shadow-pill`(弱) / `--shadow-panel`(中)；主窗侧仍 none 靠 1px 描边
- z 6 档：`base0 / handles10 / popover20 / panel30 / toast40 / drag50`
- 图标：lucide line；16px 用 stroke 2.5、20/24px 用 stroke 2；尺寸 16/20/24；`currentColor`

### 2.2 组件状态统一表（default / hover / active / focus / disabled）

8 组语义令牌：`bg-app / bg-panel / bg-elevated`、`text-primary / secondary / tertiary`、`border-subtle / strong`、`accent / accent-muted`、`success / warning / danger / participation`。

**Button（高 28/32 两档，圆角 md10）**

| 状态 | 背景 | 文字 | 边框 |
|---|---|---|---|
| default | `bg-elevated` | `text-primary` | `border-subtle` |
| hover | `bg-elevated`（浅色底亮1档/深色转描边） | `text-primary` | `border-strong` |
| active | 同 hover | `text-primary` | `border-strong`（无位移动画） |
| focus | default 底 | `text-primary` | `accent` 2px 焦点环（非文本 ≥3:1） |
| disabled | `bg-panel`（见 §2.3） | 深=白 / 浅=`text-tertiary` | `border-subtle` |
| primary | `accent` 实心 | 白 | 无（一屏 ≤1 处） |

**Card / Panel（圆角 lg14，大窗 shadow-panel）**

| 状态 | 背景 | 边框 | 阴影 |
|---|---|---|---|
| rest | `bg-panel` | `border-subtle` | card-rest |
| hover | `bg-panel` | `border-strong` | card-hover |
| selected | `bg-elevated` | `accent` 1px | card-rest |

**Input / Select（圆角 md10）**

| 状态 | 背景 | 边框 | 文字 |
|---|---|---|---|
| default | `bg-elevated` | `border-subtle` | `text-primary` |
| hover | `bg-elevated` | `border-strong` | `text-primary` |
| focus | `bg-elevated` | `accent` | `text-primary` |
| error | `bg-elevated` | `danger` | 说明文字 `danger` / `fs-body12` |
| disabled | `bg-panel` | `border-subtle` | 浅=`text-tertiary` |

**导航 / 菜单项 / Tab（圆角 md10，z-panel/popover）**

| 状态 | 背景 | 文字 | 图标 |
|---|---|---|---|
| default | 透明 | `text-secondary`(浅)/白(深) | currentColor 16/stroke2.5 |
| hover | `bg-elevated` | `text-primary` | 继承 |
| active/current | `accent-muted` 底 | `text-primary` | 继承 |
| focus | 透明 | `text-primary` | `accent` 2px 环 |
| disabled | 透明 | `text-tertiary` | 继承 |

- **影响范围**：大窗全部组件 CSS。
- **验收**：组件 CSS `rg ":disabled|:hover|:focus"` 命中处的色值全为 `var(--*)`，无裸 hex（`npm run check:css-hex` 绿）；一屏带强调背景的面板计数 ≤2。

### 2.3 深色禁用态专门口径（P0 · 最易错）

深色硬口径"文字纯白零透明"与"禁用要变灰"冲突。统一解法：

- **深色禁用**：不降文字透明度，文字保持纯白；降的是**背景对比**（禁用底回落 `bg-panel`，与可用态 `bg-elevated` 拉开差）+ `cursor:not-allowed`。
- **浅色禁用**：用 `text-tertiary` 墨灰。
- **实现约束（前端校验）**：现状普遍用 `:disabled{opacity}`（如 `app-shell.css:85-88` `.at-color-trigger:disabled{opacity:0.58}`、`:176-179` `.at-color-eyedropper:disabled{opacity:0.55}`），与本口径冲突。需按主题分流：`tokens.css` 按 `data-theme` 给 `--at-text-disabled` / `--at-disabled-bg` 不同值，组件统一引用；"硬白"不能在组件写 `#fff`（`check:css-hex` 会红），必须经 `tokens.css` 令牌。
- **优先级**：令牌化体量大，列 **P2**（§9 批次 5）。
- **验收**：`rg "opacity" .../*.css | rg ":disabled"` 暗色禁用态不靠 opacity 降文字；人工在暗色主题下禁用按钮文字仍纯白、底回落 bg-panel、cursor:not-allowed。

### 2.4 Primary 标题字阶（视觉收口结论）

- **不新增档，维持 7 档**，`size`/刻度门禁零影响。
- **Primary 答案数字 → display 档**（大窗解析为 **24px / 700 / tabular-nums**，= 现分析窗 metric 24）。这是"1 秒答案"的承载者，也是一屏唯一视觉重心。
- **区域标签/小标题 → 14 section / 700**；页级大标题 → 18 title / 700。
- **关键层级约束（给前端）**：一屏 **display 档只许出现 1 个**（那个 Primary 答案）。**4 张统计卡的数字必须降到 18 title，不得也用 24**，否则一屏 5 个大数就没有重心。一处强调色（≤1）落在这个 display 重心上。

---

## 3. 窗口尺寸与整体布局重构（解决"窗口过大"）

### 3.1 窗口尺寸下调 · 三源联动（P1）

- **目标**：默认窗口不占屏，最小窗口下探；画布版式随新尺寸对齐，不被裁。
- **具体做法（三处必须同批改，漏一处就错位）**：
  1. `src-tauri/src/app/activity/main_window.rs:25-28` 四常量：
     - `MAIN_WINDOW_WIDTH 1100.0 → 1040.0`
     - `MAIN_WINDOW_HEIGHT 736.0 → 680.0`
     - `MAIN_WINDOW_MIN_WIDTH 900.0 → 860.0`
     - `MAIN_WINDOW_MIN_HEIGHT 636.0 → 600.0`
     （消费点 `:439-440` 的 `.inner_size()` / `.min_inner_size()`）
  2. `src/windows/activity/shell/hooks/useMainWindowSizeMemory.ts:30-31`：`MIN_WINDOW_WIDTH 900→860`、`MIN_WINDOW_HEIGHT 636→600`（参与 `clampWindowSize()` :66-67 与落盘跳过 :89；记忆存逻辑像素，DPI-safe，改下界不影响已存档老用户）。**同批更新该文件对应测试 `useMainWindowSizeMemory.test.ts` 的期望值与注释（:20 "1100×736"、:38-39 引用）**，否则 `npm test` 红。
  3. `src/windows/activity/shell/styles/tiers.css:10-15,24-25,109-114` 画布派生常量（注释已声明"`main_window.rs` 改动必须同批改"）：
     - `--at-board-w 1052 → 992`（1040−2×24）
     - `--at-board-h 636 → 580`（680−52−2×24）
     - 短档阈值 `@media (max-height:735.98px) → ≈679.98px`
     - 短档 `--at-board-h 552 → 516`（600−44−2×20）
- **影响范围**：Rust app 层 1 文件 + shell hook 1 文件 + 测试 1 文件 + tiers.css 1 文件。
- **验收**：
  - `rg -n "1040\.0|680\.0|860\.0|600\.0" .../main_window.rs` 命中 4，旧值 0 命中。
  - `npm run check:size`（`main_window.rs` ≤670，等值替换不增行）、`npm test`（`useMainWindowSizeMemory.test.ts` 绿）。
  - 人工：默认开窗 1040×680 居中；宽度 <860 不可再缩；画布无右/下裁切。

### 3.2 内容最大可读宽（P1 · 当前缺失，新增）

- **目标**：超宽屏下 data/settings/mapping/about 正文不被无限拉伸稀释。
- **做法**：新增令牌 `--at-content-max:1280px`（定义放 `tiers.css` 或 `tokens.css`），对 `.at-shell`（`AppShell.tsx:206`，样式 `topbar.css:234-240`，现状确无 max-width）或其主内容子节点加 `max-width:var(--at-content-max); margin-inline:auto`。
- **注意**：dashboard 画布走 `--at-board-w` 不吃该限宽；1280 > 默认 1040，故默认窗口下不生效，仅手动拉宽/最大化时起作用——符合预期。
- **影响范围**：`topbar.css` / `AppShell.tsx`（加 class）、新增 1 个 token。
- **验收**：`rg -n "at-content-max" .../shell/styles/` 命中定义 1 + 消费 1；人工拉到 1600 宽时 data/settings 主列停 1280 居中、左右留白对称；`npm run check:css-hex` 绿。

### 3.3 纯文字测量宽（P2）

- **目标**：about 等长文每行不过长、可读。
- **做法**：新增 `--at-text-measure:68ch`，作用到 `about.css`（有效行 361，余量足）的正文容器 `.about-center-profile p`（:56-62）。
- **影响范围**：`about.css` + 1 token。
- **验收**：`rg -n "at-text-measure" .../features/about.css` 命中；人工 about 正文每行 ≤~68 字符。

### 3.4 不同窗口尺寸 / DPI 适配策略（P1）

- **按逻辑像素断档**（非 DPI 单独分支）：小 <1040 → 紧凑档 + 降列；中 1040–1199 → 标准档；大 ≥1200 → 标准档并受 `--at-content-max` 封顶。
- **DPI**：125%/150% 缩放等价逻辑宽变小，复用同一套容器查询；尺寸记忆存逻辑像素已保证跨屏不漂。
- **任意窗宽不出现横向滚动**（靠 `minmax(0,1fr)` + 降列兜底）。
- **验收**：人工在 100%/125%/150% 下无横向滚动条、无内容截断。

---

## 4. 信息层级重排（P0 · 解决"信息层级混乱"）

统一三级口径（对接 §2.4 字阶：字号差 + 字重 400/700 + 留白，**不靠灰阶、不靠强调色堆叠**）：

| 级别 | 含义 | 承载手段 |
|---|---|---|
| **Primary（主）** | 进页面 1 秒读到的那一个"答案" | 首屏第一行、display 24/700、周围留白最大；**每页唯一** |
| **Secondary（次）** | 支撑主信息的分解/排行/走势 | 首屏可见、18 title 或 14、字重 400、常规 gap |
| **Tertiary（辅）** | 管理类、低频、设置性入口 | 下沉第二屏或收进菜单/弹层、最小字号、弱留白 |

### 4.1 首页 dashboard 三级（P0）

- **目标**：首屏权重落到 2:5:3 = 一行统计/计时 + 一个主图表 + 事项卡头。
- **做法（真实落点）**：改 `src/windows/activity/features/dashboard/layout/defaultLayout.ts:18-32` 的 `DEFAULT_LAYOUT.cards` 出厂坐标/tier（纯数据，文件 ~58 行无体积风险）。现状已基本符合：
  - Primary = `timer`（今日已计时总量 + 分布环），`x:24,y:24,w:340,h:304`（首列左上，M 档）。**其数字走 display 24；其余统计卡数字降 18**（§2.4）。
  - Secondary = `trend`（主图表，`x:726,y:24`）+ `apps`（`x:380,y:24`，同顶行）。
  - Tertiary = `timeline`（`x:24,y:344`）/`manage`（`x:380,y:344`）/`heatmap`（`x:726,y:344`）/`notes`（`x:726,y:584`）下沉。
- **不回拨老用户**：`layoutStore.ts:150-153` `loadDefaultLayout()=loadSavedDefault() ?? cloneDefaultLayout()`，优先读存档；改 `DEFAULT_LAYOUT` 只影响新用户/恢复默认。
- **影响范围**：`defaultLayout.ts` 一个常量对象。
- **验收**：`DEFAULT_LAYOUT.cards.find(c=>c.kind==="timer")` 的 `x===24 && y===24`；坐标无重叠且在 `BOARD_W 1250 × BOARD_H 820` 内（`geometry.test.ts` 8px 吸附）；`layout.test.tsx`/`savedDefault.test.ts` 回归绿；每页 `sr-only` h1 唯一。

### 4.2 数据 data 概览三级（P0）

- **目标**：从"三块等权"变"一主图 + 两辅"。
- **做法**：Primary = 趋势 `DataTrendPanel`（概览块首位、最大高度，关键读数走 display 24）；Secondary = 热力 `DataHeatmapPanel`；Tertiary = 目的地 `DataAppTrendPanel`（应用/分类/标签/网页，可滚动在下）。调 `Data.tsx` + `data.css`（有效行 224）高度与结构顺序，不改读模型。
- **注意**：`data.css:141` 已有 `@media (min-width:901px)-(1899px)` 的 `.data-app-panel` 堆叠规则，调高度勿与之打架。
- **验收**：概览首屏趋势图高度 ≥ 热力图；`DataAppTrendPanel` 的 `offsetTop` 大于趋势与热力（位于其后）。

### 4.3 设置 settings 三级（P0 · 现状即达标，零改动）

- **目标**：高频组先触达。
- **现状**：`settingsGroups.ts:32-56` 五组顺序 计时行为→外观→悬浮条与把手→数据与同步→通用与启动，`SETTINGS_GROUPS[0].id==="tracking"` **已成立**；锚点导航 `SettingsGroupNav` 常驻、组内 ≤2 层深（既有硬约束）。体验口径：Primary=计时行为，Secondary=外观/数据与同步，Tertiary=悬浮条与把手、通用与启动。
- **影响范围**：无结构改动，仅文档化口径。
- **验收**：`settingsGroups.source.test.ts`/`settingsConvergence.source.test.ts` 绿即达标。

---

## 5. 组件分布均衡（P1 · 解决"组件分布不均"）

配合 §2 密度档与 1:1 卡内距。

### 5.1 区域划分与对齐基线（P1）

- 每页三带：**头带**（工具条/面签 `flex:0 0 auto`）/ **主带**（滚动内容）/ **叠层**（toast/弹层 fixed 不占流）。`AppShell` 已是此结构，本规则固化口径。
- 首页画布落点对齐三列栅格 `COLUMNS(x=24/380/726)` + `SNAP=8`，"整理"按钮把卡吸附回栅格。
- 数据概览块与目的地块**左边界对齐**同一内容左缘；设置卡统一左右内边距、占满单列。
- **验收**：每页恰一个滚动主带（`at-scroll-region` 或等价），头带不随主带滚；"整理"后任一卡 `x∈{24,380,726}`（或其叠放列）且 `(x,y,w,h)%8===0`；数据概览块与目的地块 `offsetLeft` 相等；设置相邻卡间距差 ≤1px。

### 5.2 卡片网格列数（P1 · 落点已纠偏）

- **纠偏**：首页**没有**随窗宽变列数的统计卡网格——`dashboard.css:71` 的 `.at-grid` 是 v2 死代码（`dashboardBoardLayout.test.ts:38` 断言渲染不得含 `at-grid`），首页卡位由 `defaultLayout.ts` 绝对坐标 + 用户 zoom 决定。**不要改 `.at-grid`**。
- **若需响应式列数**，真实落点是数据页 `quiet-pro.css:1239-1241` 的 `.data-app-metric-strip`（`repeat(4,minmax(0,1fr))`），可安全加 `@container` 断档：≥1200→4 / 1040–1199→4 / 860–1039→3 / <860→2。注意避开 `data.css:141` 已有的 `@media` 响应式，勿打架。
- **技术确认**：`@container` 仓内已 5 处在用（`dashboard-card-fit.css`/`dashboard-heatmap.css`/`dashboard-modules.css`/`dashboard-notes.css`/`note.css`），Tauri 固定 WebView2（Chromium ≥105）无兼容问题。
- **验收**：若落地，`rg "@container" quiet-pro.css` 命中断档；人工数据页应用指标条列数随窗宽变；首页回归 `dashboardBoardLayout.test.ts` 不变。

### 5.3 留白节奏（P1）

- 同层级同一 gap（标准 16 / 紧凑 12），层级切换才换留白；**禁止用空卡/空 div 占位制造间距**；一屏强调色面板 ≤2。
- **验收**：同一网格相邻项 gap 恒定（单值）；带强调背景面板计数 ≤2。

### 5.4 首屏视觉权重 2:5:3（P2）

- 首屏（默认 1040×680 无滚动）仅重点含 {timer, trend, apps}，权重约 统计卡行(~160高):主图表(~320高):事项列表(其余) ≈ 2:5:3；其余模块下沉第二屏。
- **验收**：首屏（BOARD_H 820 设计高内）可见重点卡集合 = {timer,trend,apps}，其余卡 `y+h` 超 820 或非首屏首要位。

---

## 6. 核心功能入口与交互流程（P0/P1 · 减少重复操作、提升协同效率）

### 6.1 入口盘点与优先级

| 入口 | 当前位置 | 定级 | 处置 |
|---|---|---|---|
| 查看今日计时分布 | 首页 timer 卡 | **P0** | 首屏常驻（§4.1 Primary） |
| 开始/暂停/切换事项计时 | 首页 manage/timeline 行点击起停 | **P0** | 首屏常驻，大窗内保留行点击起停 |
| 看今日趋势/排行 | 首页 trend/apps + 数据概览 | P1 | 首屏次级 |
| 进入数据/历史 | 顶栏"数据"→面签切历史 | P1 | 顶栏一级 + 面签，单一路径 |
| 改计时规则 | 设置→计时行为 | P1 | 设置第 1 组 |
| 分类映射管理 | 首页"全部分类…" / 数据页双击 | P1 | 见 §6.2 合并 |
| 外观/主题/语言 | 设置→外观 | P2 | 设置第 2 组 |
| 悬浮条与把手绑定 | 设置→悬浮条与把手 | P2 | 设置第 3 组 |
| 同步/备份/导入导出 | 设置→数据与同步 | P2 | 设置第 4 组 |
| 常驻/启动/插件/AI | 设置→通用与启动 | P2 | 设置第 5 组 |
| 关于/反馈 | 设置区 about | P2 | 设置高亮区内 |

### 6.2 重复入口合并（P0 识别 / P1 落地）

- **分类/标签编辑分散**：首页 `onOpenMapping`（"全部分类…"���跳 mapping；数据页双击应用行开 `AppTagDialog`；mapping 视图又有完整管理。
  - **做法**：统一"修改单个应用的分类/标签"走同一 `AppTagDialog`；"全部分类…"仅作为"进入完整管理"的唯一入口指向 mapping，不再另起一套单项编辑 UI。先只统一单项弹层、不动 mapping 完整管理，分阶段灰度。
  - **验收**：大窗内"单个应用改分类/标签"的所有触发点打开同一组件（同一 `AppTagDialog`），不存在第二套单项分类编辑对话框。
- **历史入口**：已由 `DataHistoryFaces` 收敛为"面签历史"或"概览点某天柱子"两处，**保持**，不加第二条顶栏项。
  - **验收**：`history` 视图只由面签 `onSelect` 或 `onOpenHistoryDate` 进入，无独立顶栏项。

### 6.3 关键交互流程简化（步数按可感知点击/跳转计）

**流程 A · 看今日统计（P0）**
- 前：打开大窗 → 若落在数据/设置 → 点顶栏"主界面" → 画布里找 timer 卡。最坏 2 跳 + 1 次视觉搜索。
- 后：冷启动默认恢复 `dashboard`，timer 固定首屏左上 → **0 跳直达**。
- 验收：冷启动（无上次视图记录）`currentView==="dashboard"`；timer 在首屏首列顶部（复用 §4.1 验收）。

**流程 B · 新建/切换事项并计时（P0）**
- 前：manage 卡找事项 → 点行起停；切换需先停再起。
- 后：manage 行点击 = 一次点击一条意图，`useItemTimerToggle` 的双意图合一（停当前 + 开目标）**已实现**（文件头 :13-18；连点两重保险 busyRef :28-32 已防重复提交）；新建入口在卡头常驻。
- 验收：点非计时行只发一条"切换"意图，无需额外点"停止"；快速双击只触发一次（`useItemTimerToggle.test.ts` 已覆盖，核对）；新建入口 manage 卡头一次点击可达。

**流程 C · 改一项设置（P1）**
- 前：顶栏"设置" → 五组长页滚动找 → 改 → 保存。
- 后：顶栏"设置" → 左锚点 `SettingsGroupNav` 一步定位（组内第一张卡即高频项）→ 改 → 保存/取消常驻 `QuietPageToolbar`。
- 验收：点锚点后目标卡滚入视口且 `aria-current` 落对应组；保存/取消在设置页始终可见（不随滚动离场）。

---

## 7. 大窗内面板/控件状态机（P0 · 注意是大窗内，不是悬浮条）

### 7.1 数据读取型面板七态（timer/apps/trend/heatmap、数据概览/目的地）

以 `readState.status` + 快照有无为准（`Dashboard.tsx:150-174` 已有 `data-dashboard-read-state`、`showPageError`、`hasAnyData` 骨架）：

| 状态 | 触发条件 | 体验表现（可判据） |
|---|---|---|
| 加载 loading | 首次拉取、无快照 | `aria-busy="true"`，骨架占位，不显旧数、不显"空" |
| 就绪 default | 有数据且无刷新错误 | 正常渲染，去 `aria-busy` |
| 刷新中（有旧数） | 有快照、后台刷新中 | 保留旧数，仅卡头轻提示，不整面覆盖 |
| 刷新失败（有旧数）E3 | `status==="error"` 且 `hasSnapshot` | 旧数 + 卡头小错误标 + 重试，不清空 |
| 读取失败（无数据）E2 | `status==="error"` 且无快照 | 仅该面板内错误 + 重试，不波及同页其它面板 |
| 整页失败 E5 | 全源失败 **且** `!hasAnyData` | 整页 notice + 重试；有任一局部数据（待办/便利贴）时降级为局部 E2，**禁止**整页覆盖 |
| 空态 empty | 成功但无记录 | 解释性文案；计时卡空态须用 `excludedToolTime` 解释"今天只有工具类应用(xh)" |
| 焦点恢复 | 重试后按钮消失 | 焦点送回重试键/面板（`returnRetryFocusRef`） |

- **验收**：E2 只影响触发面板（构造单面板 error + 其它有数据，其它仍 default）；E5 须同时 `error && hasAnyData===false`（现状 `Dashboard.tsx:160-162` 已满足，补测试断言）；计时卡全工具日空态文案含被排除时长数值。

### 7.2 导航/面签型（顶栏三区、数据面签、设置锚点）

| 状态 | 触发 | 表现 |
|---|---|---|
| default | 非当前 | 普通态 |
| 激活/选中 | 当前视图命中 | 顶栏 `aria-current="page"`；数据面签 tabs 语义选中；设置锚点 `aria-current` |
| hover/focus | 悬停/聚焦 | 可见焦点环（走 §2.2 focus 令牌）；预加载在 focus/mouseenter/pointerdown，不改激活态 |
| 加载中（导航） | 目标 chunk 未就绪 | 保留旧视图直到就绪，不白屏 |

- **验收**：`document.querySelectorAll('[aria-current="page"]').length === 1`；键盘 Tab 可达每个 tab 且焦点可见。

### 7.3 可编辑/动作型（设置项、保存/取消、不可逆动作）

| 状态 | 触发 | 表现 |
|---|---|---|
| default | 常态 | 可操作 |
| disabled | 条件不满足（pending、无未保存更改） | 深色不降文字透明（§2.3），降背景 + not-allowed；保存无变更时禁用 |
| 处理中 pending | 异步进行 | `aria-busy`，期间保存被 gate 返回 false，防重复提交 |
| 不可逆确认 | 结束并保存/数据清理/删除 | 强制二次确认（`useQuietDialogs`）；不进任何"单击即执行"路径（`timer.stop` 不在出厂单击槽） |
| 脏态 dirty | 有未保存更改 | 保存/取消可用；离开视图前 confirm 拦截（`setSettingsDirty`/`setMappingDirty`） |

- **验收**：无更改时保存 disabled；语言切换 pending 期间 save handler 返回 false（`languageSelectionPendingRef` 已实现）；数据清理/导入/结束保存均经 confirm，无直接执行路径。

### 7.4 无障碍（a11y）贯穿三页

- 顶栏三区图标按钮带 `aria-label`+`title`；每页 `sr-only` h1 作页名。
- 顶栏三区是站点级目的地 → `<nav>`+`aria-current="page"`，**不是** tablist；数据概览/历史换面板 → tabs 语义。两者不混。
- 所有入口可 Tab 到达、回车/空格触发；焦点顺序跟随 Primary→Secondary→Tertiary。
- 焦点环走 focus 令牌不靠灰阶；对比度正文 ≥4.5:1、非文本 ≥3:1；尊重 `quietMotionMode`（`data-at-motion`）降级动效。
- **验收**：键盘仅 Tab/Shift+Tab/Enter/Space/方向键完成 §6.3 三流程；顶栏恰一个 `aria-current="page"`、锚点恰一个 `aria-current`；axe/脚本扫描无 "button has no accessible name"；开"减少动态效果"后 `data-at-motion` 为降级值。

---

## 8. 优先级总览（P0/P1/P2 一张表）

| 级 | 条目 | 目标 | 落点 | 验收锚点 |
|---|---|---|---|---|
| **P0** | §2 全组件状态规范表 | 大窗看起来是一个产品 | 大窗全部组件 CSS → 统一语义令牌 | `check:css-hex` 绿；状态处色值全 `var()` |
| **P0** | §2.3 深色禁用态口径 | 禁用不违背纯白硬口径 | `tokens.css` 按主题给禁用令牌 | 暗色禁用文字仍白、底回落 bg-panel |
| **P0** | §2.4 Primary 字阶 | 一屏一个视觉重心 | Primary=display24、统计卡数字降18 | 一屏 display 档仅 1 个 |
| **P0** | §4.1 首页三级 | 一眼读到今日计时 | `defaultLayout.ts` 出厂坐标 | timer `x===24&&y===24`；layout 测试绿 |
| **P0** | §4.2 数据概览三级 | 一主图两辅 | `Data.tsx`/`data.css` 顺序高度 | 趋势高度≥热力；目的地在后 |
| **P0** | §4.3 设置三级 | 高频先触达 | 无改动（现状达标） | `SETTINGS_GROUPS[0].id==="tracking"` |
| **P0** | §6.2 重复入口识别 | 单项编辑唯一 | 统一 `AppTagDialog` | 仅一套单项分类编辑弹层 |
| **P0** | §6.3 A/B 流程 | 0 跳看统计、单击切事项 | 冷启动默认 dashboard；`useItemTimerToggle` 已实现 | `currentView==="dashboard"`；双击一次意图 |
| **P0** | §7 面板/控件状态机 | 错误不整页覆盖、不可逆有确认 | `Dashboard.tsx` 七态显式化 | E5 须 `error&&!hasAnyData` |
| **P1** | §3.1 窗口尺寸三源联动 | 不占屏 | `main_window.rs`+hook+`tiers.css`+测试 | 4 常量命中；画布不裁 |
| **P1** | §3.2 内容最大宽 | 大屏不稀释 | `topbar.css`/`AppShell.tsx`+token | 1600 宽主列停 1280 居中 |
| **P1** | §3.4 多尺寸/DPI | 任意窗宽稳定 | 容器查询/逻辑像素断档 | 100/125/150% 无横向滚动 |
| **P1** | §5.1 区域对齐 | 分布均衡 | 布局 CSS + "整理"吸附 | 卡 `(x,y,w,h)%8===0` |
| **P1** | §5.2 列数断档（数据页） | 响应式列数 | `quiet-pro.css` `.data-app-metric-strip` | @container 命中、首页回归不变 |
| **P1** | §5.3 留白节奏 | 无空卡占位 | 布局 CSS | 同网格 gap 单值；强调面板≤2 |
| **P1** | §6.2 入口合并落地 | 减少重复操作 | `AppTagDialog` 调用点收敛 | 单项编辑同组件 |
| **P1** | §6.3 C 流程 | 改设置一步定位 | `SettingsGroupNav`+`QuietPageToolbar` | 锚点 `aria-current`；保存常驻 |
| **P2** | §2.3 禁用态令牌化落地 | 一次性收口 | `tokens.css`+组件逐个引用 | 组件 `:disabled` 不含文字 opacity |
| **P2** | §3.3 文字测量宽 | 长文可读 | `about.css`+token | 每行≤~68 字符 |
| **P2** | §5.4 首屏权重 2:5:3 | 首屏聚焦 | 首屏编排/出厂坐标 | 首屏重点仅 {timer,trend,apps} |
| **退回** | 改 `dashboard.css:71` `.at-grid` | — | 死代码，勿改 | `dashboardBoardLayout.test.ts:38` |

---

## 9. 实施批次（每批可独立提交、过 `npm run check`）

> 约束：单文件 ≤600 有效行、分层只能向下、IPC 契约不动、组件 CSS 0 裸 hex。本方案改 CSS/令牌/默认布局数据 + 4 个 Rust 尺寸常量，不碰 IPC。

| 批 | 内容 | 产出判据 |
|---|---|---|
| **B1（P0 风格）** | §2 全组件状态锁语义令牌（不含禁用态令牌化大改）+ §2.4 字阶：统计卡数字降 18、Primary 走 display24 | `check:css-hex` 绿；一屏 display 仅 1 个 |
| **B2（P0 层级）** | §4.1 `defaultLayout.ts` 出厂坐标三级 + §4.2 数据概览顺序高度 | `layout.test.tsx`/`savedDefault.test.ts` 绿；趋势≥热力 |
| **B3（P0 状态机）** | §7 七态显式标注 + 导航 `aria-current` 核对 + §6.2 入口识别（仅标注，落地入 B6） | E5 判据断言；`aria-current` 计数=1 |
| **B4（P1 尺寸）** | §3.1 三源联动（`main_window.rs` 4 常量 + hook 2 常量 + `tiers.css` 派生 + 同步测试） | `rg` 新值命中 4；`check:size` ≤670；`npm test` 绿 |
| **B5（P1 限宽/密度）** | §3.2 `--at-content-max:1280` + §3.3 `--at-text-measure:68ch` + §5 对齐/留白 | token `rg` 命中；`check:build` 绿 |
| **B6（P1 入口/流程）** | §6.2 `AppTagDialog` 调用点收敛 + §6.3 C 流程核对 | 单项编辑同组件；保存常驻 |
| **B7（P2）** | §2.3 禁用态令牌化（`tokens.css` 按主题）+ §5.2 数据页列数断档 + §5.4 首屏权重 | 组件 `:disabled` 不含文字 opacity；@container 命中 |

每批独立提交，`更新日志.md` 追加流水，末位版号 +1（升 0.12.x）。

---

## 10. 门禁总清单（每批提交前必过）

- `npm run check:size`：盯 `main_window.rs`（冻结 670，只许改数字）；改动 CSS 均距 600 有余量（dashboard.css 257 / app-shell.css 281 / about.css 361 / tokens.css 311 / data.css 224）。
- `npm run check:css-hex`：组件 CSS 0 裸 hex；禁用态"硬白"必须经 `tokens.css` 令牌。
- `npm run check:layers`：本案改动都在各自层内。
- `npm run check:contract`：本案不碰 IPC，应恒绿。
- `npm run check:doc-numbers`：`AGENTS.md` 无硬编码窗口尺寸，改尺寸不触发。
- `npm test`：重点回归 `dashboardBoardLayout.test.ts`、`useMainWindowSizeMemory.test.ts`、`layout.test.tsx`、`settingsGroups.source.test.ts`、`useItemTimerToggle.test.ts`。

> 注：前端校验为**静态查证**（读脚本源码与 allowlist），未实际运行 `npm run check`/`npm test`；实现阶段每批提交前须真实跑一遍。

---

## 11. 附：三份阶段产出索引

- 视觉方向（Phase 1，含修订版聚焦大窗 + Primary 字阶收口）：本文 §2、§3、§5 的视觉数值来源。
- 体验规范（Phase 2）：`docs/Timing-大窗体验规范-P2-ux.md`（信息层级/入口/流程/状态机/a11y 全文）。
- 工程落地校验（Phase 3）：`docs/Timing-大窗工程落地校验-P3-fe.md`（逐条行号 + 三处纠偏 + 门禁清单）。





