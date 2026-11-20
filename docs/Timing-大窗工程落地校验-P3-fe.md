# Timing 大窗 UI 优化 · Phase 3 前端落地校验报告

> 角色：前端工程专家（fe）｜本轮只做可执行性校验与验收标注，**未改任何代码、未提交**。
> 校验方式：只读查证仓库（Glob/Grep/Read）。下面每条都标了实际落点与行号。

## 0. 结论速览（先看这里）

| 改动项 | 落点属实？ | 可执行？ | 关键风险/纠偏 |
|---|---|---|---|
| 窗口尺寸 1100×736→1040×680 / 900×636→860×600 | ✅ 属实 | ✅ 可执行 | **漏了第三处**：`tiers.css` 的派生常量（1052/636、860/552、阈值 735.98）必须同批改，否则画布与窗口对不上 |
| `--at-content-max:1280` 主列限宽 | ✅ shell 现状无 max-width | ✅ 可执行 | 目标元素应是 `.at-shell`；dashboard 走 `--at-board-w` 不受影响 |
| `--at-text-measure:68ch`（about） | ✅ 属实 | ✅ 可执行 | about.css 有余量；需指明作用到 `.about-center-panel` 文本块 |
| 信息密度两档（阈值 1040 宽） | ⚠️ **部分不符** | ⚠️ 有冲突 | 密度 token 实际在 `tiers.css` 非 dashboard.css；现状按**窗高**切档非窗宽，padding 现状是 20 非 16；与 v3「整体 zoom」设计冲突 |
| 统计卡网格 `repeat(4,minmax(0,1fr))` @ dashboard.css:71 + @container 列数断档 | ❌ **落点错误** | ❌ 该元素是死代码 | `.at-grid` 是 v2 残留，测试断言渲染结果**不得包含** `at-grid`；真正的 4 列网格在别处 |
| 容器查询 @container 技术可用 | ✅ 属实 | ✅ 可执行 | 仓内已 5 处在用，成熟 |
| 出厂/重置默认布局三级信息层 | ✅ 属实 | ✅ 可执行 | 落点 `defaultLayout.ts` DEFAULT_LAYOUT；归一化优先读存档已实现 |
| settingsGroups 五组现状即达标 | ✅ 属实 | ✅ 无需改 | `SETTINGS_GROUPS[0].id==="tracking"` 已成立 |
| useItemTimerToggle 停当前+开目标合一 | ✅ 属实 | ✅ 已实现 | 无需改 |
| 深色禁用态不降透明度 | ✅ 可执行 | ✅ 可执行 | 需逐组件核查 `:disabled{opacity}`，见 §7 |

---

## 1. 窗口尺寸 1100×736→1040×680 / 900×636→860×600

### 落点确认（实际查到）
- `src-tauri/src/app/activity/main_window.rs:25-28`
  ```rust
  const MAIN_WINDOW_WIDTH: f64 = 1100.0;      // → 1040.0
  const MAIN_WINDOW_HEIGHT: f64 = 736.0;      // → 680.0
  const MAIN_WINDOW_MIN_WIDTH: f64 = 900.0;   // → 860.0
  const MAIN_WINDOW_MIN_HEIGHT: f64 = 636.0;  // → 600.0
  ```
  消费点在 `main_window.rs:439-440`（`.inner_size()` / `.min_inner_size()`）。
- `src/windows/activity/shell/hooks/useMainWindowSizeMemory.ts:30-31`
  ```ts
  export const MIN_WINDOW_WIDTH = 900;   // → 860
  export const MIN_WINDOW_HEIGHT = 636;  // → 600
  ```
  这两个常量参与 `clampWindowSize()`（:66-67）与落盘跳过判据（:89）。记忆存**逻辑像素**（文件头注释已确认 DPI-safe），改下界只影响"更小不记"，不影响已存档老用户。

### ⚠️ 方案遗漏（纠偏，必须补）
视觉方案只提了 2 个文件，但尺寸是**三源联动**，第三处被漏掉：

