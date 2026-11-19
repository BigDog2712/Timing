# Timing UI 重构 · Phase 1 视觉方向规范

- 日期：2026-11-19 · 作者：视觉（米拉）· 状态：待 team-lead 对齐
- 范围：主窗（悬浮条/圆点/把手/菜单/面板/便利贴）+ 分析窗（activity）的视觉令牌与规范
- 定位：在 `PLAN-20261119-UI重构设计方案.md` 的结构之上深化**视觉部分**，不改交互流程、不写代码
- 基准（已确认）：A1 收起=收窄小圆点 dot / A2 药丸上限 384 中间省略 / A5 语义令牌以分析窗 `--color-*` 体系为基准，主窗向它对齐 / 深色默认、浅色对等验收

---

## 1. 视觉基调与参考

### 1.1 一句话定位
**一条安静的时间线**：悬浮条是桌面上视觉重量最低的常驻元素，用户不看它时它近乎隐形，需要时一眼读完。颜色只为「状态」服务，不做装饰。

### 1.2 三个借鉴点（说清借鉴什么、不借鉴什么）
| 参考 | 借鉴 | 不借鉴 |
|---|---|---|
| Linear（深色克制） | 中性灰阶拉层级、单一强调色、零多余投影 | 它的高饱和紫渐变与发光描边 |
| macOS 灵动岛 / Dynamic Island | 药丸↔圆点同一物体的宽度形变，形变即状态 | 它的弹性回弹缓动（本项目禁弹跳） |
| Arc / Raycast 命令条 | 紧凑行高、图标线性统一、hover 才露功能 | 它的彩色��牌渐变与大圆角卡片 |

### 1.3 落到本项目的硬约束（继承现状，不可协商）
- 深色文字一律纯白 `#FFFFFF`、零透明度（用户明确口径「看不清」），层级感改由**字号/字重/留白**承担，不靠灰阶。浅色才有四级墨色灰阶。
- **整体无投影**：主窗所有 `--shadow-*` 已为 `none`，层次靠 1px 描边（`--shadow-ring`）与底色差。本规范新增阴影档**仅给分析窗**，主窗维持平面。
- 动效只动 `opacity`/`transform`，禁 `width/height/font-size/filter/backdrop-filter` 动画，禁弹性缓动，尊重 `prefers-reduced-motion`。
- 计时数字 `.timer-digits` 等宽 + `tabular-nums` 规则不动。

### 1.4 四条视觉设计原则
1. **状态即颜色**：中性面上只有一处彩色，且必然对应计时状态或语义（成功/警告/危险）。没有「品牌色块」。
2. **形变承载状态**：idle/running/paused 不靠额外图标提示，靠药肉宽度、圆点存在与否、一处强调色的明灭来区分。
3. **层级靠排版不靠阴影**：字号差 + 字重 400/700 二档 + 留白 + 1px 描边，足以分出主次；深色不用灰阶降级文字。
4. **双主题对等**：浅色不是「顺带支持」，每条色值都给出深/浅两套并各自过对比度门槛。


---

## 2. 语义令牌：单一真源

### 2.1 三层结构
```
第一层 primitives（原始调色板，唯一允许写裸 hex 的地方）
   ↓  仅被语义层引用，组件禁止直接引用
第二层 semantic（语义令牌：bg/text/border/accent/success/warning/danger/participation）
   ↓  按主题 dark/light 给值；组件只认这层的语义名
第三层 component alias（B-slot：--btn-* / --menu-* / --todo-* …）
   ↓  组件 CSS 只引用这层或语义层
```
主窗现状已是 `01-primitives → 02/03-theme → 04-aliases` 三层，分析窗是 `--at-*(值) → --color-*(Tailwind @theme 映射)`。**两套都保留自己的三层，但第二层语义名统一命名、互为 alias。**

### 2.2 统一语义色名清单（8 组）
以分析窗 `--color-*` 的命名骨架为基准（覆盖更全、已是 Tailwind 体系），主窗向它对齐：

