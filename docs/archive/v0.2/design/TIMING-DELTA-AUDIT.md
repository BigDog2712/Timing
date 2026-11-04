# Timing 对齐残余差异审计（本项目 V0.2.0 vs 参考 Timing v1.7.0）

- 审计人：颜好看（UI/UX 设计师）｜日期：2026-10-16｜供 Task #2 前端落地，唯一依据
- 权威源：`D:\101-Workshop\261015-Timing\Timing_v1.7.0\src\ElioTimer.Ui\`（C#/GDI 自绘，常量即规格）
- 对照物：`timing\src\`（令牌 + 各面 CSS + 组件）
- 判定分级：P1 = 视觉显著，本批必改；P2 = 次要，随批改；P3 = 可忽略或判不改（附理由）
- 排除项（本轮不做）：QuickFind 高亮（Timing 独有，MainForm.cs:2196）；一切功能新增，仅视觉/交互对齐
- 全局色板核查结论先行：深浅两套 A1/A2 令牌（--bg-panel/--bg-card/--bg-field/--bg-field-hi/--bg-seg/--bg-seg-on/--line*3/--ink*4/--accent/--accent-ink/--warn/--danger/--ok/--ok-ink/--solid-*）逐值比对 Design.cs:20-187 与 Design.cs:239-329，**全部一致**。仅两处例外见 §4-E/F。

---

## 1. 复核：今日 16:25 小条对齐批次（逐条对照 MainForm.cs 常量）

| # | 项 | 参考 Timing 权威值(文件:行) | 本项目现值(文件:行) | 判定 | 建议 |
|---|---|---|---|---|---|
| R1 | 环几何 | RingD 14 + RingLW 2.4（MainForm.cs:183,185），外沿约 16.4 | --ring-size 16 / --ring-stroke 2.4（design-tokens.css:79-80，border-box 含描边） | 一致（约定：视觉 16 = 14+命中余量） | 不改 |
| R2 | 运行旋弧 | spin 113°/s（MainForm.cs:3062）+ 90° 弧（MainForm.cs:2346）＝ 3.19s/圈 | ring-spin 3.2s linear infinite（batch2.css:55-66） | 一致 | 不改 |
| R3 | 计时数字 | TimeEm 28 自动收缩进 TimeW 53 盒（MainForm.cs:219,195）→ 实测有效约 19-20px | --text-timer-pill 20px + tabular-nums（design-tokens.css:84；surfaces.css:111-118） | 一致 | 不改 |
| R4 | 事项名 | TaskEm 14 Bold（MainForm.cs:223；BuildRunPath FontStyle.Bold，MainForm.cs:2300） | --text-task-pill 14px + --weight-strong 650（design-tokens.css:85；surfaces.css:78-79） | 一致 | 不改 |
| R5 | 文字投埃 | offY 1.4 / blur 2.3 / alpha 168（MainForm.cs:225-229,2269），悬停按 1-0.82*hoverFade 淡出（MainForm.cs:2266） | --shadow-ink 0 1px 2.5px rgba(0,0,0,.55)（design-tokens.css:227）；hover 时 text-shadow none（surfaces.css:121-126） | 一致 | 不改 |
| R6 | 状态墨度 | idle 0.75 / paused 0.88 / running 1（MainForm.cs:2161-2166） | .pill[data-state] 0.75/0.88，hover 回满（surfaces.css:56-68） | 一致 | 不改 |
| R7 | 暂停弧 | RingPause 暖橙 270° 静弧（MainForm.cs:2326-2329；Design.cs:38） | paused 弧色 --color-warn（=RingPause #E8A33D）+ 270° 静弧（surfaces.css:190-194；batch2.css:51-53） | 一致 | 不改 |
| R8 | 空态/运行轨道 | 轨道 = 状态色 x RingTrackAlpha 95/255 约 0.37（MainForm.cs:2369；Design.cs:42） | running 底环 color-mix 35%（surfaces.css:186）；但倒计时 SVG 轨道 = 白 0.20（batch2.css:31 + design-tokens.css:213） | **部分偏差** | 见 D6（P2） |

复核结论：16:25 批次与常量一致，无 P1 级回归。残余差异集中在下表。

---

## 2. 主差异审计表

| # | 面/元素 | 参考 Timing 权威值(文件:行) | 本项目现值(文件:行) | 判定 | 建议(含具体值) | 优先级 |
|---|---|---|---|---|---|---|
| D1 | 环 idle 色 | RingIdle = InkOnGlass：深=纯白 / 浅=#1A1C20（MainForm.cs:2323；Design.cs:287,239），实际绘制 alpha 约 0.97（MainForm.cs:2372） | --state-idle = var(--ink-3) 灰（design-tokens-compat.css:16；surfaces.css:160,162,227 引用） | 偏差 | --state-idle 改 var(--ink)（深 #F2F3F5 / 浅 #16181D，最接近 InkOnGlass 的令牌）。dot 空态随之自动同步 | P1 |
| D2 | 小条悬停板 | 玻璃板 GlassPlate @ GlassAlpha 128（约 50%）（MainForm.cs:2217-2220；Design.cs:63）；半径 min(GlassRadius 11, 板高/2)（MainForm.cs:2227；Design.cs:104）；PlateInset 1（MainForm.cs:231）；**无描边**（DrawHoverPlate 仅 FillPath） | .pill:hover 背景 = --pill-bg = --bg-plate **全不透明**（surfaces.css:39；design-tokens.css:316,308）；圆角 = --radius-pill 17 胶囊（surfaces.css:22）；带 1px 描边 + 投影（surfaces.css:40-41）。--pill-hover-plate 94% 定义后未被 surfaces.css 引用（design-tokens.css:318 为死别名，仅 compat.css:72 桥接） | 偏差 | 1) .pill:hover 背景改接 --pill-hover-plate，其值改 `color-mix(in srgb, var(--color-bar) 74%, transparent)`（Timing 原值 50%；取 74% 的理由见 §3-裁决二）；2) 圆角 17 改 12（--radius-lg，Timing GlassRadius 11 取最近标度档）；3) 去描边（border-color: transparent），保留 --shadow-balloon 与桌面分层 | P1 |
| D3 | 倒计时急迫态（环） | 剩余 <=60s：弧色切 RingUrgent #E5484D（MainForm.cs:2335；Design.cs:40）+ Blink：1s 周期，前 520ms 全亮、后 480ms 亮度 0.615（=0.45+0.55x0.3）（MainForm.cs:2339,2388-2395） | 仅 warn 橙不闪烁：.ring[data-warn] stroke = --color-warn（batch2.css:45-47；PillBar.tsx:79 COUNTDOWN_WARN_SEC） | 偏差 | 跟 Timing（裁决见 §3-裁决一）：[data-warn] 弧色改 var(--color-danger)；新增 blink 动画 1s steps（0-52% opacity 1，52-100% opacity 0.615，作用于弧与轨道）；prefers-reduced-motion 下退化为静态红（batch2.css:68 已有同款先例） | P1 |
| D4 | 倒计时急迫态（数字）+ 暂停数字色 | TimeColor：倒计时 <=60s 文字切 RingUrgent 红（MainForm.cs:786-793）；**暂停时文字切 RingPause 橙**（MainForm.cs:782-785）；均不闪烁 | 数字恒 --ink；仅倒计时 warn 时 --color-warn（batch2.css:10-12） | 偏差 | 1) 倒计时 warn 时数字色 --color-warn 改 var(--color-danger)；2) 新增 .pill[data-state="paused"] .timer-digits { color: var(--color-warn) }（Timing 暂停即橙字，与暂停弧同源） | P1 |
| D5 | 便利贴正文 | 正文 14px Bold，与悬浮小条事项名同一套字体参数（StickyNoteForm.cs:1289-1293「批170 需求2」） | --text-body 13px + 默认 400（note.css:152-153；design-tokens.css:28） | 偏差 | font-size 改 var(--text-task-pill)（14px）、font-weight 改 var(--weight-strong)（650）。注：正文始终 100% 不透明为 sticky-note.md §3.1 有意修复，不动 | P1 |
| D6 | 倒计时 SVG 轨道 | 轨道 = **状态色** x RingTrackAlpha 95/255 约 0.37（MainForm.cs:2369；Design.cs:42） | .ring__arc-track stroke = --ring-track = 白 0.20/深（design-tokens.css:213；batch2.css:31） | 偏差 | stroke 改 `color-mix(in srgb, currentColor 37%, transparent)`（currentColor = 环状态色，倒计时/暂停自动跟随）；--ring-track 令牌若无他处引用可删除 | P2 |
| D7 | 小条高度 | BarH 32（MainForm.cs:175） | --pill-h 34（design-tokens.css:69），--radius-pill = 17 | 偏差 | --pill-h 34 改 32，--radius-pill 随 calc 自动变 16。环 16 + 命中 24 在 32 高内不受影响；.pill__empty 同高联动 | P2 |
| D8 | 抓取柄墨度/描边 | 实绘：Pen 宽 2.5（MainForm.cs:2251），色 = GlassInk，alpha = GlassInkDim.A 139/255 约 0.545 x hoverFade x 区位系数 0.8/1.0（MainForm.cs:2238,2251；Design.cs:67）。注意 Design.GripInk 0.74（Design.cs:180）在 MainForm 未被使用，以实绘为准 | --grip-ink 深 rgba(255,255,255,0.74)/浅 rgba(16,20,28,0.55)（design-tokens.css:230,296）；SVG 描边 2.2（CollapseHandle.tsx:28） | 偏差 | 深改 rgba(255,255,255,0.55)（=139/255）、浅改 rgba(16,20,28,0.36)（浅档 GlassInkDim=Ink3.A=92/255，Design.cs:258）；strokeWidth 2.2 改 2.5。形态（右侧圆角括号 + 仅 hover 显影）与 Timing 实绘等效，保留 | P2 |
| D9 | 收起圆点 paused | 参考 Timing 无收起圆点（本项目独有形态，无权威对照） | dot paused = --ink-3 灰（surfaces.css:236-238），而环 paused = --color-warn 橙（surfaces.css:190-194） | 不一致 | 裁决见 §3-裁决三：.dot[data-state="paused"] .dot__ring 改 var(--color-warn) | P2 |
| D10 | 待办面板字号 | RowEm 12.5（TodoListPanel.cs:66；实绘 TodoListPanel.cs:915）；HeadEm 11.5（TodoListPanel.cs:64；TodoDigestPanel.cs:28） | 行名 --text-body 13px（todos-panel.css:130；todos-pending.css:99）；表头 --text-sm 12.5px（todos-panel.css:55） | 偏差 | 行名改 var(--text-sm)（12.5px）、表头改 var(--text-xs)（11.5px）。时间/时长列 --text-cap 11 vs Timing NumEm 11.5（TodoListPanel.cs:68）随行微调为 var(--text-mono) 11.5px 即可 | P2 |
| D11 | 菜单状态块 | StatusH 46（GlassMenu.cs:27） | --menu-status-h 52（design-tokens.css:106） | 偏差 | --menu-status-h 改 46px。菜单其余项一致：MinW 184 / ItemH 30 / PadX 9 / PadY 6 / ItemEm 13（GlassMenu.cs:19-33 vs design-tokens.css:105,107 + menu.css:117-121），不改 | P2 |
| D12 | 提醒浮出卡 | BoxW 330（RemindBox.cs:12）；BtnH 36（RemindBox.cs:24）；标题 14px Regular（RemindBox.cs:125）；Alpha 0.92（RemindBox.cs:28） | 宽 280（reminder.css:11）；按钮 --btn-sm-h 24（reminder.css:92,124,146）；标题 --text-body 13px semibold（reminder.css:51-53） | 偏差 | 宽改 330px；主 CTA（打开/完成类）改 --btn-md-h 28px（Timing 36 为 GDI 触控冗余，Web 取标度档 28；理由：与 --input-h/--menu 同栅格，36 在 280 宽卡内比例失衡——若坚持逐像素对齐则用 36px，二者取一，落地时定 28）；标题字号/字重维持（13 semibold 是 Timing 排版系统决定，Timing 14 Regular 为 Win32 消息框惯性，见 §4-G） | P2 |
| D13 | 主题卡标签 | 12.5px Regular（ThemeCard.cs:170） | --text-xs 11.5px（theme-picker.css:120-121） | 偏差 | font-size 改 var(--text-sm)（12.5px），字重维持 | P2 |
| D14 | 状态标记尺寸 | MarkW 14（TodoListPanel.cs:41） | --todos-mark-size 15px（design-tokens.css:95） | 偏差 | 判不改：15 仅为视觉标记，实际点击由 20px 的 .todo-pend__mark 承载（todos-pending.css:77-84），1px 差异不可感且无对照观感差异 | P3 |
| D15 | 菜单分组标题 | GroupEm 10.5（GlassMenu.cs:35） | --text-cap 11px semibold + caps 字距（menu.css:105-108） | 偏差 | 判不改：10.5px 中文笔画在 ClearType 与亚像素渲染下观感差异可忽略，Web 中文低于 11px 触发可读性问题；且分组标题在 Timing 为常规灰字非大写标签，现有处理已更克制 | P3 |

---

## 3. 设计裁决（本轮替主理人做的三个决定）

### 裁决一：倒计时 <=60s 急迫态 = 跟 Timing（红 + 闪），弃「橙 + 不闪」

**结论：弧色与数字切 --color-danger（深 #E5484D = RingUrgent 原值，浅 #D02C33 为浅色达标档），并加 1s 周期闪烁；reduced-motion 下静态红。**

理由：
1. **语义坍缩问题**：Timing 用四色严格区分状态——idle 白 / running 蓝 / paused 橙 / urgent 红（Design.cs:34-40）。我们若让急迫沿用橙，则「暂停」与「急迫」在同一色相维度上坍缩为一个语义，用户无法仅凭颜色区分「我按了暂停」还是「要来不及了」。这违反「颜色必须传达含义」的基本盘。
2. **闪烁参数已校准**：1Hz（520ms 亮 / 480ms 0.615 亮度，MainForm.cs:2388-2395），远低于 WCAG 2.3.1 光敏阈值（3Hz），且最低亮度 0.615 而非归零，是「呼吸告警」而非「爆闪」。
3. **watch 频率**：到点前 60s 是计时产品唯一必须「越界」吸引注意的时刻，Timing 的观感就是用户的既有心智模型，对齐它即对齐用户预期。
4. 保留橙的唯一理由是「更安静」，但急迫态的职责就是打破安静——安静由 idle/paused 态负责。

实现要点：数字变红**不闪**（Timing 文字仅变色不闪烁，MainForm.cs:786-793 的 TimeColor 无 blink 参与闪烁；闪烁只作用于环弧 alpha，MainForm.cs:2337-2340）。

### 裁决二：悬停板透明度取 74%（--glass-hover-bg 档），不取 Timing 原值 50%

Timing 权威值是 50%（GlassAlpha 128），但落地取 74%，理由：
1. Timing 的 50% 板是在 DWM ULW 逐像素 alpha 下与桌面直接混合，且其文字投埃悬停时也只衰减 82%（残留 18%，MainForm.cs:2266-2269）——它**从未真正依赖板面承载全部对比度**。我们已在 16:25 批决定悬停时投埃完全淡出（surfaces.css:121-126），对比度必须由板面独立承接，50% 会随用户壁纸明暗波动导致文字对比度不可控。
2. 74% 正是本系统已有的 hover 板档（--glass-hover-bg，design-tokens.css:216/283，便利贴 idle 同款），零新增令牌，且保持「半透玻璃可感知桌面」的 Timing 质感方向。
3. 这是「同方向折衷」而非「无视权威」：不透明 100%（现状）才是方向性错误。

圆角取 12（--radius-lg）而非 11：Timing 半径阶梯为 6/10/12/14（Design.cs:183-189），GlassRadius 11 是浮动板专属微调值；Web 侧吸附到标度档 12，肉眼不可辨。

### 裁决三：收起圆点 paused 色 = --color-warn（与环同步）

Timing 无收起圆点（其最小形态即小条本身），无权威对照，按**内部一致性**裁决：同一计时状态在小条与圆点两种形态下必须同色（用户在两种形态间切换，颜色是唯一的状态连续性线索）。paused 橙、idle 随 D1 改 --ink、ended 已是 --color-done。灰字退役。

---

## 4. 有意偏差清单（判不改，附理由）

- **A. 便利贴 idle 板 74% / 悬停 94% vs Timing 恒定 50%**（note.css:34,47 vs StickyNoteForm.cs:1488）：sticky-note.md §3.1 可读性红线的有意修复——Timing 板 50% + 正文受窗体透明双重叠加是已知硬伤，我们正文恒 100% 不透明、板面加深。方向正确，不改。
- **B. 便利贴头部/页脚 vs Timing 无标题栏极简形态**（note.css:53-69,174-190 vs StickyNoteForm.cs:1306「不再有标题栏」）：Timing 圆点条 15px 仅承载删除/收纳圆点（StickyNoteForm.cs:38-47,1300-1304）；我们的头部承载标题/链接/选择器等功能。功能新增不做本轮，结构保留，仅按 D5 对齐正文排版。
- **C. 便利贴最小尺寸 160x120 vs Timing 140x44**（design-tokens.css:98 vs StickyNoteForm.cs:22-26）：44px 高的便签在 Web 下无法容纳头部+正文+页脚且触控不可用，维持。
- **D. 浅色 --ink-4 #656E7D vs Timing (112,122,138)**（design-tokens.css:258 vs Design.cs:259）：Timing Ink4 仅作 placeholder/禁用；我们允许其作四级小字正文（AC-53），按 4.5:1 有意加深。注释已记录，不改。
- **E. --ring-track 白 0.20 vs Timing 状态色 0.37**：非有意偏差，见 D6，改。
- **F. 悬停板描边**：Timing 悬停板无描边（MainForm.cs:2208-2221 仅 FillPath），我们加 1px --line-2。D2 已含去除建议；投影 --shadow-balloon 保留（Web 无 DWM 窗口阴影可依赖，投影承担与桌面的分层）。
- **G. 提醒卡标题 13 semibold vs Timing 14 Regular**（reminder.css:51-53 vs RemindBox.cs:125）：RemindBox 是 Win32 消息框惯性排版；本项目卡片标题层级统一走「--text-body + semibold」系统（同 todos 表头、note 标题）。不改。
- **H. pill --pill-h-compact 30**：本项目独有的紧凑档（参考 Timing 无），功能态，不在本轮。

---

## 5. 落地顺序建议（给 Task #2）

1. **令牌层先行**（design-tokens.css / design-tokens-compat.css）：--state-idle（D1）、--pill-hover-plate 74%（D2）、--grip-ink 双主题（D8）、--pill-h 32（D7）、--menu-status-h 46（D11）、删除死别名 --pill-bg-hover 或接线。
2. **小条面**（surfaces.css / batch2.css）：悬停板圆角与去描边（D2）、blink 动画 + data-warn 切 danger（D3）、暂停橙字（D4）、SVG 轨道 currentColor 37%（D6）、grip 描边 2.5（D8）、dot paused（D9）。
3. **便利贴**（note.css）：正文 14/650（D5）。
4. **面板/菜单/提醒**：待办字号（D10）、状态块高（D11）、提醒卡宽与 CTA 高（D12）、主题卡标签（D13）。
5. 全部闪烁类动画必须落在 batch2.css:68 已有的 prefers-reduced-motion 块内退化。

验证口径：每条改动后与 Timing 同状态截图并排比对（idle / running / paused / 倒计时 90s 与 30s / 便利贴 idle+hover / 菜单 / 提醒 / 设置）。