- `src/windows/activity/shell/styles/tiers.css:10-15, 24-25, 109-114` 把窗口尺寸硬算成了画布派生常量，且注释明文写了"一旦 `main_window.rs:29` 改动必须同批改"：
  - `--at-board-w: 1052px`（= 1100−2×24）→ 新值 **992**（= 1040−2×24）
  - `--at-board-h: 636px`（= 736−52−2×24）→ 新值 **580**（= 680−52−2×24）
  - 短档 `@media (max-height: 735.98px)` 阈值（:109）→ 需重算为新默认高对应值（约 **679.98**）
  - 短档 `--at-board-h: 552px`（:114，= 636−44−2×20）→ 新值 **516**（= 600−44−2×20）

  若只改 main_window.rs + hook 而漏掉 tiers.css，症状是：窗口变小了但画布版式仍按 1052/636 排，右侧/底部被裁或留白错位。**这是本项改动最大的坑**。

### 可执行性
- 不违反分层：Rust 常量在 L10 以外的 app 层，CSS 在 shell 层，各自独立。
- 不违反契约：纯尺寸常量，不碰 IPC。
- **体积风险**：`main_window.rs` 已在 size-allowlist 冻结为 **670 行**（棘轮只减不增）。本项是等值替换数字，有效行不变，安全。但**同文件内任何顺手重构都会触发棘轮报红**，务必只改这 4 个数字。
- `tiers.css` 是全仓唯一允许写魔法数字的样式文件（注释 §2.6 授权），改派生常量合规，无 css-hex 风险（都是 px 不是 hex）。

### 验收标准
- `rg -n "1040\.0|680\.0|860\.0|600\.0" src-tauri/src/app/activity/main_window.rs` 命中 4 条；旧值 0 命中。
- `useMainWindowSizeMemory.test.ts` 现有断言引用 `MIN_WINDOW_WIDTH/HEIGHT`（:38-39）与注释里的 "1100×736"（:20），**改常量会让该测试里的注释/期望漂移** → 需同批更新测试期望值，否则 `npm test` 红。
- `npm run check:size` 通过（main_window.rs ≤670）。
- 人工：900 宽以下不可再缩；默认开窗 1040×680 居中。

---

## 2. 内容最大宽 `--at-content-max:1280px`（shell 主列限宽）

### 落点确认
- `src/windows/activity/shell/styles/topbar.css:234-240` 定义 `.at-shell { padding: var(--at-shell-pad); }`，**确认现状无 content max-width**，主列宽度完全跟随窗口。
- `.at-shell` 的 DOM 在 `AppShell.tsx:206`：`<div className="at-shell flex-1 min-h-0 flex overflow-hidden">`。

### 可执行性 ✅
- 新增一个 token + 在 `.at-shell` 或其主内容子节点加 `max-width:var(--at-content-max); margin-inline:auto`，不违反任何门禁。
- token 定义位置建议放 `tiers.css`（魔法数字授权文件）或 `tokens.css`。
- **注意**：dashboard 画布自己走 `--at-board-w`（min(1052,100%)），它不吃 shell 的 content-max；1280 只影响 data/settings/mapping/about 这些跟随窗宽的视图。设计意图应是"超宽屏时正文不无限拉伸"，与 dashboard 不冲突。1280 > 1040 默认宽，故默认窗口下该限宽**不生效**，只在用户手动拉宽/最大化时起作用——符合预期。

### 验收标准
- `rg -n "at-content-max" src/windows/activity/shell/styles/` 命中 token 定义 1 处 + 消费 1 处。
- 人工：窗口拉到 1600 宽，data/settings 主列停在 1280 居中，左右留白对称。
- `npm run check:css-hex` 通过（px 值非 hex，不触门禁）。

---

## 3. 纯文字测量宽 `--at-text-measure:68ch`（about）

### 落点确认
- `src/windows/activity/shell/styles/features/about.css`，有效行 **361**（距 600 余量充足）。
- 文本块在 `AboutPanel.tsx:54` 的 `.about-center-panel`；现状 `.about-center-profile`/`.about-pill-row` 已用 `width:min(560px,100%)` 限宽（about.css:16,71），但正文段落 `.about-center-profile p`（:56-62）跟随容器。