| 统一语义名 | 含义 | 主窗现名 `--*` | 分析窗现名 `--at-*` / `--color-*` |
|---|---|---|---|
| `bg-app` | 最底画布 | `--bg-plate` | `--at-bg-app` / `--color-bg-app` |
| `bg-panel` | 面板/卡底 | `--bg-panel` `--bg-card` | `--at-bg-panel` / `--color-bg-panel` |
| `bg-elevated` | 浮起层（菜单/输入高亮） | `--bg-field-hi` `--bg-inset` | `--at-bg-elevated` / `--color-bg-elevated` |
| `text-primary` | 主文字 | `--ink` | `--at-text-primary` / `--color-text-primary` |
| `text-secondary` | 次文字 | `--ink-2` | `--at-text-secondary` |
| `text-tertiary` | 弱文字/占位 | `--ink-3` `--ink-4` | `--at-text-tertiary` / `--at-text-disabled` |
| `border-subtle` / `border-strong` | 细线 / 强线 | `--line` `--line-2` / `--line-3` | `--at-border-subtle` / `--at-border-strong` |
| `accent` / `accent-muted` | 强调（running） | `--accent` / `--accent-wash` | `--at-accent-default` / `--at-accent-muted` |
| `success` | 成功/完成（done） | `--ok` | `--at-success` / `--color-success` |
| `warning` | 警告/告警（倒计时） | `--warn` | `--at-warning` / `--color-warning` |
| `danger` | 危险/结束 | `--danger` | `--at-danger` / `--color-danger` |
| `participation` | 参与度/热力 | （主窗现无，用 `--violet` 近似） | `--at-participation` / `--color-participation` |

### 2.3 alias 对齐方式（B1 阶段：零像素变化）
B1 的铁律是**先统一命名、不动渲染值**，截图逐像素 diff 必须无差：
- 新建一层「跨窗语义桥」令牌（命名如上表第一列）。**它的值 = 各窗当前主题下的实测色**，对深色主窗即 `--accent:#4DA3E8` 等，对分析窗即其 JS 注入的 `--at-*` 实测值。
- 两窗各自的 `--*` 与 `--at-*`/`--color-*` 改为**指向**语义桥（`var(--accent) → var(--sem-accent)`），渲染结果不变。
- 数值校准（如主窗 running 蓝与分析窗 accent 蓝是否统一为同一 hex）留到 **B 后续批次**单独做，带独立 diff 验收，不混进 B1。

> **实施约束修正（2026-11-19，fe 落地时发现）**：分析窗的 `--at-*` 令牌**不在 CSS 里定义**，而是由 `deriveTheme.ts` + `applyHostAccents.ts` 在 JS 里算出、经 `useAppThemeMode.ts` 的 `root.style.setProperty()` 写成 `:root` **行内样式**。行内样式特异性高于任何样式表 `:root` 规则，因此 CSS 语义桥**无法**把 `--at-*` 反向重指到桥上（本节字面描述的 `var(--at-*) → var(--sem-*)` 方向只有主窗那套纯 CSS 令牌能做）。B1 实际落地改为**两窗对称的加法别名层**：`--sem-*` 读各窗原生、随主题实时变化的令牌（主窗 `--sem-*` ← `--ink/--accent/--ok…`，分析窗 `--sem-*` ← `--at-*`），组件在 B2+ 迁到 `--sem-*`。效果等价于统一命名、纯 `var()` 间接引用 ⇒ 逐像素零变化，且不碰主题 JS、保留动态换肤。真正的数值归一（主/分析窗同一 hex）需动 `deriveTheme` 的 `DEFAULT_CONTROLS` 常量（JS，非 CSS），属**独立 opt-in 批次**，带独立像素 diff 与显式签字，本轮不做。

> **实施约束修正（2026-11-19 · fe 落地发现）**：分析窗 `--at-*` 令牌**不在 CSS 中定义**，由
> `deriveTheme.ts` + `applyHostAccents.ts` 计算后经 `useAppThemeMode.ts` 的 `root.style.setProperty()`
> 写成 `:root` **行内样式**。行内样式特异性高于任何样式表 `:root` 规则，故 CSS 桥层**无法**把
> `--at-*` 反向重指到桥（本节字面描述的 `--at-* → var(--sem-*)` 方向仅主窗那套纯 CSS 令牌可行）。
> B1 已改为**两窗对称的加法别名层**：`--sem-*` 读各窗原生令牌（主窗读 `--ink/--accent/…`，分析窗读
> `--at-*`），组件在 B2+ 迁移到 `--sem-*`。纯 `var()` 间接引用 ⇒ 逐像素零变化，且不动主题 JS、保留
> 动态换肤。真·数值归一（统一到同一 hex）需改 `deriveTheme.ts` 的 `DEFAULT_CONTROLS` 常量（JS，非
> CSS），**列为独立 opt-in 批次**，带自己的像素 diff 与显式签字，本轮不做。

### 2.4 裸 hex 治理
- primitives 之外禁裸 hex（主窗头部已有此文字规约，但无门禁）。本阶段只定规范，门禁脚本由 fe 角色在 B2 落地。
- 现状违规：主窗 77 处、分析窗 53 处。收口目标：hex 仅存于两窗各自的 primitives / theme 文件。


---

## 3. 收敛后的刻度（单一标尺）

所有字面量就近归档到下列刻度；归档映射给 fe 做 B3 替换时照抄。

### 3.1 间距 — 4px 栅格（7 档，已存在作为唯一来源）
```
--space-1 4   --space-2 8   --space-3 12  --space-4 16
--space-5 20  --space-6 24  --space-7 32
```
归档：分析窗 `--at-space-group 14 → 12`（14 不在栅格，取近档 12；若行高压不下再个案评估 16）。`--at-space-page 24=--space-6`、`--at-space-section 20=--space-5`。

### 3.2 圆角 — 5 档
```
--radius-sm   6    chip / tag / 小控件
--radius-md   10   按钮 / 输入 / 菜单项
--radius-lg   14   面板 / 卡片（主窗 panel）
--radius-xl   18   大卡 / 分析窗 card / 拖拽态
--radius-full 9999 药丸 / 圆点 / 开关
```
归档 13 种字面量：主窗 lg 12→14（并入面板档，统一两窗卡片圆角）、button 6/8→10、drag 22→18、card 18→18。主窗 `--radius-pill=calc(h/2)`、`--ring-radius 5.6`、`--at-radius-timeline-segment 2`、`--at-window-corner-radius 8` 属几何专用值，**不进通用圆角刻度**，单列保留。

### 3.3 字号 — 7 档，消灭半像素
```
--fs-caption 10   徽标 / 极小注释
--fs-compact 11   紧凑注释 / 把手提示
--fs-body    12   正文小字 / 菜单项
--fs-label   13   正文 / 行名
--fs-section 14   分节标题 / 计时数字基准
--fs-title   18   页标题 / 大卡标题
--fs-display （独立）计时数字，沿用 .timer-digits，不进通用阶梯
```
归档半像素：主窗 `--text-sm 12.5→12`、`--text-xs 11.5→11`、`--text-mono 11.5→11`、`--text-title 15→14`（或 18，见下注）、`--text-num 14→14`、`--text-body 13→13`、`--text-cap 11→11`。
> 注：主窗 `--text-title 15` 与分析窗 `--at-font-size-group-title 15` 同档，归到 14（section）或升到 18（title）二选一——建议**归 14**，因为 15 多用于分组小标题，升 18 会变重。此项 B3 需逐像素确认后定。
分析窗 rem 档换算：compact 10 / caption 12 / body 14 / group 15→14 / section 16→自成一档或并 14 / page-title 18 / metric 24（计时类大数，走 display 规则）。

### 3.4 字重 — 2 档（实测可渲染）
```
--weight-regular  400   正文 / 一切常规文本
--weight-emphasis 700   标题 / 计时数字 / 强调
```
实测雅黑/Segoe 在本机只有 400(Regular) 与 700(Bold) 两档真实渲染，500/550/600/650 全部塌到相邻档。处理：
- 主窗 `--weight-medium 500 / --weight-semibold 600 / --weight-strong 650` 三个别名**保留名字、值一律指向 400 或 700**（read/medium→400，semibold/strong→700），避免波及 70 处引用；新代码禁用 medium/semibold。
- 分析窗 `--at-font-weight-medium` 已=400（deprecated），对齐一致。

### 3.5 阴影 — 2 档
```
--shadow-pill    悬浮条用（弱）
--shadow-panel   面板/卡片用（中）
```
- **主窗维持全 `none`**（用户口径去投影），`--shadow-pill/panel` 在主窗解析为 `none`，层次靠 `--shadow-ring`（0 模糊 1px 细线，当描边用）。
- **分析窗保留投影**：`--shadow-pill ← --at-shadow-toast`、`--shadow-panel ← --at-shadow-overlay`，深浅各一套（现有 `rgba(0,0,0,.28/.30)` 深 / `rgba(17,24,39,.08/.10)` 浅）。卡片表面层 `--at-card-shadow-rest/hover` 属卡片专用，单列保留不并入 2 档。
- 禁止组件各写 rgba 阴影，一律引用这两档或卡片专用令牌。