### 可执行性 ✅
- 加 token + 对正文容器设 `max-width:var(--at-text-measure)` 即可。68ch 合规。
- 无体积/分层/契约/hex 风险。

### 验收标准
- `rg -n "at-text-measure" src/windows/activity/shell/styles/features/about.css` 命中。
- 人工：about 页正文每行不超过 ~68 字符。

---

## 4. 信息密度两档（标准 vs 紧凑，阈值 1040 宽） — ⚠️ 与现状多处不符

### 实际查到的现状（与方案描述有出入）
1. **密度 token 不在 dashboard.css / dashboard-layout.css**，而在 `tiers.css:31-33`：
   ```css
   --at-card-gap: 16px;    /* 方案说"标准 16 / 紧凑 12"——现状只有一档 16 */
   --at-card-pad: 20px;    /* 方案说"padding 16/12"——现状是 20，不是 16 */
   --at-card-pad-b: 16px;
   ```
   行高相关是 `--at-row-items:30 / --at-row-app:38 / --at-row-todo:32`（tiers.css:80-83），不是方案说的"行30/行26"单一值。

2. **现状切档维度是窗高不是窗宽**：`tiers.css:109` 的断点是 `@media (max-height: 735.98px)`，注释（:111）明确写"`--at-board-w` 不在短档改写：它是宽度 token，宽度断点不该由高度断点决定"。方案要"窗宽阈值 1040 自动切"与现有口径**正面冲突**。

3. **v3 画布是整体 zoom 缩放**（`contract.ts:12-15`、`tiers.css:28-30, 122-124`）：卡内行高/内距被设计成**逐值锁死 timing-board.exe**，窗口变化由 `useBoardZoom` 的 `transform:scale` 承担，而不是换一套 padding/gap。注释原文："这里再压一套短档值，同一张卡就会在矮窗里换一套行距，正是'和 Rust 版对不上'的来源"。

### 纠偏建议
- dashboard（首页画布）**不应**引入窗宽密度档——它与 v3 zoom 架构冲突，且会破坏"与 exe 逐值一致"的既有验收。若主理人坚持密度两档，范围应**限定在非画布视图**（data/settings/mapping 的 `.at-shell` 内容区），那里才是跟随窗宽、可安全切 padding/gap 的地方。
- 若确需在画布上做，须与视觉(Phase1)确认是否放弃"卡内与 exe 逐值一致"这条既有硬验收——这是架构级取舍，**不能由前端静默决定**。
- padding 基准请以现状 **20** 为准，不是方案写的 16；两档若保留，建议 标准20/紧凑16、gap 16/12。

### 可执行性
- 技术上 `@container`/`@media (max-width)` 都能实现两档切换，无门禁障碍。
- 但**语义冲突**使这条成为全案最大争议点，建议降级到 P2 并先对齐设计口径。

### 验收标准（若限定在非画布视图落地）
- `rg -n "max-width: 1039" src/windows/activity/shell/styles/` 命中切档断点。
- 人工：data/settings 视图窗宽 <1040 时 padding/gap 收紧一档；画布首页**不变**（回归 `dashboardBoardLayout.test.ts`）。

---

## 5. 统计卡网格 + @container 列数断档 — ❌ 落点错误（重要纠偏）

### 方案说法
"统计卡网格维持 `repeat(4,minmax(0,1fr))`（dashboard.css:71，别改成固定宽），列数随窗宽断档用 @container：≥1200→4 / 1040-1199→4 / 860-1039→3 / <860→2。"

### 实际查到 —— dashboard.css:71 的 `.at-grid` 是 **v2 死代码**
- `dashboard.css:69-77` 确有 `.at-grid { grid-template-columns: repeat(4, minmax(0,1fr)); grid-auto-rows: var(--at-grid-row); }`。
- 但 `Dashboard.tsx:176-184` 渲染的是 `.at-main-view > <DashboardBoard>`（v3 自由摆位绝对定位画布），**根本不渲染 `.at-grid`**。
- 回归测试 `dashboardBoardLayout.test.ts:38` 明确断言：
  ```ts
  expect(dashboard).not.toContain("at-grid");   // v2 网格容器彻底下线
  ```
  注释（:37）："v2 的网格容器彻底下线：留着它就是两套定位在抢同一批卡片"。
- `contract.ts:1-19` 说明首页已从"4 列网格"换成"固定宽画布 + 卡片绝对坐标(x/y/w/h)"。

**结论**：首页根本没有"随窗宽变列数的统计卡网格"。卡片位置由 `defaultLayout.ts` 的绝对坐标决定，窗口变化由用户控制的 zoom 承担，不会自动改列数。按方案去改 `.at-grid` 的 @container 是**改一段不渲染的死 CSS**，零效果且违背测试意图。

### 真正存在的 4 列网格（供参考，可能是方案想指的对象）
- `quiet-pro.css:1241` `.data-app-metric-strip { repeat(4,minmax(0,1fr)) }` —— 这是**数据页**应用面板的指标条，不是首页统计卡。
- `history-range.css:53`、`settings-data-export.css:67` 也各有 repeat(4) 网格，均非首页。

### 纠偏建议（二选一，需主理人/视觉定夺）
1. 若目标是"首页卡片随窗变列数" → 与 v3 画布架构冲突，**不做**，或改为调整 `defaultLayout.ts` 出厂坐标（见 §6）。
2. 若目标其实是"数据页应用面板指标条/卡片响应式列数" → 落点改为 `quiet-pro.css:1239` `.data-app-metric-strip`，可安全加 @container 断档。现状该处已有 `data.css:141` 的 `@media (min-width:901px) and (max-width:1899px)` 响应式处理，需避免与之打架。

### @container 技术本身 ✅ 成熟可用
仓内已 5 处在用，确认属实：
- `dashboard-card-fit.css:17,28`（container-type:size）
- `dashboard-heatmap.css:28,181`、`dashboard-modules.css:197`
- `dashboard-notes.css:32,97`（inline-size + `@container (max-width:470px)`）
- `note.css:35`
兼容性：Tauri 固定 WebView2（Chromium ≥105 含 @container），无兼容问题。

---

## 6. 首页/数据/设置三级信息层

### 6.1 首页出厂默认布局（Primary/Secondary/Tertiary）
- **落点确认**：`src/windows/activity/features/dashboard/layout/defaultLayout.ts:18-32` 的 `DEFAULT_LAYOUT.cards`。现状出厂坐标：
  - timer: `x:24, y:24, w:340, h:304`（已在首列左上，M 档）——符合体验"Primary=timer 放首列左上 x=24"。
  - apps `x:380,y:24`、trend `x:726,y:24`（Secondary 同顶行）
  - timeline `x:24,y:344`、manage `x:380,y:344`、heatmap `x:726,y:344`、notes `x:726,y:584`（Tertiary 下沉）
- **可执行性** ✅：只改这一个常量对象的 x/y/w/h/tier，纯数据。文件仅 ~58 有效行，无体积风险。
- **归一化不回拨老用户**：`layoutStore.ts:150-153` `loadDefaultLayout()` = `loadSavedDefault() ?? cloneDefaultLayout()`，确认**优先读用户存档**，只有从未存过才落出厂布局——符合体验"不回拨老用户"。改 DEFAULT_LAYOUT 只影响新用户/恢复默认。
- **验收标准**：
  - `savedDefault.test.ts` / `layout.test.tsx` 回归通过。
  - 断言 `DEFAULT_LAYOUT.cards.find(c=>c.kind==="timer")` 的 `x===24 && y===24`。
  - 改坐标须保证无重叠且在 BOARD_W(1250)×BOARD_H(820) 内（`geometry.test.ts` 吸附 8px）。

### 6.2 数据概览三级（趋势主图 ≥ 热力，目的地 DataAppTrendPanel 在后）
- **落点确认**：`src/windows/activity/features/data/components/Data.tsx` + `DataAppTrendPanel.tsx`（均存在）；样式 `data.css` / `quiet-pro.css`。
- **可执行性** ✅：调 CSS 高度/顺序即可，`data.css` 有效行 224、距 600 充足。
- 注意 `data.css:141` 已有 `@media (min-width:901px)-(1899px)` 的 `.data-app-panel` 堆叠规则与 `--data-stacked-panel-height`，调整高度时不要与其打架。
- **验收**：人工核查趋势图容器高度 ≥ 热力图；DOM 顺序 DataAppTrendPanel 在趋势/热力之后。