### 3.6 z 层级 — 6 档
```
--z-base     0    药丸 / 圆点本体
--z-handles  10   把手簇 / 滚轮提示（= 现 --z-pill）
--z-popover  20   右键菜单遮罩 / 提示条 / tooltip
--z-panel    30   右键菜单本体 / 事项 / 设置 / 面板（= 现 --z-settings）
--z-toast    40   撤销条（= 现 --z-undo）
--z-drag     50   对话框 / 提醒卡 / 拖动中浮层
```
归档现状 9 名：`--z-pill 10→handles`、`--z-panel/note 20→popover 或 panel`（note 若为独立窗不进刻度，见 PLAN A3）、`--z-settings 30→panel`、`--z-undo 40→toast`、`--z-tooltip 50 / --z-menu 60 / --z-dialog 70 → popover/panel/drag 就近归并`。15 种裸 z 字面量全部映射进这 6 档。

> **[B3 实测修正 · 已定案，覆盖上表原稿]** 原稿把 NoticeBar / 提醒卡一并归 `toast(40)` 是未核对消费点的语义猜测，落地时按真实阶梯否决。原序：`base0 / pill10 / panel20 / note20 / settings30 / undo40 / tooltip50 / menu60 / dialog70`，其中 `.notice` 与 `.menu-scrim` **同用 `--z-tooltip(50)`**（靠 DOM 次序分层），菜单本体 60，提醒卡 70。实际落库映射：`.notice → popover(20)`、`.menu-scrim → popover(20)`、`.menu → panel(30)`、`.reminder → drag(50)`，与原序 `notice=scrim(50) < menu(60) < reminder(70)` 严格同构。**结论：保序优先于字面语义**——`toast(40)` 在本项目实指"撤销条"（压在面板之上的即时反馈），而提示条是被动常驻提示，抬到 40 会盖住右键菜单首项，属真回退；提醒卡必须压过对话框遮罩，留最高档 `drag(50)`。
>
> **分析窗 z 刻意不并入 6 档**：分析窗是 0–170 细粒度阶梯（34 处声明 / 20 个不同值，含看板缩放手柄 `44/45` 保序对与浮层梯 `110/120/130/140/170`），压 6 档必然翻序、会坏功能。本轮零改动，也不建 `--at-z-*` 值不变别名（无收益、徒增间接、易被误读为已统一），仅在 `activity/shell/styles/tokens.css` 加头注声明"刻意不并"。


---

## 4. 悬浮条视觉

### 4.1 药丸三态一簇形态
同一物体三种宽度形态，**条高恒 32px、计时数字基线恒定**，形态间只过渡 `width`(morph) + `opacity`，走 `--ease-morph`，时长 `--dur-morph 280ms`：

| 形态 | 高 | 宽 | 圆角 | 内容 |
|---|---|---|---|---|
| 圆点 Dot | 33 | 33（正圆 `--radius-full`） | `--radius-full` | 开口进度环 + 环身黄点，圈内不写字；悬停出 title 读数 |
| 药丸 Pill | 32 | 自适应 116–384（A2 上限 384，超长事项名中间省略） | `--radius-full`（=16） | 环 + 事项名 + 计时数字 |
| 把手簇 Handles | 叠加 | 药丸两端各滑出 ≤16 | — | 功能按钮，hover 药丸才露 |

> 注：现状 `--pill-w-max=320`，PLAN A2 定上限 384。本规范以 **384** 为准，fe 落地时把 `--pill-w-max` 调到 384，事项名 `--task-w-max` 随之评估（现 164）。

### 4.2 收窄小圆点 Dot 的视觉规格（A1 精修）

> **[B4 实测修正 · 已定案，覆盖本节原稿]** 本节初稿（"⌀32 单色点、idle 描边 / running 实心、悬停加 1px `border-strong` 微亮"）是**未核对实现的事后描述，作废**。真实实现见 `src/windows/timing/components/ui/CollapsedDot.tsx`（300 行，含逐条用户验收口径）：⌀33 的 **开口环 + 环身黄点**，环是进度弧本身，黄点是 UI 图形起点、颜色按已计时小时换档。该图形语言经用户多轮定向验收（"环是图形语言，不应放时间"／"优化为单个黄色圆点"／"图形语言对齐 APP 图标：细框与进度弧合并成一圈主环"／"断点处蓝色为环做圆角"／"黄点为 UI 图形起始，计时走绝对位置"），**属已有能力，不得按初稿替换**。A1「收窄的小圆点」正指向这个形态的精修，而非新建。

Dot 是现有 `appearanceStore.floatForm='dot'` + `collapsed=true` 的精修，不新建模式。