### 6.3 设置三级（五组现状即达标）
- **落点确认**：`src/windows/activity/features/settings/settingsGroups.ts:32-56`，`SETTINGS_GROUPS[0].id === "tracking"`（计时行为）——**已成立，无需改动**。
- 顺序：tracking → appearance → pill → data → (第五组 general/startup)。注释（:10-14）警告"别照旧注释把 pill 挪回第一组"。
- **验收**：`settingsGroups.source.test.ts` / `settingsConvergence.source.test.ts` 已覆盖，`npm test` 通过即达标。**本项零改动**。

---

## 7. 全组件状态表 + 深色禁用态不降透明度

### 落点确认
- 禁用态散落在各组件 CSS 的 `:disabled { opacity: ... }`。实查到的样例：
  - `app-shell.css:85-88` `.at-color-trigger:disabled { cursor:not-allowed; opacity:0.58 }`
  - `app-shell.css:176-179` `.at-color-eyedropper:disabled { cursor:not-allowed; opacity:0.55 }`
- 现状普遍用 `opacity` 降透明度——**与体验"深色禁用态不降文字透明度（硬白），改降背景对比(回落 bg-panel)+cursor:not-allowed；浅色才用 text-tertiary"冲突**。

### 可执行性 ⚠️ 需逐组件 + 需暗/亮分流
- 实现需 `:root[data-theme="dark"] .xxx:disabled` 与浅色分开写，或用语义令牌在 tokens.css 里按主题给 `--at-text-disabled` / `--at-disabled-bg` 不同值，再让组件统一引用，避免逐个组件写两套。
- **风险1（css-hex 门禁）**：禁用态若要"硬白"，不能在组件 CSS 写 `#fff`（`check:css-hex` 会红，组件层 0 裸 hex）。必须经 `tokens.css`（允许名单，见 `check-css-hex.mjs:45`）定义令牌，组件只引 `var()`。
- **风险2（工作量）**：`rg -n ":disabled" src/windows/activity/**/*.css` 命中面较广，逐个改是 P2 级体量，建议统一走令牌一次性收口。
- **风险3（体积）**：若集中到 tokens.css（现 311 有效行）新增禁用令牌，离 600 远，安全。

### 验收标准
- `rg -n "opacity" src/windows/activity/shell/styles/**/*.css | rg ":disabled"` —— 暗色禁用态不得靠 opacity 降文字；应命中背景令牌回落。
- 新增门禁建议（可选）：脚本断言组件 `:disabled` 块不含 `opacity` 对文字生效。
- 人工：暗色主题下禁用按钮文字仍为纯白、背景回落 bg-panel、cursor:not-allowed；浅色下文字为 text-tertiary。

### 刻度继承（间距/圆角/字号/字重/阴影/z）
- 已在 `tiers.css` + `tokens.css` 成体系（字阶 tiers.css:99-106，圆角/阴影令牌在 tokens.css）。本项主要是**核对齐全**，非新建，归 P2 文档核对。

---

## 8. 大窗面板七态状态机 + 导航 aria-current + 可编辑禁用 gate

### 落点确认
- 读取状态机现状：`Dashboard.tsx:150-174` 已有 `data-dashboard-read-state={readState.status}`、`showPageError`、`hasAnyData` 分流（整页失败判据 `error && !hasAnyData` 对应体验的 E5/E2/E3 区分，:162 `hasAnyData ? refreshFailed : readFailed`）——**七态骨架已部分存在**。
- 数据页 face 切换：`DataHistoryFaces.tsx:49,65`（`data-data-face-body`）。
- 导航 aria-current：`AppTopNav.tsx` tab 渲染处需核 `aria-current="page"` 恰一个。
- 可编辑禁用 + pending gate：`useItemTimerToggle.ts` 的 `busyRef`（文件头 §连点两重保险 :28-32）已实现"一发一收之间再点直接丢弃"——**pending gate 已实现**。保存/取消常驻在 `QuietPageToolbar.tsx` + `SettingsHeaderActions.tsx`。