| 项 | 规格（与实现一致） |
|---|---|
| 尺寸 | **⌀33**（`SIZE=33`），非 ⌀32。33 来自用户"22 太小"后 ×1.5，属验收值，**不为对齐条高 32 而改动**（差 1px，收益为零、风险是重新挑起已定稿的尺寸讨论）。`ARC_RADIUS=11.4 / ARC_STROKE=3.4 / MARK_RADIUS=3.0 / RING_GAP_DEG=82` 四个几何量同为实现真源 |
| 环（唯一主圆） | 一条**开口**进度弧、无底环；`currentColor` 承载状态色。正计时弧尾=黄点、弧头=绝对秒位置 `(sec%60)×6°`；倒计时/待命/结束/空闲走 `arcSpec` 比例从 12 点铺开。黄点处用遮罩挖出 82° 几何断口（端帽吃掉后可见约 60°），断口两端圆角 |
| 黄点 | 嵌在环口内、轨道半径=环半径；角度=原分针口径（正计时一小时后一圈、一秒 0.1°；倒计时按已用比例；idle/ended 回 12 点）。**点色跟已计时小时走，不跟状态走**：<1h `--color-warn`（黄）/ 1–2h `--color-done`（绿）/ ≥2h `--color-violet`（紫），4h 封顶（`data-hours` 0..4）。状态色已由外环表达，点若也跟状态会与环同色、丢掉"点在哪儿" |
| 悬停反馈 | ① **点本体不放大**（禁 size 动画，B4 已落地）；② tooltip 用 native `title` = `{事项名} · {已计/剩余/预设 mm:ss}`，**无淡入**——dot 是 autoFit 严丝合缝的 33px 独立窗，自绘 tooltip 与任何外发光都会被窗口边界裁掉，要淡入必须先改窗口留白与命中区，**单列技术债、不在本轮**；③ ~~1px `border-strong` 微亮~~ **撤销**——点周围已是状态色 SVG 主环，再加描边成双环 |
| 文案禁令 | 圈内**不许写字**（用户口径"环是图形语言"），读数只走 tooltip 与 `aria-label` |
| 展开 | 点击 → `toggleCollapsed` 回 Pill；拖动走 `usePillDrag`（4px 阈值，拖完吞掉该次 click） |
| 边界 | dot 不显文字、不显把手（`DEFAULT_HANDLE_BINDINGS.dot.enabled` 保持 `false`，⌀33 圆上摆三个热区不现实）；是"最低视觉重量"终态 |


### 4.3 四态颜色与动效映射
四态 idle/running/paused/ended（ended=900ms 瞬时确认，非第四态）：

| 状态 | 计时数字色 | 环/强调（同屏 ≤1 处） | 动效 |
|---|---|---|---|
| idle | `text-tertiary`（浅）/ `text-primary` 白（深） | 无强调，环=`border-strong` | 无 |
| running | `text-primary` | 环 + 主按钮 = `accent`（1 处） | 秒进位 `opacity` 淡入，禁跳动 |
| paused | 数字维持，整条降一档 | 强调降为 `accent-muted` | 1.2s `opacity` 呼吸（0.55↔1） |
| ended | 高亮闪 | `success`（正常结束）/ `danger`（倒计时到点） | 一次性 `--dur-confirm 900ms`，不循环 |

倒计时进入 `COUNTDOWN_WARN_SEC` 阈值：**数字转 `warning` 色**，这是唯一允许数字变色的场景（其余状态数字只走主/次文字色）。

### 4.4 一处强调规则
- 药丸同屏强调色 **≤1 处**（环 running 蓝 与 主按钮 二选一其一承载，不同时上色）。
- 面板同屏强调色 **≤2 处**。
- 强调色默认 = `accent`；该规则 B2 阶段改为门禁执行（数一屏内非中性色像素簇数）。


---

## 5. 图标规范

已依赖 `lucide-react@1.57.0`，全仓统一这一套，禁混入其它图标库或内联异色 SVG。

| 项 | 规范 |
|---|---|
| 风格 | lucide line（线性），统一视觉语言，无填充图标 |
| stroke-width | 小尺寸偏粗以保清晰：16px 用 **2.5**（`--icon-stroke-sm`）、20/24px 用 **2**（`--icon-stroke-lg`），沿用主窗现状令牌 |
| 尺寸档 | **16 / 20 / 24** 三档（`--icon-sm/md/lg`），随所在文字档走：正文旁配 16、按钮内配 16/20、标题旁配 20、空态大图标 24 |
| 颜色 | 一律 `currentColor`，继承所在文字令牌，自动跟随主题与状态（running 时处于 accent 文字流内即自动变蓝）；禁写死图标色 |
| 对齐 | 图标盒与相邻文字做基线/垂直居中对齐，图标与文字间距用 `--space-1`(4) 或 `--space-2`(8) |
| 命中 | 纯图标按钮命中区 ≥26px（`--icon-btn-size`），视觉图标可小于命中区 |

---

## 6. 深浅双主题对照与对比度

### 6.1 语义色双主题对照表
| 语义 | 深色（默认） | 浅色 | 浅色对比度实测（源文件注释） |
|---|---|---|---|
| `bg-app` | `#0E0F12` | `#F2F3F5` | — |
| `bg-panel` | `#0E1015` / 卡 `#14161C` | `#FFFFFF` / 卡 `#F7F8FA` | — |
| `bg-elevated` | `#232833` | `#E6E9EF` | — |
| `text-primary` | `#FFFFFF` | `#16181D` | 对 plate 极高 |
| `text-secondary` | `#FFFFFF` | `#41485A` | ≥4.5 |
| `text-tertiary` | `#FFFFFF` | `#5C6577` / `#656E7D` | 对 plate 4.64:1 |
| `accent` | `#4DA3E8` | `#1669AD` | 作非文本 ≥3:1 |
| `success` | `#4CC38A` | `#0C7E47` | 对 plate 4.62:1 |
| `warning` | `#E8A33D` | `#A05E00` | 对 plate 4.62:1 |
| `danger` | `#E5484D`（实心底用 `#E1292F`/`#D02C33`） | `#D02C33` | 对 plate 4.62:1 / 实心白字 ≥4.5 |
| `participation`/violet | `#A78BFA` | `#6D3BD1` | 对 plate ≈6:1 |

> 深色文字四级同为纯白是**刻意**的（用户口径），层级靠排版。浅色才用墨色灰阶分四级，且四级灰对最浅底 `--bg-plate` 已校准到 ≥4.5:1（见 `03-theme-light.css` 注释，原 `#707A8A` 3.91 已改 `#656E7D` 4.64）。

### 6.2 对比度验收门槛
- 正文文字 ≥ **4.5:1**（WCAG AA）。
- 非文本（描边/进度环/色点/焦点环）≥ **3:1**（WCAG 2.2 SC 1.4.11）。
- 焦点环、选中底等 color-mix 派生色，深浅两套都须各自过门槛（分析窗现用 78%/74% 两档分别保浅 3.58、深 3.57，已达标，沿用）。
- 告警/危险/成功三色在**最不利底**（最浅 plate / 最深 plate）都须达标，不允许只在面板底达标。

### 6.3 验收方式
- 颜色：墨水量（canvas 灰度总和）diff，不用字宽判中文（CJK 全角 advance 恒定，字宽恒绿是假判据）。
- B1 零像素验收：深/浅各截一组，逐像素 diff 必须全 0。
- 四态：idle/running/paused/ended + 告警，深浅各一组截图对照条高与数字基线像素级不变。

---

## 7. 交付小结（给 team-lead 的关键决策）
1. **令牌合并基准**：语义名以分析窗 `--color-*`/`--at-*` 骨架为准，主窗 `--*` 向它 alias 对齐；B1 只统一命名、零像素变化，数值校准留后续批次。
2. **刻度档位**：间距 7 档(4 栅格，group14→12)、圆角 5 档(6/10/14/18/9999，主窗 lg12→14、drag22→18)、字号 7 档(10/11/12/13/14/18/display，消灭全部半像素)、字重 2 档(400/700，medium 等别名指向不改)、阴影 2 档(主窗 none、分析窗 pill/panel)、z 6 档(base/handles/popover/panel/toast/drag)。
3. **dot 规格**：⌀33 开口进度环 + 环身黄点（实现真源 `CollapsedDot.tsx`；初稿的"⌀32 单色点 + 悬停 1px 微亮"已作废，见 §4.2 修正块）；点色按已计时小时换档 <1h 黄 / 1–2h 绿 / ≥2h 紫；悬停不放大、只出 native title。
4. **一处强调**：药丸 ≤1、面板 ≤2，B2 门禁执行。
5. **主题**：深色纯白文字靠排版分级，浅色灰阶四级已过 4.5:1；非文本 ≥3:1。

<!-- SECTION-6 -->