### 可执行性 ✅（多为核对/补齐，非新建）
- 七态多数已有骨架，缺口是把 loading/刷新中/焦点恢复等做显式标注。无分层/契约障碍。
- `useItemTimerToggle` 停当前+开目标合一：文件头 :13-18 已实现 `stop_timer` / `start_timer_for_item` 双意图合一——**体验所述已达标，无需改**。

### 验收标准（对齐到可判据）
- 导航：`document.querySelectorAll('[aria-current="page"]').length === 1`。
- 整页错误：仅当 `error && !hasAnyData` 出现整页 E5（现状 `Dashboard.tsx:160-162` 已满足，加测试断言）。
- pending gate：快速双击 manage 行只触发一次意图（`useItemTimerToggle.test.ts` 已覆盖，核对）。
- 不可逆操作强制 confirm：核查删除类操作有 confirm 弹层。

---

## 9. 工作量分批建议（每批可独立提交、过 `npm run check`）

### P0（低风险、强用户价值、落点清晰）
1. **窗口尺寸三源联动**（§1）：main_window.rs 4 常量 + useMainWindowSizeMemory.ts 2 常量 + **tiers.css 派生常量(992/580/516/阈值)** + 同步更新 `useMainWindowSizeMemory.test.ts` 的期望与注释。
   - 单独一批，跑 `npm run check:size`（main_window.rs ≤670）+ `npm test`。
2. **出厂默认布局三级**（§6.1）：仅改 `defaultLayout.ts` 的 DEFAULT_LAYOUT 坐标；跑 `layout.test.tsx` / `savedDefault.test.ts`。

### P1（新增 token、作用面可控）
3. `--at-content-max:1280`（§2）+ `--at-text-measure:68ch`（§3）：新增 token + `.at-shell` 主列限宽 + about 正文限宽。跑 `check:css-hex` + `check:build`。
4. 数据/设置三级核对（§6.2，§6.3 零改动）。

### P2（争议大 / 体量大 / 需先对齐设计）
5. **深色禁用态令牌化**（§7）：tokens.css 定义禁用令牌 + 组件逐个改引用。体量大，经 tokens.css 规避 css-hex。
6. **信息密度两档**（§4）：**先与视觉对齐口径**（是否放弃画布"与 exe 逐值一致"），确认后仅在非画布视图落地。
7. 面板七态显式标注补齐（§8）。

### 不做 / 退回（纠偏项，需主理人确认）
- ❌ **改 dashboard.css:71 `.at-grid` 的 @container**（§5）：该元素是 v2 死代码、测试断言不得渲染。如需列数响应式，落点应改到数据页 `.data-app-metric-strip`，或通过 §6.1 出厂坐标达成，而非改首页网格。

---

## 10. 门禁总清单（每批提交前必过）
- `npm run check:size`：重点盯 `main_window.rs`(冻结670) 与改动的 CSS 文件（均距 600 有余量：dashboard.css 257 / dashboard-layout.css 223 / dashboard-notes.css 213 / app-shell.css 281 / about.css 361 / tokens.css 311 / data.css 224）。
- `npm run check:css-hex`：组件 CSS 0 裸 hex；禁用态"硬白"必须经 tokens.css 令牌。
- `npm run check:layers`：本案改动都在各自层内，无跨层风险。
- `npm run check:contract`：本案不碰 IPC，应恒绿。
- `npm run check:doc-numbers`：已查 `AGENTS.md` 无硬编码窗口尺寸(1100/736/1040 等均 0 命中)，改尺寸**不触发**该门禁。
- `npm test`（vitest）：重点回归 `dashboardBoardLayout.test.ts`、`useMainWindowSizeMemory.test.ts`、`layout.test.tsx`、`settingsGroups.source.test.ts`、`useItemTimerToggle.test.ts`。

> 说明：本报告所有门禁结论为**静态查证**（读脚本源码与 allowlist 得出），未实际运行 `npm run check` / `npm test`；实现阶段每批提交前须真实跑一遍。

