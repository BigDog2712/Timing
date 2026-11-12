# Changelog

本文件记录本仓库的版本变更。版本语义 `MAJOR.MINOR.PATCH`。
**V0.11.33 起双轨**：桌面版号 = `scripts/platform-versions.json` 的 `desktop`（六处同步），
手机版号 = 同文件的 `mobile`（`android-apk.mjs` 只读它）。两边互不牵连。

## 0.12.1（桌面）— 2026-11-12（末）

### 主界面 · 今日时间线：事项管理对齐悬浮窗事项菜单（0.12.1 末）

卡底「编辑事项」（摊开全表逐条改名）整体替换为「事项管理」，与「＋ 新建事项」并排：

- **＋ 新建事项**：名称 + 默认时长（分钟，留空 = 正计时）+「设为常用」勾选（**默认不勾**——
  宿主侧「常用」是用户自己设的，快捷添加建的是普通事项；勾上才带
  `isPinned:true + sortOrder = 常用组 max+1`）。
- **事项管理**弹层只两组：**常用事项**（`isPinned && !isSystem`，`sortOrder` 升序；↑↓ / 取消常用 /
  就地改名 + 时长）与**近期事项**（非置顶非系统按 `updatedAt` 倒序前 N，N 跟宿主 `itemsRecentCount`）。
  系统事项两组都不列；**不做**删除事项（牵连 `time_records` 归属）与列表内 HTML5 拖拽（与卡片
  拖拽抢事件，改 ↑↓ 按钮）。
- 时长落 `settings.itemsTimers`，与悬浮条共用同一份——分析窗设 25 分钟，悬浮条点该事项就是
  25 分钟倒计时。三态：留空 = 清键回正计时 / 数字 = 设值 / 缺省 = 不改。
- **修掉一个会丢数据的隐患**：宿主 `update_settings` 对 `itemsTimers` 是**整键替换**（还会
  `normalize_item_timers` 静默丢弃脏值），两次快速设时长并发时后写覆盖前写；启动设置加载失败后
  第一次设时长会把所有事项的时长清空。新增 `src/services/itemTimerWrite.ts`（54 行）：模块级
  串行队列 + **基底在队列任务内部读** + `!loaded` 先 `reload()`（fail-closed，reload 失败不落库）。
  已知未收口：`ItemsPrefsMenu.tsx:117,123` 仍直写（独立改造）。
- L9 落地：「直接调用原功能」= 分析窗镜像纯函数 `features/dashboard/services/itemPrefs.ts`
  + `itemPrefs.mirror.test.ts` 读两侧源码钉常量（1/1440、1..10、默认 5），不是复制粘贴任其漂移。

### 主界面 · 待办卡：新建待办对齐新建事项（时间 + 提醒）（0.12.1 末）

行内「回车即存」输入框下线，换卡底「＋ 新建待办」→ `QuietDialog` 弹层（名称 + 计划时间 + 提醒勾选）：

- **时间口径（主人拍板：一个时间 = 计划时刻）**：填的时间写 `planned_at`（行上时间胶囊 + 逾期
  红字）；勾「提醒」时**同一时刻**也写 `remind_at`（宿主两级提醒以此为基准：T-15 轻提醒、
  T-5 问自动开始），不勾则不设提醒。不做双时间字段、不做「提前 N 分钟」可选。
- 校验在纯函数 `todoDraft.validateTodoDraft`：名称 trim 空 / 超 200 拦（200 = 镜像
  `TODO_TITLE_MAX_CHARS`，mirror test 钉两侧同值）；时间串非法拦（手解 `YYYY-MM-DDTHH:mm`，
  禁 `new Date(string)` 宽松解析）；**勾了提醒且时间 ≤ 现在 → 拦**（nudge grace 过点不补弹）；
  不勾提醒允许过去时间（补记合法）。勾选在时间为空时禁用并说明。
- 失败路径：`create` 返回 false / 抛错 → 弹层不关、草稿一字不清、显示失败提示（待办走直接 IPC
  `patina-todo-notes`，非 host-intent，无 `sent` 布尔）。
- 行上：`remindAt` 非空显示 12px 铃铛（`role="img"` + 四语言「已设提醒 HH:mm」）。
- 布局：footer 贴卡下缘后撤销条让位 `calc(--qp-card-foot-h + 8px)`（负底边距吃掉 pad_b，
  不是 `pad_b + foot_h`）；`.qp-todo-list` 加 `min-height: 0`。两条都进了
  `dashboardBoardLayout.test.ts` 的 CSS 守卫（p07a / p07b）。
- 文案整块搬家：待办文案从 `copy.ts`（299 行顶限）抽出 `copyTodos.ts`（四语言 24 键），
  `copy.ts` 299 → 237。
- 已知后果（宿主既有行为，本轮 UI 放行过去时间后显形）：跨零点 `expire` 会软删
  `planned_at < today_start` 且未完成的待办——补记「昨天」的待办次日消失。

### 主界面视觉与交互重构（暗色面差体系 · 未出包并入同号）

**视觉层（surface）**：卡片从「1px 描边」改为「面差 + 内环 + 内高光」三层体系。

- 新令牌 `--qp-surface-board/card/inset/raise`、`--qp-card-edge`、`--qp-card-shadow-rest/hover`（tokens.css 299 行，余 1 行 —— 新令牌一律进不了那里）。暗色板面 #1d1d1d、卡面 #2d2d2d（1.22:1）；暗色卡边界由三层影撑（上缘反光 9% + inset 内环 34% + 投影 34%），**rest 与 hover 层数必须相等**（暗 3/3、亮 1/1），层数不等时 transition 不插值、悬停硬切。外扩 `0 0 0 1px` 禁用（会让卡缝 16→14），只用 `inset 0 0 0 1px`。
- 字阶：主读数 26/700（新 `--qp-font-size-readout`）、行主文 13/18（新 `--qp-font-size-row`）、meta 升 secondary（tertiary 3.79:1 不达 4.5:1）。
- 几何：环形 144→132（短档 112）、应用行高 32→28（**唯一动的行高令牌**，5×28+footer 32=172 ≤ 194 余 22）、裸条 4→6、`--qp-bar-max` 60→64、便利贴标签列 88→72 / 条高 40→38。像素验收项（443.14/548.86/465.14/570.86/264/284/254/294/56）零改动。
- 删 `<span class="hair" />` 发丝线（3 处）；应用/事项列表滚动条 4px 自绘。

**交互层（A 批）**：卡头 6 颗 12px 图标收敛成 1 颗 ⋯ + 弹出菜单。

- `CardControls` 6→1：菜单复用共享 `QuietAnchoredPopover`，项 = 上移/下移（禁用保留占位）+ 档位三段 radio + 跨列 checkbox（FULL_ONLY_CARDS 不渲染）+ 移除卡片（可逆，不用 danger 色）。菜单项全部接既有回调，零新 API；Esc 关闭焦点回 ⋯，↑↓ 在项间移动。
- `ModuleShell` 卡头加 grip 六点装饰层（pointer-events:none，落在卡内距留白不推挤标题）；右槽顺序改 meta 在前、⋯ 在后。
- 旧 `.qp-card-controls`/`.qp-card-control` 样式整块删除（dashboard-layout.css 297→252），接替文件 `dashboard-dnd.css`。
- 两根手柄显形统一：2px 圆头、`--qp-border-strong`（3.4:1），只加长不改色（静息隐 → 卡 hover 60% 长 → 自身拉满），禁 border-subtle（1.9:1 静默跌破 3:1）。
- `--qp-card-inner` 幽灵令牌删除（tokens 有定义、全仓零消费 —— 内高光并入 shadow-rest 第一层）。

**布局层（网格 v2 + 拖拽排序）**：双列模型换成安卓桌面小组件式自由网格。

- 布局契约 v1（`column: left|right|full` + 列内四等分 `width` + `split` 列宽比）整体升级 v2（4 列网格 + 起始列 `x` + 占宽 `w` 1..4 + 占行 `h` 1..2）。基准行高 = 计时分布卡 264px，**所有卡片统一到这个尺寸**，内容多的卡（应用排行/待办）占 2 行而不是把单卡塞高。
- `LAYOUT_VERSION` 1→2 + 换新键 `patina:dashboard-layout:v2`，旧 v1 数据不迁移（主人认可「旧数据丢弃重来」）。
- 渲染 `grid-auto-flow: dense` 自动向上补空（小组件桌面行为）；卡定位由 `CardSlot` 写 inline `grid-column: x+1 / span w` + `grid-row: span h`，槽 CSS 兜底 span 1。
- **拖拽排序**：卡头 grip 六点从装饰层升级成真手柄（命中区 ::after 外扩到 24×20），按住拖动让其它卡让位。新增 `gridFlow.ts`（纯函数复现 dense 落点 + computeDrop 抽出插回吸附 x）、`useCardDrag.ts`（floor 反推目标格、拖动中不落盘、draggingId 驱动 `data-dragging` 视觉）。
- 三种抓取（拖高 `.qp-card-resize` / 拖宽 `.qp-card-width` / 拖排 `.qp-card-grip`）共用板子一处 onPointerDown，各认各的手柄选择器，互斥不打架。

### 主界面 · 应用排行：双击应用可编辑分类与绑定事项（0.12.1 末）

**交互**：应用排行卡的每一行重新可编辑（上一轮「收口」时被判为只读，本轮只把**编辑**加回来，
不恢复「双击进目标详情」—— 那条仍在历史区/数据区）。入口三条，全部落在同一行上：
双击 / 右键 / `Enter`·`空格`·`Shift+F10`（行是 `role=button` + `tabIndex=0`，有 `:focus-visible` 内嵌描边）。
编辑器**复用**数据页/历史页那套 `QuickClassificationSurface`（`useQuickClassificationLauncher` + 懒加载 `QuickClassificationEntry`），
不新写一套，只在根菜单末尾多一栏「绑定事项」；卡底「全部分类…」仍是分类映射视图的入口，两条路径不互相取代。

**绑定 = 仅存配置**（本轮不做自动归因、不接追踪写入）：`settings` 表 KV `__app_item_binding::<exeName>` → `{"itemId":123}`，
清除走**删行**（`value: null`），不写 `{"itemId":null}` —— 否则「未绑定」有两种表示法。
写在现有 `cmd_commit_classification_settings` 通道上（Rust 前缀白名单新增 `APP_ITEM_BINDING_KEY_PREFIX`，
**不新增 IPC 命令**，命令表计数不动）；读是一次前缀扫描，失败降级为空、主界面不变红。
有绑定的行显示 5px 色点 + 事项名（≤46% 宽，与名称各自 ellipsis），`title`/`aria-label` 带「已绑定：X」。

**踩到的坑（值得记）**：`TopApplicationItem.exeName` 来自 `AppStat.exeName`，`resolveStatsExeName`
在「记录时的原始大小写 == 归一键」时**保留原始大小写**（`Code.exe`），而 KV 键是写侧归一后的 `code.exe`。
行渲染直接拿原始 exe 查表 → 「绑定存上了、行上没有标记、重开弹层选中态又是对的」三种表现同时出现，
且 `chrome.exe` 恰好全小写才没暴露。修法：读侧 `parseAppItemBindingRows`、行侧查表、写侧建键**三处同一个**
`resolveStatisticalApp`；归一后撞键取后者（不删库，只是先到那条不再生效）。
回归用 `apps06b`（`Code.exe` 大写）钉住，另加 M5 变异（去掉行侧归一）必须变红。

**顺带**：`serializeAppItemBindingValue` 对「非 null 但非法」的 itemId 由「返回 null」改为**抛错** ——
原实现把 `0` 当成清除，将来任何一处误传就会静默删掉用户绑定。解析侧仍静默降级（脏数据不清库）。
样板块 `dashboard-modules.css` 在加标记后顶穿 300 行，`.qp-app-*` 一族整体搬到 `dashboard-apps.css`
（在 `App.css` 紧跟 modules 之后 @import，不新增 `size-allowlist` 条目）。

### 构建洁净：桌面目标 6 条 `dead_code` 告警清零（0.12.1 末补）

`cargo check` 在桌面目标上报 6 条 `dead_code`，全部来自 0.13.0 安卓「应用使用统计」那批
「只在手机端接线」的符号：`ErrorCode::UsagePermissionDenied`、`OverlaySnapshot::summary`、
`UsageRowDto`、`UsageDayReply`、`services::usage::rollup` / `read`。
根因是它们的唯一消费者都包在 `#[cfg(mobile)]` 分支里，桌面 `#[cfg(not(mobile))]` 直接回
`supported: false` / 空实现。

**修法照 `services::overlay_push` 的既有口径**：逐项加 `#[cfg_attr(desktop, allow(dead_code))]`，
**不整段 `cfg` 掉** —— 一旦 `cfg` 掉，这些符号就永远只在手机包里，桌面 `cargo test` 编不到，
下一个人改字段或挪调用点时编译器不再提醒（`ErrorCode` 更是契约闭集，桌面也要能序列化出
`USAGE_PERMISSION_DENIED`）。没有用 crate 级 `#![allow]`，没有碰 `lib.rs` 的平台豁免。

顺带把 `models/usage.rs` 里一句不实注释改掉：原文声称「桌面编进 `cargo test` 才能被字段名
两边一致的测试覆盖」，实际仓里**没有**这条测试；现在如实写明「当前没有自动化判据，
`first`/`last`/`granted`/`rows` 都带 `serde(default)`，字段名改错只静默读成 0/空数组，
对齐全靠人比对 `UsageStats.kt`」——否则下一个改 DTO 的人会以为有护栏。

### 主界面四张卡的可交互升级（0.12.1 末）

**① 活动趋势 → 今日活动趋势**：原来画近 14 天每日柱，现在**只看今天**——每根柱一小时，
从本地 00:00 到当前这一小时（末窗右端裁到此刻），顶部读数从「峰值 / 日均」换成
「今日总时长 / 峰值时刻」。「日均」对一天之内没有意义，那条日均虚线一并下线。
柱高仍按峰值归一（不是按 1 小时），有量至少 3px、0 量留 2px 底桩。

**② 今日时间线可以新建与编辑事项**：卡底常驻一条操作行（＋新建事项 / 编辑事项），
参照手机端事项菜单底部那两颗。分析窗**没有写命令**，两条都走 `patina:host-intent`
（`create_item` / `update_item`），由药丸用 `itemApi` 落库后 `reload()`。
系统事项（`isSystem`，如「未命名计时」）不可改名；删除与改色本轮不做（会牵连历史记录）。

**③ 应用排行可增删分类**：弹层「改分类」子菜单底部加「＋ 新建分类」，每个自定义分类
多一条删除。新建写 `__custom_category::<id>`（`Date.now()`）+ `__category_label_override::<id>`；
删除是**整批一次提交**：成员应用/网页域名的 override 重算成「不带 category」的形态
（**保留别名/颜色/不追踪标题**，照 `deleteCategoryFromDraftState` 的既有语义），
再清四条定义键。内置 11 个分类不可删——`other` 是所有回落的目标。

**④ 便利贴**：纸片正文上移（`padding-top` 11 → 7px，行高与元信息不动）；点开全文后
可删除，二次确认内联在同一个弹窗里。删除走 `delete_note` 意图 → 药丸侧
`noteActions.removeNote`（`note_delete` + 关窗）。

**本轮最值钱的一条（夏令时）**：`buildTodayHourPlan` 原先在循环**之后**扫零长窗口，
只能从数组末尾弹；而 DST「春季前跳」日 `02:00` 被 JS 归一化成 `03:00`，那颗零长窗口落在
数组**中间**，弹不掉 → `boundaries` 出现两个相同值 → 后端 `windows(2).any(|p| p[1] <= p[0])`
直接拒，整条聚合读取失败，趋势卡从本地 02:00 起全天没有数据。修法是把判据收进循环体
（算完 `endMs` 就判 `endMs <= hourStart`），让下一个 hour 顶上来补住那一格——
不能靠"跳过"把 03:00–04:00 也扔掉。**`en-US` / `ru-RU` / `es` 这些夏季时区每年都会命中**，
不是理论问题；原来那句注释写着"已处理"，只做了尾部一半，属于最危险的那种注释。

**两条同款纪律**：「意图发出去了」不等于「宿主做成了」。改名与删便利贴都采用
「本地乐观更新 + 待确认集合」（后续刷新继续用本地值覆盖，直到返回值与本地一致才摘掉），
避免"改完又变回去 / 删了又蹦回来"。`emitHostIntent` 返回 `false` 时**一步都不往前走**——
便利贴删除第一版丢了返回值，会导致"界面删了、重启后回来"。

**护栏**：时间线卡多了常驻操作条后，S 档（卡高 200）扣掉卡头 62 与操作条 47 只剩 91px，
而 4 行 × 30 需要 120；行容器改为 `overflow-y: auto`（行项 `flex: 0 0 auto` 防压缩）。
这条已经写进断言（`p06a_timeline_rows_scroll_instead_of_clipping`）——它此前只是注释，
改回 `overflow: hidden` 测试照样全绿，属于"眼睛看得见、测试看不见"的回归。

## 0.12.1（桌面）— 2026-11-11

### 主界面：卡片能真的调大了，两张占位卡换成真卡

**「高度拖不动 / 卡片显示不完全」** 两条同源：板高写死 636 且视图根 `overflow: hidden`，
卡片变高没有任何去处 —— 列内卡只能把同列邻居压扁，通栏卡直接溢出被裁；
工具条又占 28px（20 + gap 8），把最底下的便利贴切掉一半。

- `.qp-dashboard` 改纵向滚动，`.qp-main-view` 的 `height` 改 `min-height`
  （默认内容恰好等于板高，几何零变化；拖高才长出去）。
- `.qp-dashboard-toolbar` 改绝对定位浮动（贴板右缘、指针进入视图才显形），不再吃文档流。

**应用趋势 / 提醒窗口** 从占位换成真卡：

- 趋势 = 一次 `cmd_get_activity_aggregate_range` 带逐日桶边界（与历史页区间视图同一条路），
  7 根柱按峰值归一，今天用强调色。真实库 7 天逐日与 SQL 独立口径 diff = 0。
- 提醒 = `reminder_pending`（待触发，不是历史），经 `platform/persistence/reminderReadRepository`
  读取（不碰分析窗 `api.ts` —— L9 双窗隔离）。
- `IMPLEMENTED_CARDS` 补 `trend` / `reminder`，加卡列表从此 8 张全可用。
- 新增 `--qp-mod-trend` / `--qp-mod-reminder` 令牌（长短两档）。

**二次修复：卡片仍然拖不动（flex 压缩链）**

上一轮只解决了「板子有地方长」，但高度仍被两处 flex 压缩吃掉，实测（headless Chrome
量真实 CSS 链）行高 288 → 480 时卡片恒为 282，一个像素没变：

- `.qp-ws` 是 `flex: 1 1 auto` + `min-height: 0`，高度不足时把 grid 行一起压扁
  （shrink 到 0），行高被算回容器高 → `1 0 auto`，只许长，超出交给外层滚。
- `.qp-main-view` 是 `.qp-dashboard` 的 flex 子项，默认 `flex: 0 1 auto` 被压回 636，
  内容 840 也不作数 → `flex: 0 0 auto`。
- `columnRowTokens` 把拖过的高度写成 `minmax(0, Npx)`，那个 `0` 下限让它成为
  「可压缩的建议值」→ 改固定 `Npx`。默认未拖的行仍走 token + minmax 兜底。
- `MAX_CARD_HEIGHT` 560 → 1000：旧的 560 是为「单卡太高会把同列另一张压没」设的，
  现在板子跟着长高、同列另一张保持自己的高度，那条前提已不成立。

修后实测：行高 480 → 卡片 480、板高 840、视图可滚；`npm test` 975 条全过，
新增 `r01c` / `p04d` / `r02a–r02d`（手柄→closest→pointerdown→move→up 整条接线）。

### 单独宽度：每张卡在自己列里占几格（0.12.1 末）

诉求原话「应支持单独宽度调整」。此前宽度只有一根总闸（拖 `.qp-split` 改两列比例），
单张卡只能选「进哪一列」或「跨满两列」，没有「这张宽一点、那张窄一点」。

- 布局契约加 `LayoutCard.width`（25 / 50 / 75 / 100，缺省 100 = 占满整列）。
  **按列算，不按板算**：按板算会和 `split` 抢同一块空间，窗口换宽还得重算，
  两条轴互相牵连。缺省不写键 —— 老布局读出来仍是今天的样子。
- `.qp-col` 改 `repeat(4, minmax(0, 1fr))`，卡按 `grid-column: span N` 占 1–4 格，
  两张 2 格的自动并排。默认全 4 格 → 像素零变化（板 1052 / gap 12 时 466.94 + 12 + 573.06）。
  槽上还留一条 `grid-column: span 4` 兜底：缺了它，一个没带内联样式的槽只占 1 格
  （实测 107 而不是 466），表现是「列变窄、右边空一片」，代码里看不出错在哪。
- 新增 `CardSlot`（列内卡与通栏卡共用）：`grid-column`、定高、宽度手柄三样落在槽上。
  `Dashboard` 不再算 `grid-template-rows`。
- **定高机制随之更换**：`grid-template-rows` 的前提是「一卡一行」；并排之后两张卡共用一个
  行高轨道，264 的卡会压着 284 的卡。改由槽自己定高
  （`.qp-card-slot[data-card][data-tier]` → `--qp-slot-h`），令牌名一字未改
  （`--qp-mod-timer` / `-s` / `-l` …），所以像素验收照旧。`cardRowToken` / `columnRowTokens` 删除。
- 新增 `useCardWidthResize`：读 `clientX`、以**列宽**为换算基准（不是板宽 ——
  取错会让窄列里拖一下跳三档）、吸附四等分、拖动中不落盘、window 挂 move/up、
  键盘 ←/→ 一档 25%。手柄 12px 横跨列缝，只在 hover/focus 画一条 2px 线。

headless Chrome 实测（真实 CSS，非最小复现）：默认四张卡各占满列（466.94 / 573.06）；
两张 `span 2` = 227.47 并排、同 y、各按自己档位定高；timer 切 S 档 = 184 且邻卡不受影响；
timer 拖高 480 与 800 → 槽与卡同为 480 / 800，列高 1056、板子跟着长，无压缩。

判据：`w01a–w01c`（吸附 / 格数 / 自愈不落 100）、`w02a–w02e`（span 真进样式、拖高是定值
不是 `minmax` 建议值、手柄 aria、通栏不出手柄）、`w03a–w03e`（接线：起点→吸附预览→落盘、
越界钳到整列、指针移出仍可拖、按卡身不启动、键盘一档）、`p01c`（四条令牌 × 三档 +
`repeat(4,…)` + 兜底 span）。变异自证 4 处：手柄写死 `span 4` → w02a 红；去掉吸附 →
w03a/b/c 红；删 todos 令牌 → p01c 红；兜底改 `span 1` → p01c 红。
`npm run check` 八步全绿（契约 81/117/17/11/18 未动；size 1600；vendored 90 条漂移 0）；
`npm test` **985 passed / 125 文件**；`vite build` 过，产物含
`qp-card-slot[data-card=timer]` / `repeat(4,minmax(0,1fr))` / `qp-card-width`。


- 独立工程副本保留源工程全部源码及未提交工作；重新安装依赖并构建。
- 计时切换失败后，仅在权威状态确认原会话仍暂停时恢复计时，避免静默漏计或恢复其他会话。
- 修正分析窗关于图标、扩展商店徽标的资源相对路径，生产构建不再丢失这些资源。
- 新增失败恢复回归测试；手机版号保持不变，本轮未生成 APK。

### 0.12.1 同日归一：悬浮条偏好的真源搬进宿主设置表

上一条「广播搬运」是权宜之计：真源仍是两窗各自的 localStorage，任何新增的「设置页写
localStorage」的项都得再接一次搬运，漏一次就静默失效。本轮收口为单一真源：

- **真源 = 宿主设置表** KV 键 `timing.pill_prefs`（外观三项 + 三手柄五槽绑定一个 JSON 快照）。
  设置页写 `update_settings`（`patch.pill` 半份合并），悬浮条读 `get_settings`；
  **不新增命令、不新增事件**，契约四个数（81/17/11/18）不变，ACL 也不动。
- localStorage 降级为**首帧缓存**：只在启动时同步读一次（防闪）与从库读到值后回写，
  不再参与任何判定。`timing:pill-prefs` 事件降级为无载荷信号（收到 = 该去重读）。
- **迁移**：库里 `pill == null` 时，悬浮条首次启动把本窗缓存写库一次——上一版调好的
  小圆点形态与手柄绑定自动搬入，不需要重配。
- 归一化在 Rust（`models/pill_prefs.rs`）：不透明度 clamp、形态只认 `bar/dot`、
  空槽/超长槽丢弃；动作 id 的权威校验仍在前端目录。
- 判据：读真源（安装即读 / null 不覆盖现值 / 信号重读）、写入参形状逐字、
  先落库成功才动界面（写失败卡内红字）、Rust 归一与 KV 往返。

### 0.12.1 同日修复：设置页的偏好送不到悬浮条

- **根因**：主界面（label `patina`）与悬浮条（label `main`）**不在同一个 WebView2 数据目录**——
  `main_window.rs` 建 patina 窗时设了 `.data_directory(webview_root)`，而 `tauri.conf.json`
  静态创建的 main 用 Tauri 默认目录。localStorage 按数据目录分区，两个窗口各读各的一份，
  所以设置页写的手柄绑定与药丸外观**永远到不了悬浮条**：症状是「设置里怎么调都没反应」，
  零报错、零日志。上一轮「靠 focus / pointerenter 重读就够」的判断是错的——重读读的仍是本窗那份。
- **修法**：设置页写完广播 `timing:pill-prefs`（`platform/desktop/hostPillPrefsGateway.ts`），
  悬浮条收到后**写进自己那份**再生效（`lib/appearanceSync.ts::applyRemotePrefs`）。走既有的
  `core:event` allow-emit / allow-listen 授权，不新增命令与事件，契约四个数（81/17/11/18）不变。
- **旧值不用重配**：两张面板挂载时各推一次当前值，用户本轮调过、但当时没送达的绑定与形态
  在进一次设置页后自动对齐到悬浮条。
- **顶栏只留图标**：三个 tab 去掉文字标签（名字进 `aria-label` 与 `title`），
  `--qp-nav-item-w` 改为跟高度档走（44 / 36 正方形），不再按窗宽 84→72 降级。

### 0.12.1 同日追加：悬浮条手柄三形态 + 两窗收口

> 版本号**不另起**：0.12.1 尚未出包，本轮并入同号（「号归先出包的」，不预占）。

- **悬浮条手柄**：右侧由「一个括号手柄」扩成**三形态并排**——圆点（⌀6 实心）/ 半手柄（短弧）/
  手柄（原长括号），设置里逐个开关，关掉的 `display:none` 不占位。每个手柄 **5 个动作槽**：
  左键、右键、中键单击 + 左键、右键双击，动作来自声明式注册表（13 条，含「唤出主界面」「Markdown
  同步」「结束并保存」等），新增动作只需 2 个文件、0 个 UI 文件。
- **删掉「今天」图标**：其两个功能（记录面板 / 今日摘要）迁入手柄动作，默认落在「手柄」的
  左双击 / 右双击；单击槽仍留给「当前事项便利贴」。代价：有双击绑定时单击延迟 250ms，清空双击槽
  即回到 0 延迟。
- **两窗收口**：独立设置窗（`settings`）下线，五个设置内容面（外观配色 / 悬浮条 / 计时与记录 /
  数据与同步 / 通用与启动）搬进主界面 settings 视图，并按主界面风格重排；药丸内联设置面板删除。
  托盘「设置…」与所有设置入口统一改投「主界面 → 设置」。
- 药丸宽度：`--pill-w-max` 288 → 320，撤销条另立 `--undo-w-max` 保持 288；默认只开「手柄」时
  药丸宽 278（比改前窄 10px），三手柄全开 310（0.12.1 末收紧手柄间距后为 302，见下一节）。
- 契约：命令 81（+Patina 117）/ 错误码 17 / 事件 11 / emit 18 **四个数一个没变**；新增权限组
  `patina-host-settings` 供主界面设置页写宿主配置。
- **已知限制**：① 手柄命中宽 12px（32px 条内三连排做不到 WCAG 24px，已记债）；② 主界面改
  `get_settings` 类字段后药丸同会话内可能读到旧缓存，需重开窗（md-sync / 主题 / 手柄绑定不受影响，
  那三处走广播或焦点重读）；③ 旧设置面板 22 个测试文件随组件删除，新面板目前只有冒烟级覆盖，
  0.13 补 RTL 全量回归。

### 0.12.1 末：主界面数据闪烁 + 手柄间距与半手柄弧度

> 版本号仍**不另起**：0.12.1 尚未出包，并入同号。三处都是用户手测报的观感问题。

- **主界面数据闪烁（真 bug，不是动画）**：`useDashboardStats.loadSnapshot` 每次取数都无条件把状态
  打回 `loading`，而 `ModuleShell.moduleState()` 把 `loading` 映射成骨架条 —— 于是每次
  `tracking-data-changed`（**每次切前台应用 / 每落一批会话**）四张卡整块换成骨架再换回来，看上去
  就是数据在闪。改成「当天已有快照就不退回 loading」：`status` 的语义回到「有没有数据可画」，
  首屏、跨日、错误态无数据重试才出骨架。这与同目录 `useTodayTodos` / `useTodayNotes` 早就在用的
  写法是同一条纪律（它们的注释里写着「刷新中把列表换成骨架 = 每 30s 闪一次」）。
- **判据 D-01**（`useDashboardStats.test.tsx`）：首屏必须 `loading`（无快照）+ 第二次刷新期间必须
  仍是 `ready` 且 `hasSnapshot` 为真。把 keep 分支删掉即红。
- **手柄之间过宽**：基础 `margin-left` 只管「事项名 → 第一个手柄」那 4px，管不到「手柄 → 手柄」，
  连排时 pitch 16px 而字形墨迹只有 ~5px 宽 → 眼里是 11px 空档。新增
  `.pill__handle:not([data-enabled='false']) ~ .pill__handle { margin-left: calc(-2 * var(--space-1)) }`
  （`pill-handles.css`）：pitch 16 → 12，视觉空档 11 → 7，三手柄全开总宽 310 → 302。
  用 `~` 不用 `+`：手柄可单独开关，`+` 会在「前一个兄弟 `display:none`」时漏掉，让第一个**可见**
  手柄仍占 16px。命中宽仍是 12（没为了变窄去缩热区）。
- **半手柄弧度过大**：原在 4.8px 高度里拱 1.65px，单位跨度拱起是长手柄的两倍，像半个圆圈。
  控制点 x 7.8 → 7（拱起 1.65 → 1.05），端点与高度不动，与右侧长手柄同一种「浅浅一道弧」。
- **判据 W-06 / W-07**：W-06 直读样式源码钉那条兄弟规则真的存在（算式从 token 推，删规则也自洽，
  所以必须另钉接线）；W-07 从渲染出的 `path` 算贝塞尔中点，断言半手柄的**相对曲率**（拱起/跨度）
  不超过长手柄的 1.4 倍。两条都做过变异自证（改回 7.8 / 改回 −1×space-1 → 各红一次）。
- 行数：`HandleCluster.test.tsx` 撞 300 行上限，按「行为 vs 几何」拆出 `HandleGeometry.test.tsx`
  （W-01…W-06 / R-03），未新增 `size-allowlist.json` 条目。
- 契约四个数（81/17/11/18）、事件表、ACL、Rust 侧：**一个没动**。

### 0.12.1 末：历史页区间视图（昨日 / 本周 / 近 7 天 / 近 30 天 / 自定义）

> 版本号仍**不另起**：0.12.1 尚未出包，并入同号。

主人需求原话：「修改历史数据界面 2.1 支持查看昨日、本周、近7天、近30天数据，支持自定义
（按日期框选数据）；2.2 数据包含事项、应用、便利贴、等所有数据」。

**为什么原本做不到**：历史页只有「某一天」一种读法 —— 日期头 `←/→` 加日历选日期，主体直接吃
`cmd_get_day_snapshot` 的唯一日快照。要看七天得手动点七次、自己在脑子里加总；而便利贴与待办
在那张快照里根本没有入口（快照只含应用与计时记录）。

**形态**：历史页顶部加一排六档 chip（单日 / 昨日 / 本周 / 近 7 天 / 近 30 天 / 自定义）。
选任一区间档，主体从「单日时间线」整体换成**区间总览**（四格摘要 + 逐日柱 + 排行 + 记录明细）；
点逐日柱的某一天，等于把 chip 拨回「单日」并跳到那天 —— 区间不叠在单日上，两者是并列的两个主体。
「自定义」用两个 `date` 输入框，起止反选自动对调，未来日期裁到今天。

- **关键取舍：区间模式下不挂载单日那 60+ 个 hook。** 原 `History.tsx` 是单一组件、1147 行、
  size-allowlist 零余量（1147/1147）。改为外壳 `History`（只持档位状态）+ 内部 `HistoryDayView`
  （原组件体）。区间档下 `HistoryDayView` 直接不渲染 —— 否则一进区间页就会并发打出七个
  `cmd_get_day_snapshot` 与七份 `list_records` 翻页，而它们的结果一个都不用。
  外壳与区间视图净增的行靠三处前置抽取抵掉：`services/historyDayDistributionView.ts`（环形角度
  算式）、`services/historyDaySummaryView.ts`（日摘要）、`components/HistoryTimelineActions.tsx`
  （三个图标动作 + 步进器 + 时长下限）。
- **四条口径**（全部有单测钉住，不靠注释）：
  1. **日界一律本地 00:00**，与 `lib/time::rangeBounds('day')`、`historyReadModel::getDayRange`
     同一条线；**不允许 `toISOString()`**（那是 UTC，跨时区会整档偏一天，手机端 `dateInputValue`
     踩过同一个坑）。
  2. **区间右端裁到「现在」**：本周 / 近 7 天 / 近 30 天都含今天且只到此刻
     （`endMs = min(次日 00:00, nowMs)`）。**昨日是唯一右端早于此刻的档位**，必须放行到
     今日 00:00 —— 否则「昨天」会把今天上午的记录算进去。这条是变异自证过的。
  3. **本周 = ISO 周**，周一起算（与数据页「周」档、`getIsoWeek` 同一条线），不是「近 7 天」。
  4. **应用按墙钟跨日分摊**：一条 23:50→00:20 的会话必须 10 分钟落昨天、20 分钟落今天。
     口径是 `SUM(MIN(end_time, 桶右) − MAX(start_time, 桶左))`，**不能加 `duration` 列**；
     事项按 `startedAt + accumulatedSec` 归到开始那天，便利贴按 `createdAt`，待办按 `doneAt`。
- **数据来源分两路，都不新增命令**：
  - 应用时长走**后端** `cmd_get_activity_aggregate_range`，直接传逐日桶边界
    `[startMs, ...days.map(d => d.endMs)]`。后端 `validate_aggregate_boundaries` 要求
    **首元素 == `startMs` 且末元素 == `endMs`**，否则整条 activity 读失败（"boundaries are
    invalid"）；这也顺带把日界权威留在 Rust，前端不再猜。
  - 事项 / 便利贴 / 待办走**反向数据桥**（分析窗读宿主数据的那条只读通道）：`list_records`
    翻页（100/页，上限 20 页）、`note_list`、`todo_list`（`includeDone`）。
    `src-tauri/permissions/patina-host-bridge.toml` 的 `commands.allow` 由 3 条扩到 5 条，
    **全部只读，零写面**。
- **三态降级**：单源失败降级成空并继续出图，**四源全失败才报错**（复用 `ModuleShell` 的错误态）。
  有数据可画就不退回 `loading` —— 这是同一天修主界面闪烁时定下的同一条纪律
  （详见上一节 D-01）。
- **`nowMs` 必须冻在 state**，不能每次 render 现算：`cacheKey = mode:startKey:endKey`，
  `nowMs` 一抖 `endMs` 就变，等于每帧换 key、每帧全库查询。
- **文案不进 `shared/i18n`**：`generated/locales/*.ts` 是按索引对齐的位置数组，手插一行会错位
  其后全部文案；`generated/contract.ts` 还冻在 1131/1131。新文案走组件侧
  `rangeCopy.ts` 的 `Record<Locale, HistoryRangeCopy>`（与 `dashboard/copy.ts` 同法）。
- **判据 36 条**：`historyRange.test.ts` 12 条（档位边界 / 昨日右端 / ISO 周 / 反选对调 /
  未来裁剪 / DST 日长 / cacheKey）、`historyRangeAggregate.test.ts` 11 条（跨日分摊 / 首桶不丢 /
  末桶裁剪 / 四类归日）、`HistoryRangeView.test.tsx` 9 条（三态 / 点柱回单日 / 逐日柱数）、
  `historyRangeBridge.source.test.ts` 4 条（ACL 五条命令逐字）。
- **变异自证三处**（各自确认变红后还原）：① 昨日右端 `start` → `today` ⇒ `r02` 红；
  ② `distributeSession` 加 `if (index > 0) continue;` ⇒ `a01` 红；
  ③ `patina-host-bridge.toml` 删 `note_list` / `todo_list` ⇒ `h01` 红。
- 契约四个数（81/17/11/18）、事件表、Rust 命令表：**一个没动**（区间聚合用的是既有
  `cmd_get_activity_aggregate_range`，反向桥用的是既有只读命令）。

### 0.12.1 末补：历史页与数据页合成一个页面（两副面孔）

上一节交付后发现**功能等于没上线**：0.12.1 把侧栏下线、导航收成顶栏三区（主界面 / 数据 /
设置），`history` 从此没有入口 —— 唯一路径是「数据 → 趋势切到日档 → 点某天的柱子」
（`Data.tsx:938` 的 `canOpenTrendHistory`）。用户打开「数据」看不到任何变化，反馈「数据界面没变化」。

- **口径：一个页面两副面孔**。`data` 与 `history` 两个 view 都渲染同一个容器
  `DataHistoryFaces`（新增 70 行），顶部一排面签（数据 / 历史），点面签 = 导航到另一个 view。
  组件**不持内部状态**，高亮只跟 `currentView` 走 —— 这样 `onOpenHistoryDate`（数据页点柱子）、
  托盘与悬浮条递来的落点、`updateRelaunchViewStorage` 的恢复全部自动一致，不会出现
  「面签亮着概览、内容却是历史」。
- **非活动面不挂载**：两页各自会拉全套快照与聚合（历史单日那套 60+ 个 hook），并排挂等于
  一进页面就把同一批库查两遍，肉眼只表现为"打开有点慢"。判据 f01/f02 双向钉住。
- **零新文案、零新命令**：面签复用 `uiText.data.title` / `uiText.history.title`，不碰
  `shared/i18n`（位置数组 + `contract.ts` 冻 1131/1131）；控件用既有的 `QuietSegmentedFilter`
  （`semantics="tabs"`），不新增 CSS 文件。
- **顶栏三区不动**（01 §6）：没有加第四个 tab，只把「数据」区内部变成两个面。
- 接线：`AppShell` 加 3 行（`onNavigateView` → `handleSidebarNavigate`，与既有 `onOpenMapping`
  同一写法），`AppShellViews` 把两个 view 的 JSX 提成 `dataNode`/`historyNode` 再交给容器。
- 判据 4 条（`DataHistoryFaces.test.tsx`）：只挂活动面（两个方向）、点面签调 `onSelect`、
  `aria-selected` 跟 `active`、tablist 读屏名含两面。**变异自证**：把
  `active === "history" ? historyNode : dataNode` 改成两个都渲染 ⇒ f01 / f02 齐红。
- 行数：`AppShell.tsx` 284 → 287（离 300 还有余量，且它的 allowlist 条目已被 P0 删掉）；
  `AppShellViews.tsx` 241 → 269。
- 门禁：`npm run check` 八步全绿（含对方修好 typecheck 后）；`npm test` **914 过**；
  `npm run build` 通过，`data-data-face` 在 `dist/assets/patina-*.js` 里 grep 得到。

### 0.12.1 末补：当日与往期统一成同一套版式与同一套口径

合并出入口后，主人接着问「为什么当日和往期数据格式不同？应统一」。一查，同一排 chip 里
「单日」和「昨日」实际是**两个产品**：块不一样、应用的分组维度不一样、连时长的算法都是两条。

| | 单日（改前） | 往期 |
|---|---|---|
| 摘要 | 活跃时长 / 跨度 / 高峰（三行文本） | 应用 / 事项 / 便利贴 / 待办（四格） |
| 应用 | 环形图，按**分类**分组 | 条形排行，按**应用**分组，带占比 |
| 事项 | 只有「计时重叠」 | 有排行 |
| 便利贴 / 待办 | 没有 | 有明细 |
| 应用时长口径 | `session.duration` **累加** | 墙钟 `MIN/MAX` **裁剪** |

最后一行才是真问题：跨日会话、含暂停的会话在两种算法下不是同一个数，于是同一天看「单日」
和看「昨日」四格会差几分钟，用户眼里就是"数据不对"。（时长**格式**其实是统一的，两边都用
同一个 `formatDuration`，都是 `1h 5m`。）

- **单日 = `dayCount === 1` 的区间**。新增 `resolveHistoryDayRange(dateKey, nowMs, label)`：
  日界本地 00:00，右端 `min(次日 00:00, nowMs)`（看今天只到此刻），未来日返回 `null`。
  `useHistoryRangeData` 加 `dayDateKey`，单日也走 `cmd_get_activity_aggregate_range` +
  同一份 `buildHistoryRangeAggregate`，口径从此只有一份。
- **单日页主体换成 `<HistoryRangeView showDailyBars={false}>`**：四格摘要 / 应用排行 /
  事项排行 / 便利贴与待办明细 与区间**同一组组件**；逐日柱关掉（一根柱子不表达趋势，
  自己点自己也没意义）。时间轴、泳道、每小时活动保留（时序信息区间给不了），
  每小时活动作为 `extraBlock` 横跨整行、跟着同一块滚动区走。
- **下线的块**：三行摘要（`HistoryDaySummaryPanel`）、环形应用分布
  （`HistoryDayDistributionQuickActions`）、计时重叠（`HistoryTimingOverlap`），以及只为它们
  服务的 `useHistoryDistributionItems` / `useTimingOverlap` 调用与分布模式偏好状态。
  `History.tsx` 1136 → 1079 行。
- **代价（已知，主动记录）**：环形卡带的两个交互一并下线 —— 点应用看「目的地详情」、
  快捷分类。`useHistoryDestinationDetailEntry` 与它的弹窗仍挂在页里但已无触发点。
  要恢复就把入口挂到应用排行行上（行本身已经是可点的语义位置），列在下一轮。
- 判据 7 条：`resolveHistoryDayRange` 5 条（整日 / 今天裁到此刻 / 未来日 null / 坏 key null /
  桶边界首尾闭合）、视图 2 条（单日无柱但四格与四块齐、区间仍有柱）、源码哨兵 1 条
  （`h05`：单日渲染 `HistoryRangeView` + `showDailyBars={false}` + `mode: "day"`，且旧版式三件
  不许再出现在 `History.tsx`）。**变异自证**：把 `showDailyBars={false}` 改回 `showDailyBars`
  ⇒ h05 红。
- 门禁：`npm test` **928 过**；`check:size` / `check:layers` / `eslint` 绿；`vite build` 通过
  （`data-history-range-extra` 在 `dist/assets/patina-*.js` 里 grep 得到）。
  `tsc` 当前红在对方的 `TimerModule` / `TimelineCard` / `focusDimension`（P1 在途），与本轮无关。
- **踩到一个坑**：用 python 文本模式批量改 `History.tsx` 把整个文件的 LF 写成了 CRLF，
  于是 `mainToolsNavigationGateway.test.ts` 里那条按字节扫 `;\n` 的源码哨兵直接红
  （报"找不到 highlightedApp 派生"）。批量改 `.ts/.tsx` 必须走二进制模式。

### 0.12.1 末补：区间也有时间轴（一行一天）

上一轮把单日统一到区间版式后，「时间轴」成了单日独有的一块 —— 区间只有数字和柱子，
回答不了"那几天几点在忙"。这一轮补上：**每天一条 0–24h 的活动带**，行首点开回单日。

- **为什么不是把单日那根轴拉长**：0–24h 连续坐标在 30 天档上会把一次 3 小时专注压成 0.4%
  宽，读不出形状也读不出节奏。按天分行、每行各自 0–24h，才能同时看清"哪几天在干活"
  与"那几天几点在干活"。
- **为什么要分格取主导**：真实库里一天几百条会话（窗口一切换就是一条，本机实测
  192–935 条/天，30 天 1.3 万条）。原样画 = 上万个 DOM 节点；且相邻两条常是同一应用的
  不同窗口，分开画反而看不出连续工作。所以把一天切成固定格、每格取占时最长的应用、
  再合并相邻同应用的格子。格宽随跨度放大：≤2 天 5 分钟 / ≤7 天 10 分钟 / 更久 15 分钟
  —— 每天最多 288 / 144 / 96 块，DOM 规模与会话条数解耦。
- **分母必须是完整一天**，不是"可见窗口"：今天只看到此刻，若拿 `nowMs - 00:00` 当分母，
  上午的带子会被横向拉满，看着像"今天全天都在忙"。DST 那天由日期算，不写死 24h。
- **数据源要另取一份**：`cmd_get_activity_aggregate_range` 传了逐日桶边界后，后端已把记录
  按「天 × 应用」压成"起点落在 00:00、长度等于当日总时长"的行 —— 时长对、位置全丢。
  时间轴另走 `getSessionsInRangeWithoutTitleSamples`（同一窗口、同一条 `cmd_get_history_range_rows`，
  日视图本来就在用；不带标题样本，30 天几千条才不会把 IPC 体积翻几倍）。
- **颜色按应用键解析一次**（`AppClassification` + `objectColor`，与单日时间轴同一条链路），
  跨天的同一应用必然同色，否则"看色块形状"不成立。段用纯色条 + 原生 `title` 而不是
  `QuietTimelineSegment`：后者每段挂一个 `QuietTooltip` 实例，几千段光挂载就够卡。
- 单日档显式 `showTimeline={false}`：那一天上面已经有可缩放、可点段的交互时间轴，
  再画一行静止的带子是重复。
- 判据 12 条：几何 10（格宽三档 / 格窗取整 / 相邻格合并 / 同格主导 / 同长按键定序 /
  跨日按墙钟切 / 今天裁到此刻且分母不变 / 左边界裁剪 / 空日仍出行）、视图 1（区间每天一行
  且块落在自己那行）、源码哨兵 1（`h06`：hook 取的是**未聚合**会话并真的传进聚合，
  且单日显式关掉）；另在 `v10`（单日档）补了「不出现逐日带」一条断言。
  **变异自证三处**：分母改成可见窗口 ⇒ `t09` 红；同长时改取后到者 ⇒ `t07` 红；
  把 `getSessionsInRangeWithoutTitleSamples` 换成带标题样本的那版 ⇒ `h06` 红。
- **真实数据核过**（本机 `patina.db` 导出 11-09…11-11 三段喂给纯函数）：昨日 26 块
  `12:50→18:30`、11-11 16 块 `09:00→17:42`，与库里首末会话时刻（`09:00:48` / `17:41:27`）对得上。
- 门禁：`npm run check` 八步全绿；`npm test` **946 过**；`vite build` 通过，
  `history-range-timeline-day` / `-block` 在 `dist/assets/patina-*.js`、类名在 patina 的 CSS 里都 grep 得到。
  契约四个数（81/17/11/18）、事件表、Rust 命令表、ACL：**一个没动**（用的全是既有命令）。

## 0.12.0（桌面）— Patina 融合：第二入口并进同一个安装包 — 2026-11-09

主人需求原话：「查看 Timing 的相关工作档案……深度优化 Timing，将 patina 和 Timing
结合的更完美，且能正常运行」。裁决见 `Active/Timing/for-forg/34-方案-Patina融合.md`
（ForG）：**宿主是 Timing**，Patina 整套作为**第二入口**（独立窗口 + 独立数据库）并入
同一个进程、同一个安装包；安卓端与悬浮条一行代码没动。

### 为什么不是「合并成一个应用」

两套东西的窗口模型打架：Timing 是 `decorations:false / transparent / skipTaskbar /
alwaysOnTop` 的悬浮小条，Patina 是常规主窗。共用一个入口 HTML 会让 Tailwind v4 的 preflight
落到浮条上（背景被重置、`body` 变成白底）。所以走多入口：`index.html`（宿主）+
`patina.html`（Patina），各自一棵树。

### 五处硬冲突与处理

1. **窗口 label 撞车** → Patina 主窗 label 改 `patina`（`main_window.rs:17` 的
   `MAIN_WINDOW_LABEL`）；宿主仍是 `main`。
2. **入口文件撞车** → Vite `rollupOptions.input` 双入口；`main_window_url()` 生产指向
   `WebviewUrl::App("patina.html")`，debug 指向 `http://127.0.0.1:1420/patina.html`。
3. **capabilities 按 label 授权** → 新增 `capabilities/patina.json`（`windows: ["patina",
   "mini"]`），**不抄全量白名单**；Patina 的命令集写成 `permissions/window-commands.toml`
   （`main-window-commands`），逐条列出 117 条。**代价是宿主自己的命令也必须登记**
   （`permissions/host-commands.toml` / `host-commands`，80 条），详见下面「验收时炸出的
   第四条」。
4. **两套托盘/自启/更新器** → 托盘：`tray.rs` 加 `PATINA_OWN_TRAY = false`，`setup_tray` 与
   `apply_current_tray_visibility` 双双短路（后者会在 `tray_by_id().is_none()` 时**主动建**
   托盘，必须单独闸）；自启：Patina 侧从未注册；更新器：不注册 `tauri-plugin-updater`、
   启动不做自检、capability 不含 `updater:default`（上游端点指 `github.com/Ceceliaee/patina`，
   留着等于把 Timing 更新成 Patina）。
5. **浮窗重复** → mini 窗口不上（D5）。

### 实现

- **命令表并入宿主**：Patina 的 117 条命令从「插件注册」改为并进
  `src-tauri/src/ipc_commands.rs` 的单张 `generate_handler!`（宏 `define_invoke_handler!`
  拼宿主 80 条 + 桌面段 Patina）。**不能改回插件注册**：插件命令走 `plugin:<name>|` 的独立
  ACL 命名空间，窗口白名单对它不生效，症状是「页面加载完但窗口永不 ready」且无日志。
- **数据**：`<数据根>/patina/data/patina.db`，与 `timing.db` 并排（`app/patina_bridge.rs`
  的 `patina_root()` + `set_root_override`）；首启若发现 `%APPDATA%\Patina\patina.db`
  就 `VACUUM INTO` 导入一次。
- **单一入口两处**：宿主托盘「时间统计…」（`tray_menu::ID_OPEN_STATS`）与
  设置 → 通用 → 时间统计（`GeneralTab`）。两处都调到宿主自己新增的
  `open_patina_window`（`commands/window_cmd.rs`）——**不是**直接 invoke Patina 的
  `cmd_show_main_window`，因为 ACL 只授权 `windows: ["patina"]`，宿主命令没有 permission
  声明，天然开放，前端也继续走 typed `IpcApi`。
- **dev 回环地址修正**（本轮定位的真 bug）：`vite.config.ts` 原来没写 `server.host`，
  Node 把 `localhost` 解析成 `::1`，Vite 只监听 `[::1]:1420`，而 WebView2 先连
  `127.0.0.1` → 导航失败 → 落在 `chrome-error://chromewebdata/`，前端永远发不出 ready，
  8 秒后日志打在 `ready-timeout … result=kept-hidden`（窗永不出现）。现在 `host`、
  `devUrl`、debug URL 三处统一 `127.0.0.1`；`MAIN_WINDOW_READY_TIMEOUT_SECS` 8 → 60
  （注释早就写着 60，值没跟上）。
- **合规**：新增 `THIRD-PARTY-NOTICES.md`（Patina 来源 / MIT 全文 / 本项目 7 条改动清单；
  Tailwind v4 与 plugin-opener 一并列明），README 加「时间统计（Patina）」一行并在版本段
  说明 0.12.0 的内容是融合。

### 判据与门禁

- `npm run check` EXIT 0：契约 **Rust 80（+Patina 117）/ IpcApi 80 / ipc.ts 80 / mock 80**、
  错误码 17/17、事件 11/11/emit 17；size 1419 文件（vendored 子树 152 个按专项口径豁免，
  最大 1936 行）；version 桌面 0.12.0 六处一致 + 手机 0.12.0/12000；layers 8 条 1346 文件；
  brand 691 命中 0 违规；lint 0。
- `cargo check --all-targets` EXIT 0，仅 3 条既有警告（`md_sync_channel_test.rs:8` unused
  `super::*`、`overlay.rs:83` `summary` 未用、`patina/engine/tools/mod.rs:755` `fetch_update`
  已弃用）。前端 682 测试全过（83 文件）；后端新增 `qa_tray_stats_entry`（托盘「时间统计…」
  的位置 / 文案 / 四种状态 × 退出中都不消失）。
- `cargo check --target aarch64-linux-android` EXIT 0（NDK 27.2.12479018）：融合把
  `webview2-com` / `windows` / `windows-core` 写在通用依赖段，安卓被 Windows API 拖死
  （16 条 `cannot find function submit in crate windows_threading`），已挪进
  `[target.'cfg(windows)'.dependencies]`。
- **实跑验证**（dev，`127.0.0.1`）：`[main-window] event=frontend-ready generation=1
  load_epoch=2 reason=frontend render_state=ready … result=accepted-hidden` —— Patina 窗前端
  真的执行了、`cmd_mark_main_window_ready` 走通（说明 capability 授权有效），且启动时保持
  隐藏不抢焦点。两处入口实测（CDP 直接点真按钮，不是「看代码像对」）：设置 → 通用 →
  「时间统计 / Patina · MIT / 打开」点下去日志出 `show-requested reason=tray-menu` →
  `show-succeeded result=visible`；`open_patina_window` 从宿主窗 invoke 返回 `OK`。
  补完 `host-commands` 后，宿主 `get_migration_info` 等命令恢复返回真实数据。
- 行数门禁逼出两次压缩：`src/services/ipc.ts` 加完命令到 303 行，按项目既有口径
  （「搬走/压注释腾行数」）压回头注释与新增注释，回到 300。

### 验收前又修的四条（都是融合才暴露的问题）

1. **宿主退出被 Patina 吃掉**：`patina::app::bootstrap::handle_run_event` 的
   `ExitRequested` 只认 Patina 自己的 `AppExitState`，而 Timing 的退出路径
   （`app::tray_quit`、`commands::system_cmd::quit_app`）从不写那个状态 → `prevent_exit()`
   把退出拦下：窗口没了、托盘没了、进程还在跑 md 同步。修法不补标志位（谁忘了写就又退化），
   改判 Tauri 自己给的 `code`：`Some(_)` = 有人调了 `app.exit()`，一票否决；`None` 才是
   「窗口关光了」。判据落成纯函数首参 `explicit_exit`，用例 `explicit_exit_is_never_prevented`。
2. **Patina 窗每次启动自己弹出来**：`register_hidden_main_window_startup` 以
   `window.is_visible()` 为前置，而 `WebviewWindowBuilder::visible(false)` 建出来的窗口
   在这个时点 `is_visible()` 仍返回 true → 上游判定「没资格认领隐藏启动」，回落到显示窗口。
   宿主本来就起在托盘里，这是行为倒退。改为**认领隐藏就把窗口藏起来**（`window.hide()`），
   不再要求「它本来没显示」；三条出因各加分支日志（上游只有一句 registration was rejected，
   这次排查就卡在它上面）。修后 `frontend-ready result=accepted-hidden`。
3. **后台销毁撞上页面加载 → 进程 abort**：`schedule_main_window_destroy_after_background`
   的 30 秒计时与首帧赛跑，页面还在 `waiting` 时 `window.destroy()` 撞上正在建的 WebView，
   tauri-runtime-wry 报 `RefCell already mutably borrowed`；release 是 `panic = "abort"`，
   用户看到的是「App 自己没了」。`begin_destroy_hidden_window` 增加 `render_state == Ready`
   前提，用例 `main_window_lifecycle_refuses_to_destroy_window_before_page_ready`。上游踩不到，
   因为它启动就显示窗口、页面必然先 ready。
4. **加了 Patina 的命令白名单，宿主 79 条命令全部失效**（本轮最贵的一个坑）。Tauri 2.12 的
   IPC 门禁在 `tauri/src/webview/mod.rs:2053`：
   ```rust
   if (plugin_command.is_some() || has_app_acl_manifest || !is_local) && invoke.acl.is_none()
   ```
   只要仓库里存在**任何** app 级 permission，应用命令就不再默认放行。融合把 Patina 的 117 条
   写成 `permissions/window-commands.toml` 的那一刻，宿主自己的 79 条也一并被要求显式登记。
   症状极具欺骗性：窗口照常渲染、悬浮条照常出现，只是**所有数据都是空的**，控制台**一句
   日志都没有**（dev 构建下才把 ACL 拒绝写进 `invoke.resolver.reject`）。用 CDP 从宿主窗
   `__TAURI_INTERNALS__.invoke` 逐条打才看见实情：`overlay_status not allowed. Command not
   found`。修法：新增 `permissions/host-commands.toml`（identifier `host-commands`，80 条，
   与 `ipc_commands.rs` 宿主段逐条对齐），并挂到 `capabilities/default.json`（桌面
   main/settings/todos/timer/note-*）与 `capabilities/mobile.json`（安卓 main）两份
   capability —— **少挂一份，对应平台就是全平台静默失效**。同时给 `check-contract.mjs`
   加两条断言：宿主命令集必须与这份清单逐条相等、两份 capability 都必须引用它。
   顺手补 `mini` 进 `patina.json` 的 windows（标题栏「迷你窗」按钮真能点到，漏授权同样是
   「窗开了、界面全哑、零日志」）。

> 排查口径：`tauri dev` 打 `error: process didn't exit successfully` 要分三种看 ——
> `exit code 1` 多为热重建抢单实例锁（假信号，先杀光 `timing.exe` 复测）、
> `0xc0000409` 才是 panic/abort、`exit code 0` 正常收尾。

### 深化融合（一）：运行模型对齐 + 数据互见

计划见 `Active/Timing/for-forg/35-计划-Patina深化融合.md`（D1–D5）。上一轮做到「装得下」，
这一轮解决「没通」。

**① 活动追踪全灭（P0，真 bug）**：Patina 的前台/媒体/音频数据由**独立子进程**采集——
父进程用 `--patina-native-probe <kind>` 拉起自己的可执行文件，走 stdin/stdout 管道。
上游在 `lib.rs::run()` 第一行做这个分派，融合时漏搬。后果链条：子进程不知道这个参数 →
完整启动整个 Timing → 撞单实例锁 → `exit(0)` → 父进程一个字节都没收到 → 记 `cooldown`。
最终 `tracking.stalled=true`、`sessions` 停在导入时刻不再增长，**全链路零报错**，
用户只会觉得「统计不更新了」。修复：`run()` 最前面补 `run_if_requested()` 分派（桌面门控），
实测常驻探针进程 0 → 5 个，`stalled` → `false`，`sessions` 重新增长。

**② 数据互见（D2 读侧）**：`stats_summary` 的返回体加 `activity: ActivitySlice[]`——
区间内按应用聚合的电脑活动（按区间裁剪、最多 5 条）。宿主用**独立只读连接**
（`mode=ro` + 2 s `busy_timeout`）读 `patina.db`，不借 Patina 的连接池：物理上写不进去，
也不会被将来的顺手 UPDATE 污染它的不变量。记录面板顶部因此多出一条「同时在用」窄条。
没有新增 IPC 命令——`stats_summary` 本来就带 `from`/`to`，而 `ipc.ts` 正卡在 300 行门禁上。

**判据**：内存库用例钉住跨界裁剪（会话 10 分钟、区间只覆盖 2 分钟 → 120 秒而不是 600）；
组件用例钉住「空数组整条不渲染」与「时长走 `formatMinutes`」；真库核对今日 Top5 =
WorkBuddy 5575s / Chrome 3157s / Quark 1445s / Weixin 1182s / DeepSeek Harness 1171s。
`npm run check` 全绿、`npm test` 684、`cargo test --lib` 全过。

### 深化融合（二）：vendored 差异门禁（D5 的前置，先立规矩再动前端）

`src/patina/**`（437 文件）与 `src-tauri/src/patina/**`（320 文件）是**源码级并入**的
第三方代码（MIT）。它在的原因有一半是「将来能 diff 上游、按需同步」——而这个能力会被
**无声的顺手改动**吃掉：调个颜色、加一行日志、把长文件拆两半，每一处都合理，攒十轮之后
上游发新版，合并全是逐行冲突，谁也说不清哪几行是我们的意思。D2 反向、D4 去标题栏都要
改 vendored 前端，所以先把这道门立起来。

**基线取「融合完成态」（commit `7bc7bd7`），不是上游原样**：并入时做过一次机械改写
（`crate::` → `crate::patina::` 220 个文件、内联 `#[cfg(test)] mod tests` 拆成
`*_mod_tests.rs` 35 个文件、模块树上移）。这些是搬家不是改需求，用逐文件白名单去表达只会
得到 250 条噪音；真正要盯的是**搬家之后**谁又动了它。融合期的改动仍记在
`THIRD-PARTY-NOTICES.md` 第 1–7 条（人读）。

**三道口**：

1. `node scripts/check-vendored-diff.mjs`（默认，已串进 `npm run check`）——
   工作树 vs 基线，`改 / 增 / 删` 三类任何一项未登记直接红；登记项若与实际类型不符
   （写成 `added` 实际是 `modified`）或**缺 `reason`** 也红；改动被还原后条目会自动提示删除，
   防止白名单变成永久豁免。
2. `--refresh <ref>` —— 从 git ref 重建基线（读 `git cat-file --batch`，**不读工作树**，
   否则「带病冻结」会把没提交的改动悄悄吸进基线）。
3. `--upstream <dir>` —— 查账：与解压的上游副本对账，先把 `crate::patina::` 归一，
   再比内容。**只报告不卡门**，属于「上游发新版前先看我们分叉了多少」的动作。

**归一后的实测分叉**（上游 `patina-main`，2026-11-08 版）：
前端 437 文件 → 同 433 / 实质差异 **4**（`AppSidebar` / `AppTitleBar` / `AboutPanel` /
`windowControlGateway`）；后端 286 文件 → 同 267 / 实质差异 **17** / 仅上游 2
（`lib.rs`、`main.rs`，入口被宿主接管）/ 仅本地 36（`mod.rs` + 35 个 `*_mod_tests.rs`）。
即：除入口与 21 处有意改动，我们与上游逐字一致——这就是「能同步」的本钱。

**变异自证（六项，实跑，结束后工作树复原）**：改文件未登记 → 红；登记为 `modified` → 绿；
还原文件但留着条目 → 绿 + 提示过期；删除文件 → 红（`deleted，未登记`）；新增文件 → 红
（`added，未登记`）；登记类型与实际不符 → 红（`登记为 added，实际是 modified`）。

**没做的一件**：查账模式**不比 `#[cfg(test)]` 之后的测试代码**（拆分时只搬不改）。谁在
`*_mod_tests.rs` 里动了断言，这份报告不会提示——这一点写在脚本注释里，不当成已知。

### 深化融合（三）：D2 反向 —— Patina 历史页看得见「我当时在计什么事」

上一轮只打通了「宿主看 Patina」（记录面板顶部那条「同时在用」）。这一轮反过来：
Patina 的历史页左侧多一张「同期计时」卡片，列出这一天在 Timing 里计过的事项与时长。
两边合起来才回答得了那个问题——「我说在写方案的那两小时，其实一半在刷浏览器」。

**没有新增 IPC 命令**。宿主已经有 `list_records`（区间内的计时记录）与 `list_items`（事项名），
两条都是只读，`Paginated<TimeRecord>` 里没有事项名，所以在窗口里 join 一次即可。
新加一条「聚合好再返回」的命令要动契约四面（`ipc_commands.rs` / `IpcApi` / `ipc.ts` / mock），
而 `ipc.ts` 正卡在 300 行门禁上；一天几十条记录，两条已有命令跑得动。

**权限单开一份**：`permissions/patina-host-bridge.toml`（`patina-host-bridge`，只放行
`list_records` + `list_items`），由 `capabilities/patina.json` 引用。没有把它们塞进
`window-commands.toml`——那份的语义是「Patina 子系统自己的命令面」，宿主命令混进去会让人
以为 Patina 能调宿主的一切。**写的命令一条都不给**。

**口径**：日期区间取 `startOfLocalDay(presentedDate)` 到次日零点，与宿主记录面板同一个日界；
过滤走同一条 SQL（`started_at >= from AND started_at < to AND status='saved'`），
所以两边的「今天」不会打架。**正在计的那一条不计入**（`status='saved'` 才落库统计），
这与宿主记录面板同口径，不是新规矩。

**失败即空**：命令被拒、库打不开、宿主没就绪 —— 一律退化成空数组，卡片整块不渲染。
这是旁证块，不该让历史页因为它报错。

**判据**：`buildTimingOverlap` 6 条纯函数用例（同事项合并 / 降序 / 上限 / 无名字丢弃 /
零秒跳过 / 空）；变异自证两项（排序方向反转 → 3 条红；去掉名字过滤 → 1 条红，还原后 6 绿）；
`npm test` 690 通过；`npm run check` 全绿；vendored 门禁登记 6 条（1 改 5 增）。
上游前端原本没有任何用例，`timingOverlap.test.ts` 是本项目给 vendored 加的第一处。

### 深化融合（四）：D3 主题统一 —— 深/浅只认宿主一个开关

**症状**：融合后两边各存一份 `theme_mode`。主窗选深色、点托盘进「时间统计…」，
分析窗是浅的；在分析窗里改成深色，主窗又不变。用户只看见「同一个 App」，
没人能解释这两个窗口为什么各说各话，也没人能找到另一个开关在哪。

**口径（主人裁决：主题统一，按我的来）**：Patina 不复制主题值，直接向宿主要——

| 时机 | 通道 | 谁用 |
| --- | --- | --- |
| 窗口启动 | `theme_get` 读一次 | 分析窗 / 迷你窗 / 提醒弹窗 |
| 宿主改了 | `theme-changed` 广播（K-21，各窗自订阅） | 同上 |
| Patina 设置页点了 | `theme_set` **写回宿主** | 只有分析窗 |

**没有第二份真源**：`app_settings.theme_mode` 降级为回落值，只在拿不到宿主状态时生效
（首帧竞态、ACL 未就绪、浏览器里单跑）。`loadAppSettings` 用宿主值覆盖它，设置页的
高亮与真实显示因此一致；写失败回滚本地 draft——界面停在 light、实际还是 dark
比不给开关更糟。

**最危险的一处不是颜色，是就绪判据**。主窗「渲染好了没有」由
`hasRenderableMainWindowFrame` 判定，它内部拿 `isDocumentThemeApplied(themeMode, …)`
比对 DOM 上的 `data-theme`。主题改由宿主决定之后，若判据还传本地模式，
本地是 light、宿主是 dark → 永远判不一致 → **窗口能开、永远不显示、不报错**。
`useAppThemeMode` 因此改为返回「实际生效的模式」，判据与 effect 依赖都吃这个返回值。

**竞态**：先订阅、后读。反了会丢两次之间的变更；读慢、事件先到的话，
读回来的旧值还会把新事件盖掉（`received` 标记正是拦这个）。这段逻辑抽成纯函数
`createHostThemeSync`，组件里只剩一个 `setState`。

**权限拆两条**（`permissions/patina-host-theme.toml`）：
`host-theme-read`（`theme_get`）给分析窗与提醒弹窗，`host-theme-write`（`theme_set`）
**只给分析窗**——提醒弹窗没有设置页，不该有改主题的能力。

**判据**：`createHostThemeSync` 6 条用例（应用一次 / 旧值不盖事件 / 读不到不应用 /
订阅不可用仍读 / 取消后不再应用 / 取消早于订阅返回）+ 4 条源码级接线判据
（判据按**位置**取实参、依赖里无裸 `themeMode`、落 DOM 用宿主模式、设置页真写回）。
变异自证五项：去掉 `received` → 1 红；取消时不注销订阅 → 1 红；取消后仍 apply → 1 红；
判据实参退回 `themeMode` → 1 红；**两实参对调** → 1 红（位置断言才抓得到）；
删掉写回调用但留着 import → 1 红（纯字符串断言抓不到，这条是被变异逼出来的）。
`npm test` 700 通过；`npm run check` 全绿；vendored 门禁 14 条（5 改 9 增）。

**没做的**：语言与开机启动仍在两边各存一份（D3 余下），它们的写法与主题不同——
语言要带 i18n 资源预加载，开机启动要走 `autostart` 插件而不是数据库——分成两轮做。

## 0.11.28（桌面）— 同步文案与日记模板 — 2026-11-09

本轮轮次流水号 0.11.33（文档/commit 标号），桌面出包按双轨 +1 = `0.11.28`。**手机端
出包归安卓轮（主人指示「安卓端优化不用你来」），手机版号维持 0.11.33 不动、不预占**；
T04 小圆点 Kotlin 改动已入库（`4c2c3d0`），随安卓轮下一包走。实现 `921c84f` / `7f85328` /
`7d962da` / `4c2c3d0` + 版本号 `dfd1b82`、`000ac11`。

### 四条主人需求

1. **设置页标题与解释改写**：块④「WebDAV本地同步」（本地有同步文件夹选择（如坚果云同步），
   不再需要上传同步）、块⑤「WebDAV云端同步」（WebDAV 多端同步，从云端下载上传多端数据）、
   块③ Markdown 同步 hint「数据汇总至 md 文档，便于 ai 汇总读写」。
   `mdSyncCopy.ts` 文案常量改值，REMOVED_PHRASES 删 1 增 5（原位记账）。
2. **自动同步口径钉死三档**：关闭 / 自动（可设间隔分钟）/ 智能（启动后 1 分钟一轮、
   停手 5 分钟一轮、30 分钟兜底一轮）。线缆 `off/interval/smart` 零迁移，纯标签与描述；
   手机端 SyncCloudPane「定时→自动」（R2 红线解除一次，主人批准）。
3. **小圆点形态**：内部指针改 2.5dp 宽竖条（drawRoundRect，save/rotate），删外圈半透明
   玻璃层与 RadialGradient；**有意偏离 0.3.6 归档基线，不回改**（主人口径）。
4. **日记模板**：md-sync 配置新增 `diary_template`（全局一份绝对路径，支持环境变量展开，
   空串不落盘零迁移）；同步**首次写出**某日期日记文件时以模板打底（文件已存在不套；
   路径无效降级 warn 不阻断）。契约 79 命令不变。

### 判据与门禁

- PRD P1–P19（`for-forg/30-PRD-v0.11.33-同步文案与日记模板.md`），QA 独立验证全 PASS。
- 门禁：check EXIT 0（契约 79/17/11、桌面 0.11.28 六处一致、手机 0.11.34/11034）、
  前端 682、cargo 726；变异自证 3 条实测红→还原绿（REMOVED_PHRASES / seed exists 短路 /
  竖条宽度 grep 判据）。
- 红线：md_file.rs / probe.rs / md_backup.rs 零 diff；`md_sync/mod.rs` +2 行净 0
  （已裁决放行，压缩注释抵消）；components/mobile 仅 SyncCloudPane 两文件（R2 批准范围）。

## 0.11.33（手机）— 双轨版号：手机与桌面分家（基建，零功能改动）

主人要求「给手机版 Timing 赋予单独版号，不再与电脑端一致」。本节原标「未发布」，
已于 2026-11-09 以手机包 `Timing-android-0.11.33-release-arm64-debugsigned.apk` 出包
（commit `8d96006`，构建溯源见 `release/BUILD-INFO-0.11.33.txt`）。

### 为什么必须分

双轨之前六处基线被两端共抢：桌面最后出包是 `0.11.27`，手机已到 `0.11.32`，而六处写的是
`0.11.32` —— **下次出桌面包会从 27 直接跳到 32，中间四个号全不属于它**。
「统一版号」事实上早已失效，只剩门禁还在硬要求它们相等。

### 口径

新增 `scripts/platform-versions.json` 作单一真源：

- `desktop: "0.11.27"` → 六处（`package.json` / `package-lock.json` ×2 /
  `src-tauri/Cargo.toml` / `Cargo.lock` / `tauri.conf.json`）必须等于它；
- `mobile: { versionName: "0.11.33", versionCode: 11033 }` → `scripts/android-apk.mjs`
  只读它，**不再从 `tauri.conf.json` 派生**。

六处因此**回退**到 `0.11.27`（桌面真实已发版本），不是写错。

### 门禁加两条

1. `mobile.versionCode` 必须与 `versionName` 同源（`major*1_000_000 + minor*1_000 + patch`，
   与 tauri CLI 一致）。只改一个的话系统按旧号判重，以后再也升不上去。
2. `mobile.versionName` 不得低于 `release/` 与 `release/archive/` 里已发出 APK 的最大号 ——
   Android 拒绝降级覆盖安装，用户看到的是「应用未安装」而不是「版本旧了」。

### 验证

`npm run check` EXIT 0；变异三条各自只红对应用例后逐字还原（同源但回退 / 版本码不对 /
六处之一手滑）。**未出包**：工作区有并行任务（日记模板 T02）未收口，`md_sync_config.rs`
加了 `diary_template` 但 `config.rs:73` 构造点没补，cargo 编译不过。本轮零功能改动，不出包。

## 0.11.32 — 便利贴看全文 / 悬浮条点按修好 / 未命名计时（只有手机包）

主人四条反馈。第 2 条是 0.11.22 起就存在的真 bug，两端都不报错。

### 悬浮条：整条投递路换成 evaluateJavascript

- 删掉 `addPluginListener` / `Plugin.trigger` / `hasListener`：那条路要 Tauri 自己的
  `registerListener`（内部 `invoke.parseArgs` = Jackson 反射）注册成功，本仓为躲 R8 早把
  自己的 `parseArgs` 换成 `getArgs()`，唯独这条链没换。注册失败 → 前端 `.catch()` 吞掉 →
  `hasListener` 恒 false → 点按只剩圆点展开；
- 新增 `PillService.JS_ENTRY = "__timingPillTap"`（前端 `PILL_ENTRY` 同名）：
  `markPendingAction(kind)` → `dispatch(kind)`（`evaluateJavascript`）→ 1.2s 后
  `verify()`（标记还在 + 快照没变 → `lastTapError` 进通知副标题）；
- 切状态前先 `useTimerStore.refresh()`：后台期间 store 的 `status` 可能是旧的，
  拿旧值发"暂停"必然被拒；
- 长按：`openApp()` 先投 `kind='open'` 再 `startActivity`；前端收 `open` →
  `closeSheet()` + `setTab('timer')`（主人要"应跳转至计时界面"）。

### 便利贴：点行看整张

- 新 `NoteViewSheet` + `kind: 'noteView'`：全文 `pre-wrap`、`max-height: 52vh` 可滚、
  无 line-clamp；归属与更新时间；底部「编辑」→ `noteEdit`；
- 点按从 `useLongPress` 的第二实参换成正经 `onClick`，长按后的 click 用 `longPressed` 挡掉；
- 样式进 `styles/mobile/notes.css`（`.m-note__full` / `.m-note__viewmeta`）。

### 未命名计时

- 悬浮条点按在待机时 `start(SYSTEM_ITEM_ID)`（未命名的一笔，不是 `lastItemId`）；
- `useTimerActions.stop()` 回值 `() → StopResult | null`（桌面调用方仍 `void`）；
- 新 `hooks/useStopNaming.ts` + `components/mobile/NameStopSheet.tsx` +
  `kind: 'nameStop'`：只在 `isUnnamedRecord` 时弹，`discarded` 不弹；
- 新 `lib/unnamed.ts`（`isUnnamedRecord` / `normalizeName` / `matchItemByName`）：
  先找再建、全等匹配；`recordApi.update(record.id, { itemId })` 只改归属；
- 文案：「行尾的图钉 = 设为常用」（删掉"与电脑版同一份设置"）。

### 判据与门禁

`lib/unnamed.test.ts`（9）、`hooks/usePillAction.test.ts`（重写 12）、
`hooks/usePillAction.tap.test.ts`（6）、`components/mobile/MobileSheets.r32.test.ts`（8），
另改 `usePillAction.source.test.ts` / `SyncPane.source.test.ts` 各 2 条。
`npm test` 677 通过；`cargo test --lib` 719；变异自证 6 条（见 `release/BUILD-INFO-0.11.32.txt`）。

## 0.11.31 — 手机端三条口径定稿（只有手机包）

主人对上轮三条待定的回复：常用事项「是用户自己设置的，参考 pc 端」、事项页改口径「可以」、
记录页「把本周改为往期，可选择本周、近七天、本月、往日等」。

### 换事项：常用 / 最近用过 / 其他事项

- 复用电脑版 `lib/moyu.pinnedItems` + `recentItems`（`RECENT_ITEMS_DEFAULT`），没另写算法；
- 每行右边图钉 → `itemApi.update({ id, patch: { isPinned: !item.isPinned } })` →
  `useItemStore.reload()`；`is_pinned` 就是电脑版认的那个字段，不新增本地偏好；
- 三段互斥；一行 = 「左按钮 + 右图钉」两个并列按钮（`button` 不能套 `button`，WebView 会吞内层点击）。

### 事项页第三段：已完成待办

- 新增 `src/lib/todayDone.ts`：按 `itemId` 完全合并今日记录，多段 = 一行 + 合计 + ×N；
- 今天打勾的待办即使零记录也出现；计了时没打勾的保留并标「未勾选」；
- 认领顺序先 `itemId` 再标题（改名不失配、`itemId` 为 null 的也能认）；
- 删掉上一版的行尾「▶ 开始」与长按开始：这一页不再有计时入口（「不与计时界面功能重复」）；
- `DoneRow.tsx` 抽成独立组件（行数门禁：`ItemsPage` 331 → 281）。

### 记录页五档

- `RecordsRange = 'day' | 'week' | 'last7' | 'month' | 'date'`；`rangeBounds(range, reference?)`；
- `rangeLabel` / `rangeHint` / `dateInputValue` / `parseDateInput` / `parseDateTimeInput` / `timeInputValue`
  一并落在 `lib/time.ts`（页面不算时间）；
- 往日用原生 `<input type="date">`，`max` 卡今天；档位横滚 `m-seg--scroll`；
- `useRecordsData(range, reference?)`：只有往日传基准日，其余 `undefined`（避免每帧重查库）。

### 待办排时间 + 提醒可见

- 新 `TodoPlanSheet` + `mobileUiStore` 新 kind `todoPlan`；入口是待办输入框右边的日历按钮，
  空标题时明说「先写要做什么，再排时间」；
- 字段口径照电脑版：**开启时间 → `remind_at`**；`create(title, null, at)` 的实参顺序被判据钉死
  （写进 `planned_at` 会被后端当截止时间逾期清掉）；
- 过去的时间禁用提交；点击里 `ensureNotifyPermission()`；
- `jobs::nudge` 增 `notify_nudge`：`#[cfg(mobile)]` 发系统通知，`#[cfg(desktop)]` 空实现。

### 强化

- `SheetHost` 去掉 `default: return null`，改穷尽 switch + `const never: never`。

### 判据与变异

- 新增 `src/lib/time.test.ts` 13 条、`src/lib/todayDone.test.ts` 8 条、
  `MobileSheets.source.test.ts` +11 条（含「事项页不许再出现计时入口」）；
- 变异 5 条：取消合并 / 时间写进 `plannedAt` / 图钉写回原值 / 近七天算成八天 /
  `SheetHost` 退回 `return null` —— 各自只红对应那一条，逐字还原。
- **行数门禁逼出两次拆分**：`ItemsPage` 331→281、`items.css` 391→241（新 `items-done.css`）。

### 数值

`check` EXIT 0（契约 79/17/11、size 662、version 0.11.31 + vc 11031、layers 8、brand 0、eslint 0）；
`npm test` 653（79 文件，+30）；`cargo --lib` 719/0/1ign；APK 11,137,060 B `1e964b8f…`；
`.so` 内前端资产 `index-BVhH7yNY.js` ×1、两个旧资产 ×0；新 Rust 通知文案 ×1。

## 0.11.30 — 点了没反应：五个面板的 X 一起修（只有手机包）

主人一次报 9 条。其中 1/2/8 是同一个 bug。

### 根因：事件对象被当成了 kind

`Sheet` 的关闭按钮是 `onClick={onClose}`（遮罩也是），React 把 MouseEvent 当第一个实参传进
`closeSheet(kind?)`；旧实现用 `kind != null` 判断「有没有指定类型」——事件对象对它也为真，
于是 `s.sheet.kind !== <MouseEvent>` 恒成立 → 返回原 state → 面板不动。

裸传的调用点五个（倒计时 / 换事项 / 事项菜单 / 记录编辑 / 便利贴归属），全中。

**为什么长期没被发现**：另外两个出口（下滑抓取柄、Android 返回键）不走 `onClose`，
手动测试容易被掩盖；单测从来没点过那个 X。

### 改法

1. `mobileUiStore.closeSheet` **只认字符串**，非字符串实参当「不指定类型」→ 直接关
   （第二道防线，管已经写下的调用点）。
2. 五个面板各自 `closeSheet('<kind>')`：语义从「碰巧能关」变成「只关我这一张」。
3. `RecordRow` 改成 `useLongPress(onStart, onEdit)`：点按 = 事项编辑，行尾「▶ 开始」
   按钮（`m-record__start`）负责计时，长按同义。行内按钮吞掉 `pointerdown/up`，
   否则外层长按计时器同时启动、松手又弹一次编辑。
4. 便利贴行内加可见删除键（`m-note__del`），长按删除保留。
5. 计时页工具条第三个按钮「同步」：调同一个 `mobileNative.syncRun()`，结果走提示条；
   文案抽成 `lib/mdSyncText`（`SyncPane` 同步改用），失败照说后端原文。

### 判据

- `src/stores/mobileUiStore.test.ts`（5 条，含两条**事件对象**回归本体）；
- `src/components/mobile/MobileSheets.source.test.ts`（9 条：禁裸传、各关各的 kind、
  `Sheet` 两个出口、点行 = 编辑（**接线级**）、行尾按钮吞指针、便利贴删除键、同步复用）。
- 变异三条：退回 `kind != null` → 2 红；改回 `onClose={closeSheet}` → 1 红；
  `useLongPress` 两个实参对调 → **第一版没红**（只钉 JSX 属性名），加接线断言后才红。

### 没做

快捷事项菜单（近期/常用）、事项页改「已完成待办」+ 待办预计时间/提醒/日期、
「本周没有往期数据」（查不出复现路径，需要现场信息）。

### 数值

`npm run check` EXIT 0（契约 79/17/11、size 656、version 0.11.30 + versionCode 11030、
layers 8、brand 0、eslint 0）；`npm test` **623**（77 文件，+14）；安卓 BUILD SUCCESSFUL，
包 11.1 MB，sha256 `d0b3b3bb…`。包身：前端资产 `index-CTjhEvVP.js` ×1、旧资产 ×0。

## 0.11.29 — 点按切计时，长按才进 App（只有手机包）

主人原话：「点按暂停 长按再跳转至界面」。0.11.27 / 0.11.28 修的是「悬浮条和主界面没联系」，
这版修反过来的毛病：联系有了，但「点一下」和「进 App」还缠在一起。

### 三处偏掉的地方

1. **`onTap()` 一下就是一下**：删掉「圆点形态 + 计时中 + 未展开 → `expandTemporarily();
   return`」这个分支。第一下只把圆点拉成条、计时一秒没停，体感就是「点了没反应」。
   展开仍然给（28dp 的圆点、暂停又不换色，不亮一下时长没法确认按到了），
   只是改成「先切状态，再展开」，不再吃掉这一按。
2. **`requestAction()` 失败不再跳转**：`bridge?.invoke() != true` 时原先是 `openApp()`，
   于是「前端没在听」（进程被回收 / WebView 已销毁）的那一按会把人拽进 App。
   现在只做两件事：`lastTapError` 写进通知副标题（「没连上界面，这一按已记下：回到 App
   时补做」）+ 标记照旧落盘给 `overlayTakeTap` 补做。**动作不丢，人也不被拽走。**
3. **长按写明并补反馈**：`PillDrag` 的 KDoc 改成「短按切计时 / 长按打开 App」，
   命中长按时 `performHapticFeedback(LONG_PRESS)` 震一下——520ms 之后手指还压着，
   到 Activity 起来之间有一段空白，不震一下用户会以为没按够。

`openApp` 的失败文案同步从「点悬浮条…」改成「长按悬浮条…」：这条路径现在只有长按会走到。

### 判据

`usePillAction.source.test.ts` 新增 `手势语义：点按切计时，长按才跳转（V0.11.29）` 四例：
`tap_never_opens_the_app`（`onTap` 体里不许出现 `openApp`）、
`failed_action_does_not_steal_a_tap`（失败分支不许出现 `openApp`，且必须写 `lastTapError`）、
`long_press_still_opens_the_app`（`::openApp` 接线 + `LONG_PRESS_MS = 520L`）、
`dot_tap_is_not_swallowed_by_expand`（不许再有「展开后 `return`」）。
变异三条（改回旧分支 / 加回 `openApp()` / 长按改走 `onTap`）各自红，之后逐字还原。

### 数值

`npm run check` EXIT 0（契约 79/17/11、size 653、version 六处 + `tauri.properties` 11029、
layers 8、brand 0、eslint 0）；`npm test` **609**（75 文件，+4）；`cargo test --lib` 719/0/1ign
（后端零改动）；安卓 `BUILD SUCCESSFUL`，包 11,132,964 B，sha256 `bde019c7…`。
前端资产哈希与 0.11.28 相同（`index-jh3N-dDb.js`）——本轮前端只改了一句注释，
也顺带证明点按/长按全在原生侧。

## 0.11.28 — 悬浮条按归档原生版对齐（只有手机包）

主人问「悬浮条效果是否和 tickbar 一致」。tickbar = 归档的 `android-app`（com.tickbar.droid 0.3.6），
本仓 `overlay/` 七个 Kotlin 文件是它的移植版，因此逐文件比对而不是凭印象。

### 补回的四处

1. **倒计时向上取整**：`timeTextOf()` 按 `snap.countdown` 分流（倒计时 `ceil`、正计时 floor）。
   此前向下取整，设 5:00 立刻显示 `04:59`，最后一秒挂着 `00:00`。
2. **小时补两位**：`1:05:03` → `01:05:03`（`PillView.timeText` 与 `OverlayNoti.clock` 同步）。
   通知里的时长**不做 ceil**：入参已是剩余整秒，再取整会显示 `05:01`。
3. **配色回归档口径**：`ringColor()` = 结束绿 > 最后一分钟红 > 计时蓝，删掉 `PILL_IDLE`
   （暂停不再变灰）。状态机没有 `Phase.DONE`，绿环由 `PillService` 观察 `active` 下降沿
   画 3 秒（`DONE_FX_MS`），重新开始立刻撤掉。
4. **通知栏动作按钮**：计时中 `暂停/继续` + `结束`，待机只给 `开始`；图标取自归档工程的
   `ic_noti_pause/play/stop`。按钮**不直接改状态**：`getService` → `PillService` →
   `bridge` → 前端 → Rust，原生仍不写计时库。

### 动作链带类型

`Prefs.markPendingTap(时间戳)` → `markPendingAction(kind)`（`动作@时间戳`）。只存时间戳时，
「点了结束但没人接」会在回前台时被当成交替执行。`overlayTakeTap` 回值新增 `action`，
`usePillAction` 两条 channel（`pill:toggle` / `pill:finish`）按它分派 `togglePause()` / `stop()`。
旧键 `pending_tap_at` 只读不写：升级前留下的标记仍按 `toggle` 补做一次。

### 红线与判据

原生一个字节都不写计时库；契约 79/17/11 不动；无新命令、无新迁移、桌面零代码改动。
前端 605 例（75 文件，+10）、`cargo test --lib` 719/0、`npm run check` EXIT 0。

---

## 0.11.27 — 设置页「数据管理」重排 + 悬浮条两个方向接通

一版两件事：桌面是设置页改造（主人四条原话），手机是悬浮条修复（线上故障插队）。

### 设置页（桌面，主人四条）

1. **「只用本地 / 本地 + 云端」通道选择器整组删除**。它表达的事——云端开不开——
   已经由每条通路自己的开关表达，同一个意思不该出现第二个控件。
2. **所有设置默认折叠**。折叠态标题、一句说明、备份当条记录仍可见；展开态不记忆
   （下次打开全部收起），点开过的状态不持久化。
3. **云端同步增设开关**：形态与块③「启用 Markdown 同步」一致（块标题右侧）。
   开关管「这条通路跑不跑」，三档（关闭 / 定时 / 智能）管「自动路径怎么跑」，
   两层各司其职，三档的「关闭」档保留。
4. **本地目录与 WebDAV 分离**：「本地目录」更名「本地同步」，与「云端同步」各自成块、
   各带开关、各带一份三档。**两条通路允许同时开**：一轮 = Obsidian 半轮（只跑一次）→
   本地镜像 → WebDAV 推送；一条失败记自己的错、写自己的状态行，不挡另一条。
   调度链两条通路独立到点（各自的三档决定各自的节奏）。

配套：`md_cloud_pending` 迁移 0007（加 `folder_hash` / `folder_pending_since` 两列，
旧行欠账全部折给 webdav 通路）；托盘标签三态（Markdown 同步 / 本地同步 / 云端同步）；
读时推断迁移（老 `cloud` 单键配置纯内存折算成两条通路，磁盘零迁移脚本，落新结构发生在
下一次保存）；手机端面板照旧读 legacy 投影（`components/mobile` 零 diff 红线未触碰）。
契约 79 命令 / 17 错误码 / 11 事件零变化。

### 悬浮条（手机，故障修复）

主人报「悬浮条和主界面依旧无联系」，两个方向都断：

- **显示方向**：原生 `TimerReader` 认死 `dataDir/timing.db`，读不到就永远待机。
  显示源改为 **Rust 状态机推快照**（`overlay_push`），读库退为兜底，读不到时把原因写进通知。
- **点击方向**：`Plugin.trigger` 只在 WebView 活着且监听挂上时有效，错过就静默消失。
  补了一条**落盘兜底标记**（`Prefs.markPendingTap`，90 秒有效）：没人接就回前台补做，
  补不了就说为什么。

桌面端 overlay 推送为空实现，只跟版本号。

## 0.11.26 — 手机同步「建不了云端落点目录 permission denied」：`\` 不是 POSIX 的分隔符

故障修复，零新增命令 / 零错误码变化。主人原话：「错误信息 建不了云端落点目录 permission
denied（os error 13）／测试连接成功 但无法将日记写回本地」。

### 根因

出厂落点模板是 `r"%APP_DIR%\md-webdav"`（Windows 写顺手了）。手机的数据根是
`/data/user/0/com.timing.app`（Tauri `getDataDir` = `activity.dataDir`，**不是** `.../files`），
展开后得到 `/data/user/0/com.timing.app\md-webdav`——在 POSIX 上 `\` 是**普通字符**，
这整串是**一个**路径分量，于是 mkdir 的父目录成了 `/data/user/0`（root 所有、应用不可写）
→ `EACCES`（os error 13）。

「测试连接」只碰网络（GET 目录 / MKCOL / PUT 探针），一个本地目录都不建，所以它永远是绿的。

### 改了什么

- 分隔符归一放在 `infra::md_env` 展开的**最后一步**：`%APP_DIR%\md-webdav`、`%APP_DIR%\md`、
  用户自填的根目录三条路一起受益。判据是纯函数
  `resolve_template(raw, app_dir, mobile)`——`mobile` 是**参数**不是 `cfg!`，桌面目标的用例
  也能断言 Android 那一支（本项目第四次踩「判据被 `cfg` 遮住」）。
- `normalize_separators` **只在非 Windows 上动手**：桌面落点一个字节没变。
- 「建不了云端落点目录」的文案补上**具体路径**（`services::md_cloud::root_dir_error`）：
  落点有两个可能、两端系统又不同，缺了路径这句话只能靠猜。
- 每轮多一行 `md cloud: root=<路径>` 日志：手机沙箱用户看不见，「今天的日记写到哪了」只有日志能答。

### 判据

Q1 出厂模板在 POSIX 上落成数据根的**直接子目录** / Q2 Windows 上逐字不变 / Q3 用户自填目录同样归一 /
Q4 错误必须带路径 / Q5 模板仍用 `%APP_DIR%` 占位 / Q6 云端落点与 Obsidian 落点不重叠。
变异：把 `normalize_separators` 的 `if mobile` 改成 `if false` → Q1/Q3 当场红，还原后绿。
Q7（真机：同步后数据根下真的出现 `<日期>.md`）只有主人能验。

门禁：契约 79/17/11、size 640、version 0.11.26 六处、layers 8、brand 0、eslint 0；
`cargo test --lib` 696/0/1ign（+9）；`npm test` 582；安卓目标 0 warning。

## 0.11.25 — 手机点「测试连接」闪退：根证书从运行时状态改成编译期常量

故障修复，零新增命令 / 零错误码变化。主人原话：「点击测试链接  软件闪退」——手机端设置里的「测试连接」。

### 根因

reqwest 0.13 的 `rustls-no-provider` 会拖 `rustls-platform-verifier`（读系统根证书）。那个后端
**在 Android 上必须先由 Kotlin 侧初始化 context**，否则验证时
`global().expect("Expect rustls-platform-verifier to be initialized")` 直接 panic；而
`[profile.release] panic = "abort"` → 进程当场被杀。本项目没有引那个 AAR，也没有初始化调用。

桌面正常（Windows 走 SChannel，不需要 init），本地用例也发现不了（打的是假 HTTP 服务端，
走不到证书校验）——于是「桌面绿、手机崩」藏了三轮。

### 改了什么

- 新增 `infra/md_webdav/tls.rs`：`root_store()` / `client_config()` / `builder()`，根证书来自
  `webpki-roots`（编译期常量，无 JNI、无初始化动作）。
- 三处 Client（`client()` / `mkcol_client()` / `remove_client()`）改成
  `OnceLock<Result<Client, String>>`：失败缓存、对外回 `WebdavError::Network(文案)`（走既有
  `fail_text_at` 出红字），**不再回退** `Client::new()`。
- `remove.rs` 的 `.expect("DELETE 专用 Client 必须带 Policy::none()")` 删掉——注释写着「不 panic」，
  代码却 panic。仍不退回默认 Client：那会丢掉 `redirect(Policy::none())`，DELETE 跟随 3xx 会
  「删了另一个文件还报成功」。
- `Cargo.toml` 新增 `webpki-roots = "1"`。

### 代价

企业自签 / 内网私有 CA 不再被信任（红字「证书校验失败」，不是闪退）。公网 CA 全部照常。

### 验收

`tests/md_webdav_tls.rs` 三条 + 一条 `#[ignore]` 真网络握手（手跑：坚果云端点 → HTTP 401，
证书已通过）。变异自证：注释 `roots.extend(..)` → `roots_are_built_in` 红（0 条），还原后绿。
门禁 EXIT 0（契约 79/17/11、size 639、version 六处 0.11.25）；cargo 687/0/1ign；安卓目标 0 warning。

## 0.11.24 — 异常退出恢复：两条路都带数字，不再让你心算

批 2 落地（12-PRD §13.5，排期从 0.11.20 顺延三轮后补上）。**改造一个已存在的对话框**，不是新建弹窗。

### 改了什么

- **四元素收三元素**：`继续计时` + `结束并保存` + 复选框`把退出期间也计入` + 同级`丢弃`
  → **`一直算到现在（13:40:12）` + `结束在 18:40（04:12:30）`两个主按钮 + 文字级`丢弃这段`**。
  复选框的全部含义被选项 A 吸收：勾上 = A，不勾 = B，同一件事不再用两个控件表达。
- **选项 B 的结束时刻取关闭时间，不是 now**（本轮唯一行为变化点）。关闭时间 = `running_since`
  （最后一次落盘锚点，周期落盘 15s → 误差 ≤30s）。累计 = 关闭时刻 − 开始时刻，**不含**关机那段；
  跨零点落在关闭那一天（按 ADR-043 拆分）。选项 A 则把空档也算进去，从开始时刻连续推算到此刻。
- **Esc 翻转**：Esc = 次按钮（`结束在 …`），不再是继续计时——空档没法证明是工作，虚增十几小时
  事后极难拆改，少算只需重开一次。点遮罩仍不关闭。
- **暂停中崩溃走单按钮分支**：只显示`结束并保存（…）`，元信息`09:12 开始，已暂停`，
  不编造关闭时刻（暂停后没有流逝，关闭时刻对结果无影响）。
- **多条 active 脏数据**：只针对 `started_at` 最早的一条弹框，其余按关闭时间结束 + `log_warn`，
  选完库里 active 必须为 0。
- **桌面托盘退出接线**：`tray_quit.rs` ② 位（挂点注释从 0.11.18 留到现在）——退出时若有 active
  记录按关闭时间收尾，**必须在 ③ 同步之前**（先同步后收尾会永久丢一段：同步轮导出的是收尾前的秒数）。

### 边界

关闭时间不可信时用 `running_since` 兜底；墙钟回拨导致负数按 0；空档 < 1 分钟仍弹（active 必须被解决，
但两条路语义不同，不能替用户决定）；弹窗不超时、不自动选。没有心跳、没有杀进程 handler（N14）。

### 验收

前端 9 条（H1/H4/H6 DOM 断言逐字 + Esc + 暂停分支）+ 后端 6 条（H2/H3/H5 库断言 + 跨零点 +
托盘退出收尾）。QA 三条变异自证**亲手复放**全红：①结束时刻改回 now、②Esc 改回继续计时、
③跨零点落"今天"，还原后全绿。门禁整链 EXIT 0，契约 79/17/11、迁移 `0006` 零变动，手机端零 diff。

## 0.11.23 — 手机端备份导出：把那份 `.md` 交到用户手里

上一版的备份只差最后一截：**能列、能恢复、拿不出来**。拿不出来的备份对用户不可验证——发不出去、
留不了档、换机前也拷不走。这一版补的就是这一截：走系统「保存到…」，用户自己挑位置。

### 1. 新命令 `md_backup_export`（契约 78 → 79）

- 入参 `{ name }`，出参 `MdBackupExport { saved, name }`；**错误码 17 / 事件 11 / 迁移 `0006` 都不动**。
- `saved: false` = 用户在选择器里按了返回，**不是失败**（不抛错、界面不出红字）。
- 桌面侧是 `mobile_only("导出备份")` 桩：电脑上备份就在 `data\backups\md\`，卡片上的「打开」
  直接能看，不需要另存为。

### 2. 判据在 `services`，不在 `#[cfg(mobile)]` 的命令文件里

`services::md_backup_export::resolve_in(root, name)` 是纯函数，四道闸：

1. 名字：空串 / `..` / `/` / `\` 一律不认；
2. 形态：`parse_name` 不认的名字（`readme.md`、时间戳不合形）不是备份；
3. 落点：`canonicalize` 之后**必须仍在备份根内**（防符号链接把路径带出去）；
4. 存在：备份只保 30 份，用户点的那条可能刚被挤掉——给一句能照做的原话。

`root` 是参数而不是全局 `OnceLock`：这样桌面目标的用例能在临时目录上验它（`md_backup` 的根
一个进程只认第一份，碰不得）。

### 3. 原生与界面

- `TimingNativePlugin.exportBackup`：`ACTION_CREATE_DOCUMENT` + `CATEGORY_OPENABLE` +
  `EXTRA_TITLE`（导出名去掉落点前缀，扩展名随名字走）；写回走 `contentResolver.openOutputStream`。
  取消 → `resolve { saved: false }`；写失败 → `Log.w("TimingExport", …)` + 原文交给用户。
- 字节**不过桥**：Rust 与 Kotlin 同一个进程、同一个私有目录，Rust 只交「哪个文件 + 建议叫什么名」。
- `SyncBackupPane`：每条备份都有「导出」（导出是副本，不需要落点，`obsidian__` 的老底也能导），
  「恢复」仍只在 `webdav__` 上出现；结果落在那一行下面，取消用弱化色、不用红。

### 4. 数字

前端 70 文件 **573** 用例（基线 564，+9）；Rust **679/0**（基线 669，+10）；`npm run check` EXIT 0
（契约 79 / 17 / 11、size 634、version 0.11.23 六处、layers 8、brand 0、eslint 0）；安卓目标 0 warning。

## 0.11.22 — 手机端收敛：只走云端 · 备份能恢复 · 悬浮窗能计时

主人三句话，三件事：「手机端无法使用云端的本地同步，此功能去除，仅保留云端同步」/
「数据管理的恢复功能可做」/「主界面与悬浮窗计时不同步，主界面唤起计时，悬浮窗无法计时」。

### 1. 手机端只剩云端一条同步通路

- `app/md_sync_mobile.rs::sync_once` 删掉 SAF 三步（`safStatus → mirrorIn → run_in → mirrorOut`）
  与只为它存在的 `mirror_root()`。云端不可用 → `MD_SYNC_CONFIG_INVALID` +
  「手机端只同步云端：先在「设置 → 数据管理」里填好服务地址、账号和应用密码，再点保存」。
- `jobs/md_sync_mobile`：`Legacy` 分支**不再跑轮**（v0.11.21 前它按 `pollSecs` 跑 SAF），
  只 60 秒醒一次等配置变化。判据是纯函数 `services::md_cloud::tier::mobile_rounds(&plan)`。
- `commands/md_sync_cmd_mobile::md_sync_run`：云端不可用时不再回落 SAF；可用时仍走
  `round_manual`（手动 = 现在就再试一次）。
- 界面：`SyncPane` 移除「日记目录 / 更换 / 三个事项绑定 / 只用本地·本地+云端」，
  只留云端一块 + 立即同步 + 备份与恢复；`SyncCloudPane` 去掉通道二选一，开关收到块首，
  **一次写 `config.enabled` 与 `cloud.enabled` 两处**（两个闸并存时「关掉」到底关哪个解释不清）。
- 后端 SAF 能力保留（`md_saf_status` / `md_sync_open` 仍在 78 条契约面上），
  下线的是入口与调度，不是代码。

### 2. 手机端备份与恢复（真实现，替换掉「请在电脑上操作」）

- `md_backup_list` → `services::md_backup::items()`；`md_backup_restore` → `restore()`
  + `md_sync::dirty::mark("record")`（与桌面同口径）。
- 归属判据 **`services::md_backup::restorable_on_mobile`**：手机只有 WebDAV 一个落点，
  只放行 `webdav__`；`obsidian__` / `folder` / 无前缀老备份一律拒绝并说清「去电脑上恢复」。
  放 `services` 而非 `commands`（后者 `#[cfg(mobile)]`，桌面用例够不着——v0.11.21 的同一条教训）。
- 前端 `SyncBackupPane`：列表（日期·归属·时间·大小）+ **两步确认**（首点只展开确认条）+
  结果句「已恢复 …：导入 N 条记录」；失败给原文（`rawIpcText`）。
- `md_backup_open` 仍是桩，但换成自己的话（私有目录里的文件交给系统打开没有意义）。

### 3. 悬浮窗能操作计时，且不再「一直待机」

- `PillService.onTap` 恢复老版本三档手感：待机 → 开始；圆点未展开（且确有计时）→ 展开看时长；
  其余 → 暂停 / 继续。长按仍是回主界面。
- **状态机仍只有一份**：Kotlin 不写库，只 `Plugin.trigger("pill:toggle")` 交出去，
  前端 `hooks/usePillAction`（`addPluginListener('timing-native', …)`）收到后调
  `togglePause()`。投递前 `hasListener` 探测，没人听就退回「打开主界面」。
- 读库自愈：`TimerReader.open` 先试 `OPEN_READWRITE` 再退只读；`PillService.ensureReader()`
  在 reader 为空时每 5 秒重开一次；读失败不再被 `runCatching` 吞掉，异常原文进
  logcat（`adb logcat -s TimingPill`）。**v0.11.21 之前吞掉它 → 永久待机，且没有一行日志。**

### 验证

`npm run check` EXIT 0（契约 78/17/11、size 631 文件 ≤300、version 0.11.22 六处、layers 8、
brand 0、eslint 0）；`npm test` 70 文件 **564** 用例（基线 67/547）；`cargo test --lib`
**669/0**（基线 661）；`cargo check --target aarch64-linux-android` 0 warning。
变异自证：`mobile_rounds` 改成恒 `true` → `mobile_does_not_run_legacy_plan` 红（8 passed / 1 failed），
按最小单元还原后与原文件逐字一致。

## 0.11.21 — 手机端云端同步：一条能跑的路，补上那道门

后端早就通了：`app/md_sync_mobile.rs::sync_once` 先判云端、再判 SAF，`md_sync_get` /
`md_sync_save` / `md_sync_test` 三条命令在手机端同名注册。**缺的只有界面与节奏**——
手机上没有任何地方能填 WebDAV 地址、应用密码、三档，所以那条通路一次都没被用过。

### 1. 手机「数据管理」新增云端通道

- **同步通道**二选一（只用本地 / 本地 + 云端）：只动 `cloud.enabled`，已填的地址 / 远端目录 /
  账号 / 三档原样保留，切回来一个字节不丢；
- **自动同步三档**（关闭 / 定时 5–120 分钟 / 智能）：切档只改 `schedule`，
  `intervalMinutes` 原样带过；
- **WebDAV 四字段 + 应用密码**：地址与远端目录预填坚果云默认值；密码走三分语义
  （没动 = `undefined` 不覆盖已存密文 / 输入 = 原串 / 清除 = 空串）；
- **测试连接**三关逐步点亮（账号 → 目录 → 写入），红在哪关停在哪关；
- **状态行**：密码存没存、今天传没传、待补传几天、上次错在哪；「开了但没填全」只显示
  一句「云端还没填全，暂时不会同步。」，不叠加「今天还没上传」。

### 2. 手机同步轮按三档跑

`jobs/md_sync_mobile.rs` 原来无论配置如何都按 `pollSecs`（默认 15 分钟）轮询，界面上
开了「关闭」也照跑。现在分派交给 `services/md_cloud/tier.rs::plan_of`：

```text
云端可用 → 按三档（关闭 / 定时 N / 智能：停手 5 分钟、启动 60 秒、30 分钟上限）
否则     → 沿用 pollSecs，与 0.11.20 逐字相同
```

非云端用户的行为一个字没变（老 `pollSecs` 的语义与云端三档无关，反推会凭空造出
「定时 3 分钟」这种谁都没选过的档）。

### 3. 三档判定搬到 `services`（一端判定，两端共用）

`TierState` / `TierReason` / `decide` 从 `jobs/md_cloud.rs`（`#[cfg(desktop)]`）原样搬进
`services/md_cloud/tier.rs`，`jobs/md_cloud.rs` 用 `pub(crate) use` 转出——既有用例的
引用路径一个字都没改。搬家理由：手机端引用不到桌面模块，而「云端可用就用三档」这条
分派必须只有一份。

### 4. 手机「立即同步」改走 `round_manual`

与桌面同一个入口：手动 = 现在就再试一次（顺带解除「连续 3 个自然日失败」的清理暂停）。
云端不可用时仍走 `sync_once`（那一轮要的是 SAF 镜像三步）。

### 5. 明确不做

手机端不挂云端往期真删（删远端不可逆，两路取证都依赖桌面那份本地镜像）；手机端仍无
备份查看与恢复入口；手机端不支持「本地目录」云端通道。**契约零新增**：命令 78 / 错误码 17 /
事件 11 / 迁移 `0006`。

### 6. 验证

`npm run check` EXIT 0（typecheck、契约 78·17·11、size 625 文件 ≤300、version 0.11.21 六处、
layers 8 条、brand 0、eslint 0）；`npm test` 67 文件 **547** 用例（基线 66 / 541，新增
`SyncCloudPane.test.tsx` 6 条）；`cargo test --lib` **661 / 0**（基线 655，新增
`md_cloud_tier_plan` 6 条）。


## 0.11.20 — 清障版：修两条 flaky、包里带「出生证」、文档补齐

不加功能的收尾轮：四件事，全是上一轮记账留下的债。

### 1. 两条「偶尔红一次」的测试修掉

- **`CollapsedDot.test.tsx`「59 秒」**：`dashoffset = 100 × (1 − frac)` 量纲是 100，
  `toBeCloseTo(x, 1)` 的容差折算成时间只有 30ms；`session()` 取 `Date.now()`，
  冷启动首跑（模块转译 + React 首挂）轻松超过 30ms → 偶发红、第二次又绿。
  修法不是放宽容差，是**钉死时钟**（`vi.useFakeTimers()` + `vi.setSystemTime()`，
  rAF / 定时器 / `performance` 一起假掉）；钉死后容差反而**收紧**到 6 位小数。
  变异自证：把 `(smoothDisplay % 60) / 60` 改成 `(% 61) / 61` → 本条红（差 0.0161 ≫ 5e-7）。
- **`portable_dir_qa::a2`**：静态排查定位到「影子目录清理残留」这一类缺陷，假红假绿都能造——
  `remove_dir_all` 失败（杀软短暂持句柄）后 `create_dir_all` 对已存在目录静默成功，
  随后往脏目录里复制，陈旧 WAL 被回放，行数比对得出与本次迁移无关的结论。
  修法：清理不掉就**跳过行数比对**而不是继续；`a2` 的残留审计从「点名两个兄弟」改成
  **整根审计**（根里除 source/target 外一无所有，任何中间产物都逃不掉）。
  两条变异各自红、还原后绿。

### 2. 出包写 `BUILD-INFO.txt`

包里从此能回答「这是哪个 commit 编的」。`release/Timing-<ver>-portable/BUILD-INFO.txt`（进 zip，
解压即见）与 `release/BUILD-INFO-<ver>.txt`（与 zip/setup 同级）两处同内容：
`product / version / git_commit / git_dirty / built_at_utc / build_profile`。
commit 与干净状态**现场问 git**，不许硬编码、不许读缓存；git 不可用写 `unknown` 而不是让打包崩。

### 3. 删 7 条 `.mig__*` 孤儿样式

v0.11.19 删「数据迁移」卡后，`settings-panel.css` 里 7 条 `.mig__*` 再无任何 jsx 引用，整块删干净。

### 4. 文档补齐

`CHANGELOG.md` 从 0.11.16 补到 0.11.20（0.11.17 / 0.11.18 / 0.11.19 三段按实际交付补写）；
`release/RELEASE-NOTES.md` 从 0.11.7 更新到本版。**没有新迁移、没有新命令、没有新错误码、没有新事件**
（78 / 17 / 11 / `0006` 四项全不动）。

## 0.11.19 — 云端只留当天（往期真删）、md 只写自己区块、事件驱动同步

用户一次给六条口径：真删云端往期（它只是传输用的，备份以 SQL 数据为主）、不要汇总日记（别的软件也往同一份日记里写）、
取消应用内中英切换改成安装流程全中文、把上轮未做完的补上、去掉「数据迁移」卡、新增「SQL 数据管理」方案。
第六条按原话**只出方案、零实现**，等拍板。**没有新迁移、没有新命令、没有新错误码、没有新事件**
（78 / 17 / 11 / `0006` 四项全不动）。

### 1. 云端往期真删：两路取证不合并，六道闸

`KEEP_DAYS = 0`，只留今天。WebDAV 与「本地目录」两条通道各挂一个出口，闸门逐条是：
仅当前生效通道 / 文件名严格 `yyyy-MM-dd.md` / 目录与任何 `md_sync` 绑定的 root 相同或互为父子则整批拒绝 /
`date < today` / 两段证据 / 删前留底成功才许删。

- **两路取证不合并**：WebDAV 靠本地镜像里有同名文件；本地目录靠 `md_cloud_pending` 有该日期行 + `last_hash` 非空 + 文件当前字节指纹等于 `last_hash`。合并会让「另一台设备推回来的文件」被当成证据。
- **闸⑥ 用 `md_backup::save_checked -> bool`**：`save` 返回 `()` 且四处静默 return，「调用过」不等于「底留下了」；`String::from_utf8` 失败也算没留底。
- **删除路径只从读到的文件名来**：禁止从 `binding.file` 模板反推、禁止拼 `..`、禁止递归。模板只用于写，不用于删。
- **404 算成功**：不删它不报错、不暂停、门禁全绿，只是那个日期永不推进水位，收敛路径会卡死。

删除走独立的 `infra/md_webdav/remove.rs`，不复用 `probe_file::delete`——后者跟随重定向。实测这版 reqwest
**对 302 保留 DELETE 方法**，跟随一次就是照着 `Location` 真删掉另一个文件并拿到 200，判成功、水位推进、
该日期永久漏删。所以必须 `Policy::none()`，且测试要断「请求次数恰好 1」，只断返回值会漏掉这一档。

水位与暂停状态**按通道分开存**（6 个键）：WebDAV 认证失败不该把没有认证的本地目录那条路一起暂停。

### 2. md 只写自己那几个区块

日记文件里还有别人的内容，所以：区块内出现 `#` 行不触发软删；别人围栏那段逐字节不变；未闭合围栏本轮不写也不导入。
修掉两个洞，都属于「别人的内容被我们改写」：

- **洞 1**：`section_end` 只看行首 `#`，区块内出现 `# 备注` → body 截断 → 走导入 → 把「基线有、截断后没有」的计时记录**软删**，无撤销入口。
- **洞 2**：`find_heading` 是「整行逐字相等就命中」，别人在代码围栏里写一行逐字 `#### 事项计时` → 命中那个坐标 → 把他围栏里的内容整段换成我们的渲染结果。

修法是新增 `infra/md_fence.rs`（围栏位图）+ `infra/md_section.rs`（区块判定），`scan_headings` 一趟出 `HeadingScan`，
`find_heading` / `section_end` / 两个计数共用同一份位图；未闭合围栏给 `SectionState::Blocked`（本轮不写不导入、报红字）。
原有 8 条 `md_file` 用例一条都没覆盖围栏。

### 3. 写 md 从「15 分钟一次」改成事件驱动

SQL 改后 800ms 去抖、外部 md 改 1.5s 去抖、60s 兜底；云端同步改成三档自动。信号源只有 `commands/` 下 25 处业务写入，
`jobs/` 与 `services/` 下 0 处——为此新增 L8 分层门禁（`dirty::mark` 只许出现在 `commands/`，带哨兵、自证能拦）。

### 4. 取消应用内中英切换，安装流程改全中文

`languages: ["SimpChinese"]`、无语言选择页、应用内零 i18n 分支。原计划 0.11.21 的「中英切换」整批取消。

### 5. 移除设置-通用的「数据迁移」卡

只删卡片与测试，Rust 侧迁移命令一行未改，开机迁移逻辑照跑。

### 6. 「SQL 数据管理」只出方案

推荐方案：按年清理 + 强制先导出 `.db` 副本 + 勾选「不可撤销」+ 打字确认年份；删除范围恒为 `started_at < 今天 0 点`。
今天的数据与待办都不给入口——md 一轮只读今天那份文件，删了会被导入回来、换新 id 复活。

### 7. 这一版真正的产出在判据

功能侧零缺陷，但 QA 连着挖出三个「写了但没接线」：闸⑥ 端到端是假的（换成「调一下返回 true」的闭包，653 条全绿）；
判据自己能被绕过（`|a, b| { …save_checked(a, b); true }` 五条 needle 全过）；`bootstrap.rs:74` 的 `set_root` 零机验
（删掉它 654 全绿，真机上「一份不删、不报错、水位不动」，比闸⑥ 更危险——它安静得像本来就没东西可清）。
三条各自补了判据并自证能红。顺带把 `cargo clippy` 的**假门禁六形态**揭齐，从此不看 exit code。

## 0.11.18 — 换同步机制：通道二选一提到页签顶部、托盘同步标签跟真能跑的通道

用户一次报 8 条，本轮只做批 0（第 1 条 + 第 2 条 + 第 7 条文案 + 补回归测试），其余排进 0.11.19 / 0.11.20 / 0.11.21。
**契约 78 / 17 / 11、迁移 `0006` 四项零新增；五条零 diff 红线一条没破。**

### 1. 那个开关用户根本看不见

「启用云端通道」原来藏在第四块正文里，而云端没配置过时第四块默认折叠——等于看不见，于是「选本地就不启用云端」
这件事在界面上一直无法表达。这轮删掉它，同一语义提升成页签顶部的 `只用本地` / `本地 + 云端` 二选一：
**不新增字段、不写迁移、读的时候不改盘**（复用 `cloud.enabled`，为真就是「本地 + 云端」）。
老用户配置切来切去一个字节不丢，包括「从没配过云端的人点一下再点回来，不许写出空壳配置」这一帧。

### 2. 「报红但能同步」的病根跟 403 判定无关

用户两次反馈同一件事，因为在 `mode = 本地目录` 下，**「测试连接」按钮只出现在 WebDAV 那一栏**——
本地目录这条路压根没有自证入口，切到 WebDAV 去点必然 403 报红，而同步走的是本地目录、一切正常。
修法是按钮移出分支两个载体共用 + 状态行跟随载体 + 切载体清掉上一次结论（两道防线）。
后端 `probe.rs` 与 `state.rs` **一行未改**——它本来就按 `match cloud.mode` 分支，是对的地方。

### 3. 托盘：同步项恒 1 项，标签不许骗人

标签跟着**真能跑的通道**变（`config.enabled && usable()`）；选了云端但没填全 → 仍叫「Markdown 同步」，
点它时通知标题与刚点那一项逐字相同、正文「先在设置里填好云端」。
托盘右键「退出」现在先跑一轮同步再退，3 秒预算、超时照样退，等待期那一项变灰「正在同步…」（杀进程不做任何处理）。

### 4. 第 7 条文案改成实话

`日记本：双向，保留你手写的内容。` / `多端一致用：体积小，读得快。`——原文案暗示「汇总日记」，实际是每天一份
当时刻的快照，老文件不回头修正。话改对了，汇总另做（不做）。

## 0.11.17 — 目录读不动，不再算账号失败

- 第 1 关对**目录**发 GET，坚果云不允许这么读回 403；判定表只把 405 与跳转当「不支持读目录」，403 落回了账号失败。
- 现在第 1、2 关都不许用 403 判死，最终由第 3 关「真写进去一个探针文件」裁定——能写就是绿。
- 默认远端目录改成 `/Timing`，界面加一行提醒先去网页版建同名文件夹。
- 本地目录通道的手改仍会导回 SQL（补了一条真临时目录的用例钉住）。

## 0.11.16 — 设置「数据管理」做减法、WebDAV 默认预填与三关自证

用户接着上一版报六条，主诉是「功能说明过于繁复」。五条是减法，第六条是云端默认值要开箱可用，
并贴回上一版那句红字（「账号能登录，但没有往 /我的坚果云/Timing 写文件的权限」）。
**没有新迁移、没有新命令、没有新错误码、没有新事件**（78 / 17 / 11 / `0006` 四项全不动）。

### 1. 繁复的真因不是字多，是「同一个概念 × 3 份」

逐块清点现码：22 段说明对应 19 个可编辑控件，其中 12 个是「三个种类各一份」。而三个种类写的是
**同一个日记文件**、指向**同一个目录**——块① 三个「文件模板」框的默认值本来就全是 `{date}.md`。
同一句话的重复次数：「同步只改标题下区块」3 处、「以 Markdown 为准」2 处、「文件名与标题来自…」
3 处、「文件放在哪个目录在第三块改」3 处。所以这一版减的是「三份」，不是减信息：
**22 → 10 段说明，19 → 10 个输入框，六成改动是删代码。**

### 2. 一个框写三档：单框是「意图」不是「镜像」

块① 的「日记文件名」与块③ 的「日记落点」都从三个框并成一个，但三档 `file` / `root` 在后端
**各自保留**。判据是 `MdSyncShared{file, root}` 三态：

- `null` = 用户没动过 → 保存时三档原值**一个字节不改**；
- 字符串 = 亲手改过 → 扇出到三档；
- `sharedAfterEdit(base, next)` 让「改回原值」视为没改。

`resolvedBindings = applyShared(bindings, shared)` 是保存与「测试连接」**唯一**的出口——两处各拼一次，
就会出现「测试按旧档跑、保存按新档写」。逐档面板手改时按字段 diff **清掉**对应的共享意图，否则
扇出会把刚手改的那一档盖回去（手改一档时先把意图固化到其余档，再写本档）。

老用户三档必然不一致（`merge_bindings` 补进来的 `todos` 用 `%APP_DIR%\md`，前两档是 Obsidian 目录），
所以「没动过就不写」不是优化，是**不擅自搬用户数据**的唯一保证。

### 3. 测试连接从两关变三关（403 才可分诊）

上一版把 403 归成一句并列三种可能的话（目录不属于你 / 只读 / 配额满），用户读完仍不知道动哪个，
而且那句话**可能本身就是错的**——403 也可能是这一级目录建不出来。改成：

```
第 1 关 账号  GET {baseUrl}      → 401 = 账号或应用密码不对
第 2 关 目录  MKCOL 每一级       → 405/301 已存在、201 新建、403 被拒（带出卡在第几级）
第 3 关 写入  PUT timing-write-test.txt → DELETE  → 403 = 目录在但写不进去
```

- `ensure_base_dir` 返回 `Result<EnsureOutcome, DirFailure{level, ready, error}>`，`level` 来自
  `level_path()`（已搬到新文件 `tag.rs`，与日志同源）；`put` 只加一行 `.map_err(|f| f.error)`，
  `TooDeep` 仍是 `Ok` 变体。
- 文案侧新增 `FailStage{Push|Account|Dir{level,ready}|Write}` + `fail_text_at`，老签名 `fail_text`
  保留为 `fail_text_at(Push, …)` 的薄封装 → **文案表仍只有一张**，`\b\d{3}\b` 零命中仍是硬断言。
- 探针文件名 `timing-write-test.txt`，**不带点前缀**：部分服务端拒收隐藏文件，会把「能写」误判成
  「不能写」。DELETE 失败只记 WARN、不改绿字（判据是「这个目录收不收文件」，PUT 通过即已证明）。
- 「只读」与「配额满」服务端不给理由，**不猜**；文案把最后一步交给用户做一次十秒对照实验
  （往目录里拖个文件：拖得进 = 本月 1 GB 用完，拖不进 = 只读）。

### 4. 默认值开箱可用（`emptyCloud()` 三处）

`mode: 'webdav'`、`baseUrl: 'https://dav.jianguoyun.com/dav/'`、`basePath: '/我的坚果云/Timing'`。
`emptyCloud()` 只在 `cloud === null`（从未配置）时被调用，已有配置**绝不被覆盖**。

`mode` 这一处是关键：填了值但停在「本地目录」分段，预填值要切一次才看得见，等于没做到「默认自动填写」。

远端目录取 `/我的坚果云/Timing` 而非用户原话的 `/我的坚果云`：坚果云 `dav` 根就是同步文件夹根，
填根会把每天的 `.md` 撒在用户自己的文件堆里。多一级由 `ensure_base_dir` 自动建，代价为零。

**中文路径不转码**：存中文、显示中文，由 `url` crate 在请求时编码一次（`base_path` 原样拼接，
`url` 会把非 ASCII 段转 `%E6…`）。存 `%e6…` 会让设置页不可读，且任何一处再编码就成双重编码——
那是最难查的故障。**坚果云服务端认不认中文目录段只有真机能验**，退路是一个字符串换英文 `/Timing`。

### 5. 界面其余减法

块③ 三行落点并成一行 + 一行聚合状态；`MdSyncPathRow` **降级不删**，进 `MdSyncTierPanel` 的局部
`useState` 展开（收起时不挂载，所以「文件名与标题来自」在 DOM 里一条都搜不到），仅在三档不同或某档
被关掉时出现入口。块② 五段说明压成一句，C11 改成按 `affected` 实际档位点名（原先只有一档受影响时
仍说「这三档」，是假话）。块⑤ 默认折叠，`FoldBlock` 加 `summary` 槽，收起行显示
「时间 · 覆盖前备份 · 文件名 · 大小」；`useBackupList` 是单一数据源，全页 `md_backup_list` 只调一次。
页签顶部导览与底部注脚整段删除。

### 6. 数字与代价

- 后端 `cargo test --lib` 492 → **512**；前端 50/385 → **58 files / 462 tests**；
  `check:size` **571 文件零豁免**；`check:layers` 7 条；`check:brand` 违规 0；clippy 0 warning。
- 三条零 diff 红线保持：`services/md_sync/`、`infra/md_file.rs`、`components/mobile/`。
- 每个「测试连接」多两个请求（PUT + DELETE），只在用户点按钮时发生，不进自动同步路径。
- 新增文件：`mdSyncCopy.ts`、`mdSyncShared.ts`、`MdSyncRootRow.tsx`、`MdSyncTierPanel.tsx`、
  `useBackupList.ts`、`mdBackupFacts.ts`、`MdBackupSummaryLine.tsx`、`settings-data-slim.css`、
  `infra/md_webdav/tag.rs`、`infra/md_webdav/probe_file.rs`、`services/md_cloud/text.rs`、
  `models/md_sync_test_result.rs`。
- **没跑** `cargo check --target aarch64-linux-android`（手机端零 diff，但这是没跑不是绿）。

## 0.11.15 — WebDAV 409 逐级补建目录、设置「同步」重组为「数据管理」五块

用户报的两件事：**WebDAV 每轮刷 409**，以及**设置里那一页「逻辑有问题」**（一块堆着六段，没地方再
放第七段）。这一版只做这两件：修一个真 bug + 把一页重新分组。**没有新迁移、没有新错误码、没有新
事件**（错误码 17 / 事件 11 一处未变）；命令 74 → **78**，四条逐条记账。

### 1. 409 的病根：目录不存在，而程序从不建它

`put()` 直接 PUT 完整 URL，全仓**没有任何 MKCOL**；而远端相对路径恒为扁平的 `{date}.md`
（`round_push` / `round_webdav` / `round_conflict` 三处都是），所以缺的**不是子目录，而是配置的
`basePath` 本身**（`/Timing/md` 这种多级路径）。按 RFC 4918，父集合不存在时服务端就回 409。
更糟的是两处把用户带偏：`fail_on_status` 把 409 归到 `Server(409)`，文案只有「稍后自动重试」，
每轮重复、永不自愈；`probe` 又把**404 判成 Reachable**，于是「测试连接」绿字、保存后必 409。
用户看到的每个字都对，但每个字都没告诉他下一步做什么。

### 2. 补建内建在 `infra` 层，不散在编排层

`infra::md_webdav::put` 里：`send_put` 收 409 → `dir::ensure_base_dir` 逐级 MKCOL → **重试一次**。
放这一层而不是编排层，理由三条：RFC 里 `PUT → 409` 只有一个成因（父集合缺失），补建后重试一次是
HTTP 语义的一部分；调用点有三处，写三遍必然漏一处，而漏一处就是「补传成功、今天失败」这种极难
复现的错；第一级建出来后同轮后续 PUT 不会再 409，天然只有一次级联。

算法与红线：

- **浅 → 深**逐级建（顺序不可换，否则必然 409）；`405`（集合已存在）/ `3xx` 视为就绪，`201/200/204`
  算建成；`409/400/401/403/423/5xx` 立刻停。
- **最多 8 级**，超了**一个请求都不发**（`TooDeep`），由调用方说人话：`put` 里降级成 `Server(409)`
  （不改写它的本义），「测试连接」里明说级数与上限。
- **幂等 + 失败不回滚**：已经建出来的上级目录保留，绝不为了「干净」去 `DELETE` 用户网盘里的目录。
- **MKCOL 走独立 Client、禁止跟随重定向**：reqwest 对 301/302/303 会把方法**改成 GET**，一次「要求
  补尾斜杠」的 MKCOL 就变成 `GET <dir>`，之后既不知道建没建、日志也全是假的。3xx 一律当「已存在」
  是本轮唯一说得清的判据。
- **不给 `WebdavError` 加变体**：四类失败在致命性与退避判据上与既有变体完全一致，差的只有文案。

`infra/md_webdav.rs` 已到 272 行，本轮拆成 `md_webdav/mod.rs` + `md_webdav/dir.rs`（`probe` 与
MKCOL 都是「对目录发请求」，判定表共用一张，放一起不是凑行数）。

### 3. 文案：带出真实路径，不许出现裸状态码

`fail_text(err, remote_dir)` 加一个路径参数（8 个调用点全同步，唯一出口不变），三类失败各给一句
能照做的话：目录不存在 → 「请到网盘网页版按这个路径手动建好目录（含每一级）」；无写权限 → 「确认
这个目录属于你的账号、没被设成只读，或本月上传量还没用完」；字符不被接受 → 「改成只用字母、数字、
`-` 和 `_`」。其余 4xx/5xx 走兜底句 **且不带状态码**（状态码对用户零信息量，只进日志）；用例用
`\b\d{3}\b` 断言四类文案零命中。代价记一笔：`Server(5xx)` 那句「稍后自动重试」被删了——退避行为
不变，只是不再向用户承诺时间。

「测试连接」跟着改成两件事：`probe`（判地址与凭据）→ `ensure_base_dir`（判目录就绪），两条都过
才绿字，绿字里说明「已就绪」还是「已补建 n 级」。**绿字从此等于真的能写。**

### 4. 数据落点可配（SQLite 落点设置）

指针文件 `%APPDATA%\<identifier>\data-root.json`（与 `portable-optout.json` 同目录）：它必须在
「数据根被决定之前」可读，那个位置是唯一已被证明在此之前可达的地方。启动优先级 **指针 > optout >
`<exe>\data` 探测**；有指针且目录可写就直接注入 `Roots`，不搬数据、不弹迁移框（数据是用户自己
在界面里确认复制过去的，启动期再搬一次就成了「悄悄搬第二遍」）；不可写则阻塞对话框三选一，选
「这次按默认流程」时**指针保留**；坏 JSON 当不存在（一个被编辑器改坏的文件不能永久卡住启动）。

「更改位置」五步：预检（同一目录 / 祖先后代 / 目标非空 / 不可写 / 剩余空间 < 体积 × 1.2，任一不过
就不进入复制）→ 页面内确认对话框（列五项 + 总体积 + 「旧目录不会删除」）→ 复制 → **核对五张表
行数**逐表一致才写指针 → 返回刷新后的 info。数据库**用 `VACUUM INTO` 落一致副本**，绝不直接拷
`timing.db` / `-wal` / `-shm`（WAL 下那是两个时刻的快照，拷出来可能是撕裂的库）。核对不过就不切
指针，并在目标目录写 `MIGRATION-INCOMPLETE.txt`。

两条必须显式告知、不许静默改配置：根目录写成 `%APP_DIR%\...` 的落点**会跟着搬**（块里列出受影
响的种类名）；**插件不跟着搬**（插件根始终在 `<exe>\plugins`），回退态时块里追加一句「请自己把
`plugins\` 搬到 `<exe>\plugins`」。撤销是 `data_root_change(None)`，只动指针不动文件，`previous`
是另一个自定义根时先回上一个位置、再撤销一次才回默认（用户「选错了」时想回的是上一个能用的位置）。

### 5. 设置页：一块堆六段 → 五块各管一件事

页签名 `同步` → **`数据管理`**（桌面 `SettingsPanel.tsx` 与手机 `SettingsPage.tsx` 两处 label）；
页签 `id` 仍保留 `'sync'`——它是 `aria-controls` 与条件渲染的内部标识，改名对用户零收益却要动
`TabId` 联合类型与模板串。五块顺序固定：① Markdown 落点设置（模板 + 标题行 + 只读预览 + 指路行）
→ ② SQLite 落点设置（路径 + 可写徽标 + 打开文件夹 + 更改位置 + 待生效黄条）→ ③ Markdown 同步
（总开关 + 每种类一行 + 间隔 + 运行状态）→ ④ WebDAV 云端同步（字段一个不增不减）→ ⑤ 备份数据管理。

三条纪律：**保存入口只有一个**（底部 sticky 条；块②自带按钮，因为它保存的是另一份东西——数据根
指针，混进「保存并同步」就再也说不清谁存了谁）；**红字只出现在出问题的那个块里**（能定位到
`第 N 个落点：…` 的原文交给①③ 就地显示，页签顶部只留保存动作本身的结果）；**总开关搬进块③**
（它管的就是本地落点这一摊，放顶部会让用户以为打开它云端也会开——云端有自己的开关）。

`MdSyncBindingCard.tsx`（183 行，把「文件模板」和「根目录」混在一张卡里，正是病根）删除，取而代之
是 `MdFormatBlock` + `MdSyncPathRow`；新增 `FoldBlock`（通用折叠头）与 `styles/settings-data.css`。
本轮新增前端文件 6 个、删除 1 个，全部 ≤ 300 行。

### 6. 备份能打开看

`md_backup_open`：**输入是备份名，绝对路径由后端解析**（不信任前端给的路径，`path_of` 拒绝 `..`、
`/`、`\` 与空串）。失败原因用 `rawIpcText` 原文透出，不再被 `errorText()` 润色成「系统调用失败，
请重试」——「文件不存在：obsidian__2026-11-05.md」这句话是用户唯一的行动依据。恢复流程与
0.11.14 交付时**逐字一致**。

### 手机端

只改一行：`SettingsPage.tsx` 的 `TABS` label。PRD 第七节「手机端也拆五块、云端字段改只读」**本轮
不采纳**：用户原话是「先修复 pc 端」，缩减手机端既有编辑能力属于擅自减功能。手机端三条数据根命令
是桩（`desktop_only` → `IO_ERROR`，不新增错误码），`md_backup_open` 走既有 `MD_SYNC_CONFIG_INVALID`
+ `NO_BACKUP` 文案。

### 验证

- `cargo test --lib` 465 → **492 passed**；前端 49 files / 370 → **50 files / 385 tests**
- `cargo clippy --all-targets -- -D warnings` **0 warning**（`cargo clean -p timing` 后重跑）
- `check:size` **546 文件零豁免**；`check:contract` 命令 **78** / 错误码 **17** / 事件 **11**；
  `check:layers` 7 条全过；`check:version` 六处 **0.11.15**；`check:brand` 违规 0
- `cargo check --target aarch64-linux-android` **0 error**
- **变异自检**：把 `put` 里的 409 补建分支短路掉 → **7 条**用例真红（要求 ≥5）；往
  `commands/data_root_cmd_mobile.rs` 插一个类型错误 → 安卓红、桌面绿（证明 `#[cfg(mobile)]` 的桩
  真的进了安卓编译，不是死代码）

### 过程中收口的两处

1. `MdSyncBackupCard` 的「打开」失败分支留着一条未还原的变异（`errorText` 而不是 `rawIpcText`），
   `rawIpcText` 因此成了未使用导入——类型检查当场抓住，已改回，用例 `MdSyncBackupCard.test.tsx`
   正是靠「恢复用 errorText、打开用 rawIpcText」这条可分辨断言兜住的。
2. 品牌门禁抓出 5 处 `migrated-from-tickbar-app.json`：那是**磁盘上既有的真实文件名**
   （`infra/appdata_migrate/marker.rs::MARKER_FILE`），换了就搬不到它。已按「行级豁免 + 写明理由」
   登记进 `scripts/brand-allowlist.txt`，没有整文件豁免。

### 留给下一版

- PRD 第七节（手机端逐块口径）与 8.3-5 与本轮裁决冲突，应整节标为 `v0.11.16 待做`，否则 E2–E4 在
  文档里永远是不满足状态。
- PRD 8.2 能力 6（校验某个 Markdown 落点根目录）本轮不做：用户填错目录要等下一轮同步失败才知道。
- `DataRootInfo.writable` 只在进页签时探测一次，拔掉移动盘后徽标会滞后到重进页签。

## 0.11.14 — 修 0.11.13 的五条遗留缺陷（恢复落点、测试连接误判、已上传状态、手机端模式、保存假失败）

v0.11.13 交付时列了 8 条真机验收和 5 条下一版欠账，这版就是那 5 条。**没有新功能、没有新命令、
没有新错误码、没有新迁移**——契约仍是 74 命令 / 17 错误码 / 11 事件。

### 1. 恢复备份会写错文件（唯一的数据正确性问题）

`services/md_backup.rs::root_of` 旧版只认 `webdav` 落点：`folder` 与「`webdav` 但云端没启用」
都**静默回落**到 `binding.root`——那是 Obsidian 落点。于是「恢复一份本地目录备份」实际改写的
是 Obsidian 里那份日记，用户以为改的是云端那份，而且没有任何提示。恢复是**覆盖写**，落点写错
就是数据事故，所以现在解析不出来一律报错、绝不猜：通道没配 / 模式不符 / 根解析失败三种情况
各给一句带「该去设置里做什么」的话。`folder` 恢复**不排待传**——那条路没有欠账概念，写进目录
就是同步完了。`obsidian` 与老备份（无前缀、由用户自己选落点）行为不变。

### 2. 「测试连接」把 405/301 报成「连不上」

旧 `infra/md_webdav.rs::probe` 只把 200/404 算通。而不少 WebDAV 服务端对「GET 一个目录」本来
就回 405（或 301 补尾斜杠），于是凭据没问题的用户看到「WebDAV 服务返回 405」，以为自己填错了
而放弃——这是上手阻断型的假阴性。现在分三档：200/404 → 通；405/3xx → 「地址与账号能通，
但服务端不支持直接读目录（可以保存）」且 `ok = true`；401/403/网络错误 → 仍然是错误。
没有给 `WebdavError` 加变体，编排层的 match 不受影响。

### 3. 本地目录模式「今天已上传」恒假

`services/md_cloud/state.rs` 的 `today_pushed` 读的是 `md_cloud_pending`（行存在 + 无欠账 +
有指纹），而 `round_folder` 为了「本地目录没有待传概念」从不写这张表。功能是对的、显示在说谎。
现在 folder 轮**真写成功**（`mirror::run_in` 无 error）后补一次 `mark_synced(date, etag=None, hash)`；
建目录失败、镜像失败都不记。没有新表、没有新列、没有迁移。

写清了一个已知副作用：模式在 folder 与 webdav 之间来回切时，folder 轮会把该日期的 `etag` 覆盖成
`NULL`，切回 webdav 后那一天第一次 PUT 就是无条件覆盖。接受它，理由三条：今天那支 PUT 用的是
本轮 GET 回来的 etag 根本不看这行；剩下的是「切回后又变脏的历史日期」，那份 etag 属于另一个远端，
留着只会稳定 412 并永久跳过那天；且与「远端这次没回 ETag」的既有语义一致。

### 4. 手机端显示 WebDAV、保存后却按本地目录跑

旧版在 `MdSyncCloudCard` 渲染层把 `mode` 掰成 `webdav`，但 `patch()` 写回内存的仍是
`localfolder`：用户看的是 WebDAV 表单，保存后落库的是本地目录，同步走进一条在手机上必然失败的
路径。现在掰值挪到**回填草稿**这一步（`useMdSyncDraft`，带 `modeConverted` 标记），显示与落库
是同一个值；并且加了一行可见说明，不做静默改配置。后端补兜底：手机上拿到 `localfolder` 配置
直接回一句能照做的话（`MD_SYNC_CONFIG_INVALID`，不新增错误码），不再走进死路。

### 5. 保存「假失败」

`commands/md_sync_cmd_mobile.rs` 的 `md_sync_save` 里，`saf_status(...).await?` 在配置**已经落库
之后**才执行：桥一报错，整个保存就返回失败，用户以为没保存上。现在这个检查只用来决定「要不要
顺手同步一轮」，出错折成 `false` 并落一条 warn；而且**云端可用时不再问 SAF**——「只配 WebDAV、
不选日记目录」是合法用法，旧口径把 SAF 授权当前置条件，这类用户永远走不到自动同步。
判据抽成纯函数 `should_autosync(enabled, cloud_usable, saf_granted)`，可被单测钉住。

### 验证

- `cargo test --lib` 454 → **465 passed**；前端 49 files / **370 tests**
- `cargo clippy --all-targets -- -D warnings` **0 warning**（`cargo clean -p timing` 后重跑，不吃增量缓存）
- `check:size` **521 文件零豁免**；`check:contract` 74 / 17 / 11 一处未变；`check:layers` 7 条规则全过
- `cargo check --target aarch64-linux-android` **0 error**（需先按 `docs/mobile/TOOLCHAIN-SETUP.md`
  注入 NDK clang，否则报 `failed to find tool "clang.exe"`）
- 红线文件整文件 blob 相同：`services/md_sync/mod.rs`、`services/md_sync/mirror.rs`、`infra/md_file.rs`

### QA 抓到的两处「测试在吹牛」

和 0.11.13 的 `prune_counts_old_style_backups` 是同一类毛病，值得记下来：

- `folder_round_failure_records_nothing` 把落点建在「父级是文件」的路径上，`run` 在
  `create_dir_all` 就 return 了，**根本走不到记成功态那一段**。把判据改成恒真它照样绿。
  已换成 `folder_round_partial_failure_records_nothing`（一路写成功、一路失败），变异下真红。
- `probe` 新增的三条用例只覆盖了错误档，**200/404 两档没有用例**：把成功档也改成报错，三条照样
  全绿。已补 `probe_200_and_404_are_reachable`。

### 已知缺口（留给 0.11.15）

`restore` 里 `effective == Some("webdav")` 的「恢复后排一笔待传」那一支**零测试**：要走它必须
解析出真的 `%APP_DIR%\md-webdav`，而 `%APP_DIR%` 在 `infra/md_env.rs` 里是「保留名，永不查环境
变量」，测试无法把它重定向到临时目录。要么给云端根加一个 `set_root` 式的可注入点（生产改动），
要么接受这条链路无覆盖。此外 `src-tauri/src/tests/md_webdav.rs` 已到 296 行，下次动前先拆。

## 0.11.13 — MD 同步加云端通道（WebDAV / 本地目录）、待传队列、备份可恢复

同步链路从「四跳」改成两端对称：

```
旧：SQL(PC) → md(PC) → OneDrive → RemotelySave → Obsidian(手机) → SAF → SQL(手机)
新：SQL(PC) ↔ WebDAV(坚果云) ↔ SQL(手机)
```

旧链路里 Obsidian 只是桥，却带来两个第三方（OneDrive、Obsidian）和两种授权，任何一跳坏掉
的症状都是「手机上少了几条」，没有一处日志说得清是哪一跳。新链路是信箱模型，不需要双端同时在线。

**合并逻辑一行没改。** `services/md_sync/mod.rs` 的 `sync_all` / `sync_binding` 与 0.11.12
逐字节相同（QA 用逐函数体 md5 比对确认），云端那一轮只是换个 root 再跑一遍现成逻辑
（`mirror::run_in`）。`infra/md_file.rs` 同样零改动。这条是整轮的地基：两份日记、两套落点，
合并规则全库只有一份。

### 新增

- **云端通道**（`services/md_cloud/`，9 个文件）：两种模式——`localfolder`（指到坚果云同步
  文件夹，交给坚果云客户端自己传）与 `webdav`（`infra/md_webdav.rs` 直接 GET/PUT）。
  一轮的顺序不可换：GET 远端今天 → Obsidian 落点 → 云端落点 → 算指纹 → PUT。
  先 Obsidian 后云端，是为了让 PUT 出去的内容**一定包含本轮所有变更**。
- **待传队列**（迁移 `0006_v0113.sql` 建 `md_cloud_pending`）：只同步当天有个洞——某天没传
  成功，第二天按「只同步当天」就永远不补。现在按「有没有没传成功的改动」判定，通常只有一条。
  **唯一欠账判据是 `pending_since > 0`**，`last_hash` 只负责「内容有没有变」；上传失败只留
  `pending_since`、下一轮自愈，且时间戳不会被后续重试刷新（写在 SQL 的 `ON CONFLICT` 里，
  不靠调用方记性）。
- **备份可查看与恢复**（`services/md_backup.rs`）：留底功能四个月前就有，一直只能写不能读。
  备份文件名加落点标识 `<tag>__<文件名>-<时间戳>.md`，老备份（无前缀）标「归属未知」、
  **不删不改名**（`prune` 的淘汰池只收带已知前缀的文件）。恢复是**强制导入**：写文件 →
  立刻 `import::by_kind` → 再渲染 → 更新基线，全程持同步锁，所以「恢复本身不会再丢一次」。
- **凭证**：桌面 DPAPI（`infra/secret_dpapi.rs`）存 `<数据根>\webdav.bin`，手机 Keystore +
  AES-GCM（`native/SecretStore.kt`）存 SharedPreferences。密码不进 `settings` 表、不进日志、
  不进任何 `Debug` 输出，视图只回 `hasSecret: bool`。解不开就报错，**绝不回落明文**。
- **契约**：命令 71 → **74**（`md_sync_test` / `md_backup_list` / `md_backup_restore`）、
  错误码 16 → **17**（`MD_SYNC_REMOTE_ERROR`），事件仍 **11** 条不变（云端结果复用
  `md-sync:changed`，加事件只会让每个消费者写两遍处理函数）。

### 修复（QA 独立验收发现）

- **Android 编译错误**：`mobile_bridge_plugin` 的泛型 `R` 被 `PluginHandle<Wry>` 钉死，
  交叉编译报 `E0308`。这是移动端代码第一次真正进编译器——之前它一直没被编过。
- **`sync_once` 在手机上不查 SAF 就拿不到云端**：SAF 早退写在函数开头，云端分派在末尾，
  于是「只配 WebDAV、不选日记目录」的用户永远走不到云端。改成三段：先读配置 → 云端可用
  就直返（全程不碰 SAF）→ 否则走现有 SAF + 镜像三步。
- **手机云端每轮多跑一次「幽灵 Obsidian 轮」**：`binding.root` 的出厂模板在 Android 上解析
  进应用沙箱，那一轮只会把区块渲染进用户够不着的目录。改成 ⑤ 桌面专属（`cfg(not(mobile))`）。
- **今天 412 少了「重拉 → 再合并 → 再 PUT 一次」**（`round_conflict.rs`）。历史欠账仍只跳过
  不覆盖：那天的文件本身已是合并态，硬覆盖会丢远端的手改。
- **`prune` 会吃掉用户升级前的老备份**：原来只按 mtime 数 30 份，不认名字。
- 其他：`USER_AGENT` 改用 `CARGO_PKG_VERSION`（原来硬编码，升版必忘）；空白密码两处判空
  口径统一成 `trim()`；补 403 分支单测。

### 已知未做（进 v0.11.14）

`restore(target="folder")` 会写进 Obsidian 落点（唯一有数据正确性风险的一条）；
「测试连接」GET 的是目录本身，个别 DAV 实现会回 405/301 导致假阴性；folder 模式「今天已上传」
恒显示未上传；手机端 mode 显示与内存不一致；`md_sync_save` 里 `saf_status(...).await?` 的位置。
另有三个文件已贴 300 行红线（`tests/md_cloud_pending.rs` 296、`models/md_sync_cloud.rs` 295、
`app/bootstrap.rs` 295），下轮动它们之前要先拆。

### 门禁

`cargo test --lib` 454 passed / 0 failed · `vitest` 49 files / 369 tests · 契约 74/17/11 ·
`check:size` 519 文件全过（无豁免）· 版本六处 0.11.13 · `cargo clippy --all-targets -D warnings`
0 warning · `cargo check --target aarch64-linux-android` 0 error。

## 0.11.12 — 同步配置落一行日志、功能一览页视觉修订

同步逻辑没改。补的是 V0.11.11 装的眼睛里**还缺的一段**，外加一页对外说明的排版。

- `app/md_sync_mobile.rs`：`sync_once` 开头落一行 `md sync config: enabled=… bindings=[…]`。
  原因：`mirror_paths` 只看落点自身的 `enabled`，而 `sync_all` 见到**总开关关闭会静默返回**，
  于是在手机上的表现是「文件搬了、合并一行没跑、写回 0 个」，界面上还是一次成功。
  这一行把「总开关关了」与「落点关了」两种静默失败分开。每个落点连 `file` / `heading`
  一起打，空值显式标 `<空>`——空字符串正是最常见的「配置看起来填了、实际没生效」。
- `preview/timing-desktop-features.html`：首屏圆点改成 SVG 增长弧（对齐桌面实际形态，
  不再用文字时间）、八块功能改三列栅格、路径条改 `overflow-wrap:anywhere` 不再横向滚动、
  首屏文案精简。删掉三张过渡期截图（`_shot-*.png`），页面零外链。

未动命令 / 事件 / 错误码（71 / 11 / 16），未改前端与后端的行为。

## 0.11.11 — 真机联调出口：日志接进 logcat、镜像现场可追

同步功能本身没改。这一版是「把眼睛装上」——V0.11.9~0.11.10 的「读不回」在真机上是黑盒，
代码、单测、门禁全绿却查不动，因为**日志只写应用私有目录，release 包 `debuggable=false`
连 `adb run-as` 都读不到**。

- `platform/log.rs`：Android 上把每行日志镜像进 logcat（tag `Timing`），直接链 NDK 的
  `liblog`，零新增依赖；`stderr` 在 GUI 应用里不可见，这是唯一出口
- `md_sync/mod.rs`：每个落点一行 `md sync <种类>: <路径> exists=… dir=… imported=… exported=…`
  ——「没找到文件 / 文件没变 / 导入 0 条」三者在界面上都是同一句「已写入文件」
- `app/md_sync_mobile.rs`：`md mirror in: 请求 N 个路径，取到 M 个`、`md mirror out: 写回 N 个`
- `TimingNativePlugin.kt`：Kotlin 侧同一件事（SAF 里到底找到没找到）
- `scripts/android-log.mjs` + `npm run android:log`：一键跟随日志，同时写
  `release/logs/android-latest.log`；`--dump` 导最近 300 行
- `docs/mobile/android-debug.md`：真机配对、看哪个 tag、各方案能验什么

顺带修正 `md_sync/mod.rs` 模块头里**过期**的冲突说明（还写着「比 mtime，最后写入者胜」，
V0.11.3 起已经是「Markdown 永远赢」）。

## 0.11.10 — 手机端图标对齐桌面、同步修好、浮条透明底、圆点改逐帧

- **图标**：`npx tauri icon` 重生成全套；安卓补自适应图标（`mipmap-anydpi-v26`），
  背景 `#1E232D`、前景为抠出的蓝环 + 琥珀点；`tray.png` 备份还原（托盘是单色稿）
- **修 0.11.9 的回归**：原生返回体里的 `ArrayList` 被序列化成字符串 `"[]"`，
  Rust 反序列化 `Vec<String>` 失败 → 改 `JSArray`
- **悬浮条**：删底板与内描边，改「透明底 + 不透明文字」（文字墨色阴影、状态环墨白双轨）；
  手机设置删掉两个管不到浮条的透明度滑杆
- **圆点流畅度**：手机 `Choreographer` 逐帧重绘（仅计时中）、桌面 `useSmoothTimerTick`（rAF），
  几何量改吃小数秒，分针由「每分钟跳 6°」改为匀速一圈

## 0.11.9 — 手机端同步修通：落点显示、报错原文、一个丢数据的洞

0.11.8 的真机包在「设置 → 同步」页跑不通：落点那一行显示成一串 md 文件名，点「立即同步」
只有一句「系统调用失败，请重试」。四处一起修。

### 修复

- **落点显示**：`SafVault.describe()` 原先取「目录里前三个子项名」拼接，现在取树 URI
  document id 的路径段（`primary:Documents/Obsidian/日记` → `Documents/Obsidian/日记`），
  给不出路径才退回 `COLUMN_DISPLAY_NAME`。
- **报错原文不再被吃**：`SyncPane` 对 `IO_ERROR` 直接显示 `err.message`。手机上同步故障全在
  原生侧，那句原文是唯一线索。全局 `errorText()` 不动（别处那句润色是对的）。
- **保存不再因同步失败而失败**：`md_sync_save` 里顺手那轮改成 `if let Ok(...)`，
  配置照常保存成功，红字只留给「立即同步」。
- **堵掉覆盖日记的路径**：`mirrorIn` 对「读不出这个文件」原先 `continue` → Rust 判成
  「vault 里没有今天这一篇」→ 按 SQL 渲染区块写回，覆盖用户手写内容。现在 `mirrorIn`
  是「整轮成功或一字节不动」，`mirrorOut` 才保留逐文件容错（失败原因经 `errors` 进
  `MdSyncReport.errors`，设置页照原样显示）。

### 结构调整

- 原生侧参数传递去掉 Jackson 反射（`@InvokeArg` + `parseArgs(Class)`），改 `invoke.getArgs()`
  的 `org.json` 取值；三个 `@InvokeArg` 类删除。发布包开 R8，反射链被优化掉时症状同样是
  「系统调用失败」，且更难查。
- `mirrorIn` / `mirrorOut` 新增 `root` 入参：镜像根由 Rust 的 `app_data_dir()` 算好显式传入，
  不再让 Kotlin 用 `activity.dataDir` 自行推导（当前版本两者相同，是巧合不是约定）。

## 0.11.8 — 手机端接回 md 双向同步与悬浮条（双形态）

这一版只动手机端，桌面功能零变更；桌面侧新增的 4 条命令是桩（调用即回 `IO_ERROR`）。

### md 双向同步（SAF）

- 手机「设置 → 同步」页签：选 Obsidian 目录（SAF 持久授权）、三类数据各自开关、立即同步、状态。
- 原生层只把**当天那几个** md 文件镜像进沙箱，合并仍跑 Rust 的 `sync_all`（新增
  `root_override` 入参），跑完按内容差异写回——**合并规则只有一份**，不搬老工程的 `MdMerge`。
- 后台 15 分钟轮询（复用 `pollSecs`）；未授权时静默，配置类错误才 `log_warn`。

### 悬浮条（双形态，完全沿用老版本设计）

- **小圆点**（默认）：28dp 玻璃表盘——墨圈 → 径向渐变球面 → 内缘高光 → 墨/白双层轨道
  → 分针语义时针（60 分钟一圈）→ 进度弧（正计时 60 秒一圈、倒计时按剩余）→ 常驻轴心。
  点一下展开成条、3.5 秒后收回；`running` 由假变真时自动展开一次。
- **长条**：32dp 药丸 + 圆角方环（`PathMeasure` 裁段）+ 等宽时间 + 事项名。
- 前台服务 + `TYPE_APPLICATION_OVERLAY`；拖动记位、长按 520ms 开 App、旋转收边、
  500ms 刷新、倒计时末分钟一秒一闪；常驻通知标题「事项 · 时长」。
- 形态存 SharedPreferences（`overlay_style`），与位置、开关同一份；切换走 `overlay_set`
  的可选 `style` 入参，不新增命令。

**明确不做**：不在原生层写任何计时规则。浮条只读 `timing.db`，短按只有「展开 / 回主界面」，
没有暂停——那需要原生层调 Rust 命令，通路未验（见 `for-owner/待决事项.md` 1b）。

## 0.11.7 — 托盘一键同步 / 事项名「未归类」/ 新建与显示的字号

三条都是现场反馈，都不是「功能没做」，而是**用户的动作没有可见结果**：
点了菜单以为没反应、名字看起来丢了、新建那格比它变成的事项小一号。

### 托盘右键菜单 +「Markdown 同步」（点一下跑一轮双向同步）

- 新菜单项 `md_sync`，文案「Markdown 同步」，位置在「打开事项」之后、「便利贴…」之前
  （同步的对象就是事项计时，位置贴着数据讲）。
- 点击 → `md_sync::run`（**双向**：导出 + 导入一轮）→ 系统通知报**导入条数 / 导出处数**
  （`MdSyncReport.imported` / `.exported`，与命令层同一口径，不另造一套统计）。
  真的导入了数据时照旧广播 `mdSyncChanged`，各窗按老规矩自行刷新。
  说「处」不说「个文件」：`exported` 数的是**写文件的落点数**，两个落点可以指向同一个
  文件的不同标题（`MdSyncBinding::key()` 含 heading），按文件报会多报。
- **未启用同步时不再静默**：出厂默认是关的，点了会收到「先在设置里打开 Markdown 同步」。
  判据就是服务层读的那份配置（`md_sync::config::load`），不新造状态。
- 连点靠进程内 `AtomicBool` 闸挡：一轮没跑完时后续点击**不再起新的一轮**（原生菜单没有
  「忙碌」态可表达），但会收到**一条**「上一次同步还在进行中，请稍候」——连点 5 次只有
  1 条「进行中」，不是 4 条。只写日志等于又一次「点了没反应」。
- 闸用 RAII（`Drop` 复位），不在 async 块最后一行手写 `store(false)`：panic 会让手写那行
  跳过，而**挂起更现实**——落点常配在 OneDrive / 网络盘，IO 卡住时这一轮永不返回，
  闸就永久锁死。`Drop` 在正常返回 / `?` 早退 / unwind 三种路径上都会跑到。
- 五个通知调用点都检查了 `notify()` 的返回值：被专注助手 / 权限拦掉时落一条
  `log_warn`。通知是本功能**唯一**的反馈出口（尤其「未启用」那条），丢了返回值等于整条链无声消失。
- 实现落在 `app/tray_sync.rs`（`tray.rs` 加完这些会越过 300 行门禁，ADR-017）；
  `tray.rs` 只保留「菜单项 → 动作」的派发。

**代价（明确说清）**：同步失败时**只有通知**，没有可点的「查看详情」——细节落在
`logs/`（`log_warn`）。这是刻意的：一次托盘点击不该拉起一个窗口。通知文案会带上
错误列表（多个落点失败以「；」拼接），够定位到是哪个落点。
「进行中」那条同理只有通知，且**本轮只弹一次**：反向代价是同一轮里第 3 次点击起完全静默，
只留日志（连点本来也不该有回应）。

### 事项窗里的「未归类」：视图快照过期，不是数据丢了

- 现场：今天三条记录的 `item_id` 分别是 19 / 20 / 19，`items` 里两个事项名字都正常，
  界面上三行全显示「未归类」，而且被拆成三段。
- 根因：悬浮窗与事项窗是**两个 webview、两份 store**。悬浮窗新建事项时只刷新了它自己那份；
  事项窗是浮层（`useWindowLeaveHide` 只 hide 不卸载），「再打开」不重新 mount，首帧
  `useEffect([])` 不重跑 → 事项列表停在旧快照。`itemName()` 查不到就回落「未归类」，
  而 `todayGroups::identityOf()` 对「未归类」改用 `id:<itemId>` 当分组键 → 19/20/19 拆成三行。
- 修法：新增 `hooks/useItemsRefreshOnFocus`，重获焦点 / 重变可见时重拉 `list_items`，
  **主窗与事项窗共用这一处**（两窗互相改事项的路径一次收口）。
  **不新增 IPC 事件**（11 条事件是契约）：焦点是每个窗口天然有的信号，不值得为它加一条契约。
  取舍记在 `docs/decisions/ADR-052.md`。
- **代价**：主窗每次获得焦点会多打一次 `list_items`。它是本地 SQLite 的小表查询，
  换掉一整类「另一个窗口改了名字，这个窗口不知道」的问题，值得。窗口不可见时不拉。

### 「新建事项」那格与事项名的字号 / 字重对齐（只动 CSS）

- `.pill__empty`（空闲态「新建事项」）原为 `--text-body` 13px / `--weight-medium`，
  而它点开变成的事项名 `.pill__name` 是 `--text-task-pill` 14px / `--weight-strong`：
  一按 Enter 就「变大变粗」，中途点开输入框（`.pill__input` 本来就是 14px / strong）又跳回来，
  一共跳两次。现对齐到 14px / strong。
- **颜色不动**：仍是 `--ink-3` 的提示色（它是占位入口，不是已有数据），hover 仍是 `--ink`。
- 顺手核了事项窗「新增待办」卡：输入框 `--text-xs` 11.5px 与它生成的行 `.todo-pend__title`
  `--text-sm` 12.5px 也不一致（同一类毛病），一并对齐到 `--text-sm`。
  同一面板里的就地改名 `.inline-text` 与两个目标类（`.todo-pend__title` / `.todo-row__title`）
  **已核，一致**（都是 `--text-sm`），未改动。
- **代价**：文字变大变粗，小条在空闲态下宽约 3–4px（窗口按内容自适应）。仍需人眼确认观感。

## 0.11.6 — 便携数据目录 / 双形态打包

用户口径：「装到哪，数据就放在哪，整个文件夹拷走就能带走全部数据；不能在应用目录写就提醒我，
别偷偷换个地方」。落点决策见 `docs/decisions/ADR-050.md`，打包链路见 `ADR-051`。

### 数据落点：`<exe>\data`，不可写则明示回退

- 新增 `platform/app_dir.rs`：`Roots { data, plugins, portable }` 用 `OnceLock` 存**一次决策**，
  日志目录 / md 备份目录 / `db::init_pool` / 插件根全部改从这里取（此前各自算 `app_data_dir()`）。
- 新增 `app/portable_boot.rs`（顺序与判据）+ `app/portable_prompt.rs`（`rfd` 文案）+
  `infra/portable_probe.rs`（探测与标记文件读写）。三步都在 `Builder::run()` **之前**跑：
  `tauri-plugin-dialog` 的 `blocking_show` 不能跑在主线程，而这一步必须在主线程。
- 可写性判据是「建目录 → 写 16 字节 → 回读比对 → 删」，**不用** `permissions().readonly()`
  （只看属性位不看 ACL，`C:\Program Files` 上返回 `false` 却写不进去）。
- 不可写时弹三选一：**提权后重试** / **改用 AppData** / **退出**。选 AppData 后写
  `%APPDATA%\com.timing.app\portable-optout.json` 作为书面证据，并**再弹一次**说明
  「数据目录已改为 <路径>」。删掉该文件即恢复探测。
- 两个落点都不可写 → 提示后 `exit(3)`；便携版缺 WebView2 → 提示（可一键打开下载页）后 `exit(4)`。

### 老数据：只复制、不删除、幂等

- 新增 `infra/portable_migrate.rs`：`%APPDATA%\com.timing.app` → `<exe>\data`，复用
  `appdata_migrate` 的 `copy_tree` / `verify` / `rename_aside` 原语，**不共用**它的全局缓存。
- 顺序固定：清残留临时目录 → 判据（目标有库或有标记 = 什么都不做）→ 复制到 `<target>.migrating`
  → 校验 → 原目标改名备份 → 换名 → 写 `migrated-to-portable.json`（标记在数据目录里，随数据走）。
- 失败不阻断启动：用户看到的是「重试 / 改用 AppData / 退出」三选一，细节进 `logs/`。
  只有**写标记文件失败**这一种会额外落 `%APPDATA%\com.timing.app\portable-migrate-failed.txt`
  （复制 / 校验 / 换名三种失败不写该文件）。
- **源目录全程只读**，且这条现在是机械成立的：四重校验的 V4 行数比对改在**影子副本**上开库
  （只读连接同样会让 SQLite 在源目录落地 `-shm` 32 KB / `-wal`，以前那句承诺是假的）。
- 换名前的旧 `<exe>\data` 备份**挪到** `%APPDATA%\com.timing.app.portable-premigrate-<ts>\`
  （`source` 的兄弟目录，不是它里面；exe 旁边只留 `Timing.exe` / `data` / `plugins`）。
  放进 `source` 里会让「旧目录只读」破功，且下次迁移会把备份当用户数据一起复制。
  跨盘 rename 会 `EXDEV`，退成「复制 → 删原件」。

### Markdown 同步默认根改 `%APP_DIR%\md`

- `MD_SYNC_DEFAULT_ROOT` → `%APP_DIR%\md`（落在 `<exe>\data\md`）。`%APP_DIR%` 在 `expand_env`
  里**先于** `%VAR%` 展开（否则用户环境变量里有个 `APP_DIR` 就把默认根劫持了），永不留下未展开的占位符。
- `expand_env` 从 `infra/md_file.rs` 搬到 `infra/md_env.rs`（原文件 298 行顶到门禁上限），
  对外仍由 `md_file` re-export，调用点零改动。
- **用户保存过的 root 一个字节都不动**（`merge_bindings` 语义未变；`enabled` 出厂仍 `false`）。

### 插件目录跟着搬

- `plugins` 与 `data` 同级放在 `<exe>\plugins`（不是 `<exe>\data\plugins`）：`plugin_fs::scan_roots`
  会把同一目录当两个来源扫两遍，同 id 互相判「被跳过」。便携模式下 `exe` 与 `user` 根本就是同一
  目录，`scan_roots` 末尾按小写路径去重。
- 迁移时若 `<exe>\plugins` 已存在（便携包自带 `plugins\README.txt` 占位，所以这是**常态**）：
  **逐个子目录**搬到 `<exe>\plugins\<name>`，撞名的留原地 + WARN，两边都不删不覆盖。整目录放弃
  会让升级用户的插件文件还在、功能全没（`data\plugins` 不在扫描拓扑里）。

### 双形态打包

- 新增 `scripts/build-desktop.mjs`：`--portable`（`tauri build --no-bundle` + bsdtar 打 zip）/
  `--installer`（`--bundles nsis`）/ 缺省两者都出，**共用一次 Rust 编译**。
- `release/*.zip` 走 Windows 自带 bsdtar（`tar -a -cf`），不用 `Compress-Archive`（zip 里路径
  分隔符是 `\`，跨平台解压出乱码目录）。
- 前端资源变更靠 `dist/` **内容指纹**判定（`cargo` 不把 `dist/` 当输入，只重建 dist 会在 exe 里
  留上一版 UI）；指纹变了才 `touch src-tauri/build.rs`。`cargo clean --release -p timing` 退役。
- 安装包改 `nsis` 单目标 + `installMode: currentUser`（装到 `%LOCALAPPDATA%\Timing`，恒可写），
  `beforeBuildCommand` 由脚本用 `--config` 覆盖为空，避免前端被编两遍。

### 契约

- **命令 67 / 事件 11 / 错误码 16 全部不变**（ADR-050 §7）：落点信息只在启动期对话框里告知，
  不经 IPC 暴露；启动期提示一律 `rfd` 原生对话框，不 `emit`。

## 0.11.5 — 圆点放大 / 外环增长 / 置顶重申 / 高亮覆盖圆点 / md 同步内核化 + 插件 API v3

用户口径：「小圆点太小了，放大 1.5 倍；外圈那条环不要长度固定地绕圈，要从 12 点随着时间往前
延伸，60 秒长满一圈后重来；小圆点形态老被别的窗口盖住；托盘双击的高亮对小圆点不生效」，
外加架构侧决定：Markdown 同步从插件搬进内核，插件 API 升到 v3。

### 小圆点：33px + 增长弧 + 可高亮

- **22px → 33px**（1.5 倍）：`--dot-size` 与 `CollapsedDot` 全部几何常量等比放大，描边单独微调
  （1.1 / 2.4 / 1.5）——严格等比在 1x 屏上会糊。
- **外环弧改为「从起点增长」**：正计时（running / paused）用 `frac = (displaySec % 60) / 60`
  配 `stroke-dashoffset`，弧从 12 点生长，60 秒长满一圈后重来；暂停时弧冻在当前长度，靠颜色
  区分暂停。原先那套「90° 固定短弧 + 整组 `<g>` CSS 转 60s」连同 `data-turn` / `dot-turn` 一起删除。
- 倒计时 / 待命 / 结束 / 空闲**不改口径**：仍复用 `MainButton.arcSpec`。
- **托盘双击高亮覆盖圆点**：`HIGHLIGHT_MS` 提到 `lib/constants`，圆点自己订阅 `highlightSeq`，
  挂 `data-highlight`，用 `inset` box-shadow 画内侧环（窗口贴内容，外发光会被裁掉）。
  `dot-warn` 改的是 opacity、高亮改的是 box-shadow，两者可同时成立。

### 主窗恒定置顶

`alwaysOnTop: true` 只建窗那一刻生效。收起成圆点时前端会 `set_position` + `set_size`，几何变动后
主窗实测会被别的窗口盖住。现在 `show_main()` 之后重申一次置顶，主窗的 `Moved` / `Resized`
事件后再重申一次（失败只记日志，不新增 IPC 命令）。

### Markdown 同步：插件 → 内核，出厂默认关

- 默认三档落点（timers / notes / todos）改由内核 `default_bindings()` 给出，标题走
  `MdSyncKind::label()`；`Default::default().enabled = false`，**`enabled` 的 serde default 同步改成
  `false`**（只改 Default 不改 serde，JSON 缺字段就会变 true，两处口径分叉）。
- 老用户保存值里 `enabled: true` 原样保留；`merge_bindings` 仍是「保存值在前、只补缺 kind」，
  用户改过的根目录不会被默认值静默覆盖。
- `config::load` / `poll_secs` 去掉 `app_data_dir` 参数，`Loaded` 与 `installed()` 删除；
  `CONFIG_KEY` 值 `plugin.md-sync.config` 不动（老用户磁盘上的键）。
- 删掉仓库内 `plugins/md-sync/`（`plugin.json` + `README.md`），`plugin_dev` 测试文件随之删除。

### 插件 API v3

- `PLUGIN_API_VERSION` 2 → 3；`contributes.mdSync` **下架**：字段保留（`Option<serde_json::Value>`，
  能「看见它存在」但不解析），`PluginInfo` 增加`warnings: Vec<String>`。
- 写了 `mdSync` 的清单**不再拒载**，改为黄字警告（插件仍生效）；红字 `error` 仍是「没生效」。
- `permissions` / `engines` / `author` / `homepage` / `dependencies` 只写进规格与类型，本轮不解析、
  不校验（解析留给 v0.11.6）。

## 0.11.4 — 小圆点：缩一半、改成钟表口径、点开是临时的

用户口径：「悬浮形态小圆点太大了，缩小一倍；外环应一分钟转一圈，内部分针一小时转一圈；
在选择小圆点形态时，点击小圆点唤起悬浮条形态，鼠标挪走后恢复小圆点；悬浮条形态则不启用
小圆点及相应图形」。

### 圆点尺寸与读数

- **44px → 22px**（`--dot-size` + `CollapsedDot` 全部几何常量等比折半）。描边不完全跟着减半
  （表盘 0.75 / 环 1.8 / 针 1.1），否则 1x 屏上只剩一团灰。
- **外环一分钟一圈**：表盘 + 进度弧合成一个 `<g class="dot__ring">`，CSS `dot-turn` 60s 匀速。
  原先正计时用的是 `dashoffset` 行进（3.2s 滑一段），那是「弧在爬」，不是「环在转」。
- **暂停不撒手**：`data-turn` 只控制 `animation-play-state`。停表时撤销动画会让环瞬间弹回 12 点，
  看起来像「重置」；冻在当前位置才读得懂「停住了」。
- **内部分针一小时一圈**：角度从 `displaySec % 60`（一秒 6°）改为 `displaySec % 3600`（一秒 0.1°）。
  倒计时**不改**：仍按「已用比例 × 360°」整圈走完——倒计时的「一圈」就是它的总时长，
  换成 3600s 口径反而读不出还剩多少。

### 小圆点形态下点开是「临时条」

- 点圆点仍展开成悬浮条，但**鼠标移出就收回**（`App.tsx`：`mouseleave` + 300ms 延时，
  移回来即取消）。300ms 不是手感问题：展开瞬间窗口从 22px 变成一条，指针可能正好落在
  新窗口外面，不等一下就收会表现成「点了没反应」。
- **有东西开着就不收**：`uiStore.hasOpenSurface()` 一处判断面板 / 倒计时菜单 / 提醒卡 /
  便利贴清单 / 事项菜单 / 摸鱼菜单 / 常用事项 / 内联命名 / 恢复框 / 撤销条。
  这些是用户主动打开的，代他收起来等于替他关东西。新增浮层只改这一个判断。
- 悬浮条形态整段短路：条本来就常驻，没有「收回」这回事，也不会渲染任何圆点图形。

### 权限修复（用户截图里的「界面异常」）

- `capabilities/default.json` 与 `mobile.json` 只放了 `core:event:allow-listen` 与
  `allow-emit`，漏了 `core:event:allow-unlisten`。于是每次事件订阅组件卸载、cleanup 里
  调 `unlisten()` 都被拒绝，抛成 unhandled rejection，被全局钩子显示成
  「界面异常：event.unlisten not allowed」的红条。补上该权限。

### 出包：APK 版本号不再卡在上一版

- `gen/android/app/tauri.properties` 是 **tauri CLI 生成**的，而出包脚本绕过 CLI 直接调
  Gradle，所以它不会自己更新 —— 实测代码到 0.11.4、APK 里仍写 `0.11.3 / 11003`。
  现在脚本每次先按 `tauri.conf.json` 重写该文件（`versionCode = major*1e6 + minor*1e3 + patch`）。
- Gradle 加 `--no-configuration-cache`：版本号是**配置阶段**读进去的，配置缓存一复用，
  改了 `tauri.properties` 也不会重新读。这条比「记得手动清缓存」可靠。

## 0.11.3 — 五条待决落地：跨天分段 / 待办绑定 / md 优先 / 同步降频

上一轮把五条「要用户拍板的语义」列进了待决事项，这一轮全部按答复落地。

### Markdown 是第一优先级资料（用户口径）

- **冲突时 Markdown 赢**：原先两边都改过时比 `mtime` 与 `updated_at`、最后写入者胜。
  但两者时基根本不同 —— `updated_at` 是应用写库的毫秒墙钟，`mtime` 取决于谁最后碰过文件
  （Obsidian 关闭补写、同步盘回写、一次「无改动保存」都会推后它），结果会**偶发让数据库
  覆盖掉用户手改的日记**。现在只有「文件没变、库变了」才导出，其余一律以文件为准。
- **手动同步也会广播**：`md_sync_run` / `md_sync_save` 之前只返回报告、不 emit 事件，
  点「立即同步」把 md 的改动导进库之后，除设置页外的窗口（今日计时 / 待办 / 便利贴）
  全都还是旧数据，得等下一次轮询。现在导入非零时同样广播 `mdSyncChanged`。
- **同步间隔从 2 秒改为默认 15 分钟、可调**：2s 轮询的代价不在读文件，而在每轮都要
  按天取数 + 渲染整段区块 + 比对字符串（一天几千次全量渲染）。间隔进了配置
  （`MdSyncConfig.pollSecs`，1 分钟 ~ 24 小时），设置页可改，轮询任务每轮重读配置再决定睡多久。
  「立即同步」按钮保留为主用法。
- 顺带删掉三处 `MAX(updated_at)` 聚合：冲突判定不用它了，`Exported::latest_update` 一起移除。

### 跨零点分段记录

- 一段 23:40 → 00:20 的会话现在**落库时就拆成两条**（昨天 23:40-24:00 / 今天 00:00-00:20），
  而不是整条挂在昨天。累计秒数按墙钟占比分、余数归后一段，**总和守恒**。
- 覆盖四条结束路径：手动结束、倒计时到点、崩溃恢复的「结束并保存」、切换事项的「结束并开始」。
- 分段在落库层完成，不是导出层裁剪 —— 后者只是渲染假象：库里仍是同一条记录，
  用户改其中一段时间、在日记里删掉某天的行、或两端各自导入，都会绕回同一条记录。
- 新增 `services/timer_split.rs`（含 5 条单测）；`day_bounds` 从 md 同步模块搬到
  `platform::clock`（三处共用同一条日界）。

### 待办绑定事项（schema v5）

- `todos` 增加 `item_id`（可空）。待办开始计时的归属改为：**绑定优先，标题兜底并回填**。
  原先一律按标题匹配，用户把「写周报」改成「写周报（二稿）」再开始，就会新建一个同名事项，
  同一件事在统计里裂成两条。
- 老数据不回填（回填等于重跑一次标题匹配，同名待办会被绑成一条），第一次开始计时时回填。
- 新建待办时若标题正好等于已有事项名，直接绑上；绑过的事项被删则回落到标题匹配，
  不让「开始」直接失败。
- 迁移 `0005_v0113.sql`：`schema.version = 5` + `idx_todos_item`。

### 逾期待办删除（确认口径，未改代码）

- 现有行为已符合要求：每 15 秒扫描一次，`planned_at` 早于「今天 00:00」且未完成的待办
  一律软删（可追溯）；应用没开则下次启动补齐。本轮只补文档说明，不改代码。

### 其它

- `infra::shell_open` 新增 `open_file`：md 同步打开今日文件不再自己拼一份 `explorer` 调用，
  开文件的安全口径统一到一处。
- `services/md_sync/config.rs` 承接 `poll_secs`，`mod.rs` 从 311 行回落到 293 行（≤300 门禁）。

### 出包修复（用户实测反馈：一个装不上、一个打不开）

- **APK 里没有前端**：`scripts/android-apk.mjs` 调 cargo 时没带 `--features custom-protocol`，
  而这个特性正是「把 `dist/` 编进 `.so`」的开关。不开的话运行时去找 `devUrl`
  （`http://localhost:1420`），手机上没有那个服务 → 装上就是纯白窗口。
  桌面端 `build-release.cmd` 一直带着这个参数（注释里还写着不加会白屏），移动端脚本漏了。
- **release 产物未签名**：Gradle 的 `assembleRelease` 只出 `*-unsigned.apk`（debug 变体才会
  自动用调试证书签），未签名的包传到手机上，安装器连解析都过不了，报「解析软件包时出现问题」。
  新增 `scripts/android-sign.mjs`（zipalign → apksigner → 归档进 `release/`），
  `android-apk.mjs` 检测到 `src-tauri/gen/android/keystore.properties` 时自动签，没有则明确告警。
- **加了一道自检**：复制 `.so` 后检查里面有没有 `/assets/` 字面量，零命中直接失败并退出，
  不再产出「装得上但白屏」的包。本轮的坏包就是这么漏出去的。
- 已删掉 0.11.3 的两个坏包（debug 206M / release 9M），`release/SHA256SUMS.txt` 更正为
  可安装的 `-release-arm64-debugsigned.apk`。0.11.1 / 0.11.2 的历史包保留原样作对照，同样不可分发。

## 0.11.2 — 深度巡检：11 处数据与交互缺陷

本轮不引入新功能，只做「把已有功能修对」。三路并行审查（Rust 后端 / 前端状态与副作用 /
双端交互），逐条在源码里复核后修掉 11 处，其余 30 余处按「需要拍板的语义变更」列入待决。

### 数据安全（会丢数据/写坏数据，优先修）

- **重启后离线时长被折进累计（P0）**：`flush_active` 每 15s 折账一次，而进程重启后锚点表为空，
  `elapsed_ms` 只能退回**墙钟差** —— 那正是「应用关着的时间」。恢复对话框还没点，
  累计已经被加了十几小时；再选「不计入退出期间」也没用，因为 `gap_sec` 从被推进过的
  `running_since` 起算，返回 0。现在跨进程遗留的会话一律让路（无锚点 + 跨度 > 2 个折账周期），
  折与不折完全交给恢复对话框。`flush_active` 同时拆到 `services/timer_flush.rs`（含 2 条单测）。
- **便利贴保存失败仍然关窗（P0）**：`saveContent` 内部 catch 后不抛错，`closeNote` 里那句
  `.catch()` 永远不会触发，窗口照关 —— 而窗口一销毁，正文只活在内存里，库里还是旧内容。
  现在 `saveContent` 返回 `boolean`，`closeNote` / 手机端 `finish()` 落盘失败一律**不关窗**并给文案。
- **进行中的会话可被 `delete_record` 软删**：唯一索引 `uq_records_open` 按 `status='active'` 建、
  不过滤 `deleted_at`，删掉后「看不见但占着槽」：界面显示空闲，`start_timer` 永远回「已在计时」，
  只能改库恢复。仓储层与业务层都补了 `status='saved'` 校验。
- **落盘回声覆盖落盘期间的输入**：`saveContent` 成功后会 `set({ note })` 把服务端旧内容写回本地，
  这几百毫秒里打的字被吞掉，且下次「无变化」判定会跳过保存。现在只更新 `savedContent`。

### 存储与同步

- **UTF-8 BOM 导致 md 章节无限追加**：记事本存成「UTF-8 with BOM」时 `line.trim()` 剥不掉 `U+FEFF`，
  首行标题永远匹配不上 → 每 2s 一轮同步都在文件末尾追加一节。读写入口统一剥 BOM，写回时补回。
- **夏令时地区会灌全量历史**：`day_bounds` 在「本地 00:00 不存在」的时区返回 `from = 0`（1970），
  当天会把这辈子的记录一次性写进日记。改为按 30 分钟粒度摸索到真实存在的时刻。
- **打开今日文件可被注入命令**：Windows 走 `cmd /C start`，路径来自插件 manifest 的
  `root`/`file`，含 `&`/`|` 且不带空格时 cmd 会把后半段当命令执行。改用 `explorer`（不经 shell）。
- **倒计时到点不清锚点**：与 `timer_stop` 不一致，锚点表只增不减，攒满 8 条会把正在用的起点挤掉。
- **倒计时到点不触发「结束后自动开始」**：同一件事手动停止会触发，倒计时不会，用户答应的
  「这条结束后开始下一条」只在手动路径生效。两处收尾现已统一。

### 桌面端

- **小圆点不能拖动**：44px 圆点只有一个 `onClick`，收起后 `PillBar` 已卸载，主窗再没有任何抓手。
  现在复用 `usePillDrag`（4px 阈值 + 拖完吞掉那次 click），单击仍是展开，光标 `grab`。
- **别窗调不透明度会强行收回圆点**：`storage` 事件无条件 `applyFloatForm`，于是设置窗拖一下
  滑杆，主窗「临时展开的小条」就被按常驻形态收回去。现在只有 `floatForm` 真变了才动收起态。
- **提示条只挂在主窗**：事项窗 / 设置窗 / 便利贴窗里大量 `setNotice` 调用点（开便利贴失败、
  设提醒失败、删除失败）全部静默。三个窗口各补一个 `<NoticeBar />`。
- **记录面板改归属 / 删除失败无文案**：只有 `try/finally`，拒绝冒泡到 `unhandledrejection`，
  被 ErrorBoundary 显示成「界面异常：<后端原始消息>」。现在 catch 后走 `errorText`。
- **跨零点记录显示成负时长**：`23:50 - 00:20`。`formatRange` 补跨天分支（「次日」/ 日期）。
- **emoji 事项名被切成「�」**：`truncateName` 用 UTF-16 `slice`，会切断代理对。改为按码点截断。
- **计时状态乱序回写**：倒计时到点的事件刷新与用户点「结束」的刷新并发时，较早发出但较晚
  到达的那次会把旧状态写回（「结束完又跳回计时中」）。`timerStore` 加请求代次，过期即丢弃。

### 手机端

- **便利贴删除一键永久删除**：编辑页「删除」与「完成」并排同尺寸，误触即不可恢复。改为二次态
  （3.5s 内再点一次才删，桌面 `NoteHeader` 同口径）。
- **便利贴列表不刷新**：编辑 Sheet 是覆盖层，`NotesPage` 始终挂载 —— 新写的看不到、改过的是旧文本。
  新增 `notesNonce` 信号（与 `recordsNonce` 同构）。
- **长按删除的确认条在列表顶部**：列表一长，用户在下方长按时屏幕上毫无变化。确认条改为贴着
  被删那行展开，行本身也加 `data-pending` 高亮。
- **已完成的待办永远删不掉**：`if (!done) onDelete()` 把回调拦死，而调用方确实传了 `onDelete`。
- **双击「开始」必出假报错**：第二次点必然收到 `TIMER_ALREADY_RUNNING`。`useTimerActions.start`
  加在途锁（模块级，跨组件共用）。
- **通知权限被拒后「申请」按钮永久失效**：缓存短路连 `isPermissionGranted()` 都不再查。
  设置页按钮改为 `force`，先去系统查现状。
- **异步关 Sheet 会误关新开的**：`closeSheet()` 现在可带 `kind`，只关自己那一类。
- **长按计时器卸载不清理**：行被删或切页后 500ms 仍会触发回调。
- **手机设置里能改「悬浮形态」**：手机没有悬浮条，切了界面零变化却写进 localStorage 回桌面生效。

### 构建

- **安卓出包脚本会打进桌面版前端**：`scripts/android-apk.mjs` 直接调 `npm run build`，
  没设 `TAURI_ENV_FAMILY=mobile`，而 `vite.config.ts` 正靠它决定 `__TIMING_MOBILE__`。
  现在显式注入，APK 里才是 `MobileShell`。

### 验证

- `npm run check` 全绿：typecheck / 契约（67 命令 · 16 错误码 · 11 事件）/ 450 文件 ≤300 行 /
  版本六处一致 / 分层 7 条 / 品牌 0 违规 / eslint 0 warning。
- `cargo test --lib` **355 条全过**（新增 `flush_should_defer` 2 条）。
- `vitest` **43 文件 333 条全过**（新增 `format.test.ts` 7 条 + `noteStore.saveContent` 3 条）。
- 桌面 `vite build` 与安卓 `assembleRelease`（arm64-v8a）均通过。

## 0.11.1 — 圆点改纯图形秒表 + 今日同名事项合并 + 安卓出包环境

### 桌面端：小圆点重做（ADR-040）

- **推翻 0.11.0 的「76px 环 + 时分」**。用户口径：「环是图形化语言，不应放时间」，
  并给出参照图（秒表）。新形态 **44px 三层纯图形**：
  - 表盘：1.25px 细环，恒灰（`--line-3`），不随状态与四色主题变；
  - 进度弧：3.5px 圆头，`stroke: currentColor`，语义仍复用 `MainButton.arcSpec`
    （倒计时收缩 / 正计时 90° 行进 / 暂停 270° 静弧 / 结束整周加粗 +0.8px）；
  - 指针：2.2px 圆头短线 + 中心圆点，**正计时 60 秒一圈**、倒计时按已用比例前进，
    暂停时随 `useTimerTick` 冻结、空闲 / 结束回 12 点。
- 圆点里不再有任何文字；读数移到 `title`（悬停看「时长 · 事项名」）。
- `--dot-size` 76 → **44**；`dot.css` 删除 `.dot__time` / `.dot__track` / `.dot__bar`
  与 `data-long` 分支，新增 `.dot__rim` / `.dot__arc` / `.dot__needle` / `.dot__pin`。
- 窗口尺寸无需改：`useWindowAutoFit` 会把 OS 窗口收缩到可见包围盒。

### 桌面端 + 手机端：今日事项按名字认（ADR-040）

- `lib/todayGroups.ts` 分组键由 **itemId** 改为 **名字**：今天同名即同一件事，
  同名但不同 id 的事项不再各占一行；`itemId` 取组内最早那条，供右键改名 / 便利贴预览。
- 时间分段不变：间隔 > 60s 另起一行，仍按开始时间升序 —— 「写周报写了两段」看到的就是两行。
- **数据库与 md 不拆**：记录仍是独立 `records` 行、事项仍一条；`export::timers` 按
  `item_name` 归并到同一个条目（多段 `intervals`），一天一个 md 文件。
- 新增 `UNNAMED_FALLBACKS`（`未归类` / `已删除事项` / 空串）：名字不成立时退回按 id，
  避免所有已删记录挤成一行。

### 构建环境：安卓出包（首次打通）

- 本机已装 Android SDK（`platforms 35/36`、`build-tools 36.0.0`、`ndk 27.2.12479018`、
  `platform-tools`）与 **OpenJDK 21.0.2**（`C:\Software\jdk-21.0.2`）。
- 用户级环境变量写入 `JAVA_HOME` / `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `NDK_HOME`。
- 新增 debug APK 构建产物（`--target aarch64 --apk --debug`）。
- `src-tauri/gen/android/app/tauri.properties` 的 `versionName` / `versionCode` 同步到 0.11.1 / 1101
  （此前停留在 0.5.0 / 5000，是 0.5.0 那次改名时漏掉的自动生成文件）。

### 验证

- `npm run typecheck` / `npm run lint --max-warnings=0` / `vitest run`（42 文件 323 条）全绿。
- `todayGroups.test.ts` 新增两条：同名连续合并、同名两段按时间分列。

## 0.11.0 — 悬浮形态可切换 + 手机端便利贴 + 事项计时联动

> 版本从 0.5.0 直接跳到 0.11.0：0.2.x–0.5.x 是内部滚动小版本（0.5.0 只做品牌改名），
> 本轮把「手机端功能补齐 + 桌面悬浮形态」合成一个完整里程碑，重新对齐版本账。
> 自此**每轮迭代只递增末位**，升 0.12.0 / 1.0.0 须经用户同意（规则见 ForgeX `00-规则/R2`）。

### 桌面端：悬浮形态 + 小圆点重制（ADR-038）

- **设置 → 外观 → 显示**新增「悬浮形态：悬浮条 / 小圆点」。切了立即生效（收起 / 展开），
  不重启；偏好落 `localStorage`（`timing.appearance.v1` 的 `floatForm`），不写库、不进 settings 表。
- **小圆点从 28px 空心环改为 76px「环 + 时间」**：与手机 `TimerRing` 同一个视觉语言——
  环在外、`MM:SS` 在里、弧语义直接复用 `MainButton.arcSpec`（倒计时只收缩 / 正计时 90° 行进 /
  暂停 270° 静弧 / 结束整周加粗）。读数口径与悬浮条完全一致（倒计时显剩余、待命显时长、
  否则正计时）；倒计时剩 ≤60s 切红并 1s 闪烁。
- 跨小时时字号从 15px 降到 11px（8 个字符塞不进 76px 的圆）。
- **常态与运行时分离**：`floatForm` 决定启动形态，`collapsed` 是这一刻显不显示条。
  用户临时点开看一眼条，**不回写**形态偏好。
- 样式迁出：新增 `src/styles/dot.css`（`surfaces.css` 已 296 行，再塞必破 300 行门禁）；
  删除死令牌 `--hit-target-dot`。

### 手机端：便利贴（ADR-039）

- 新增第 5 个页签「便利贴」：列表（按更新时间倒序，两行预览 + 归属事项 + 时刻）、
  一键新建（默认挂当前事项）、编辑页（正文 / 改归属 / 解绑成随记 / 删除）。
- **数据落点与桌面完全一致**：直接走桌面那 5 条 `note_*` 命令与同一张 `notes` 表，
  契约零变化（命令 67 / 事件 11 / 错误码 16 / schema v4）。
- **md 同步不写移动代码**：`plugins/md-sync` 的 `notes` 绑定由桌面宿主每 2 秒轮询执行；
  手机端 `md_sync_*` 仍是桩（无 SAF 目录授权模型）——与计时的现状完全同构。
- 空正文关掉即删除（同桌面 `closeNote` 口径），不留看不见的空白贴。
- 新增 `services/mobileNoteActions.ts`、`components/mobile/{NotesPage,NoteSheet,NoteItemSheet}.tsx`、
  `styles/mobile/notes.css`；底部 Tab 从 4 列改 5 列。

### 手机端：事项与计时联动

- 事项页顶部汇总条新增「正在计时 · 事项名 + 实时读数」一行：手机在事项页也能看到秒表在走
  （桌面小条常驻，不会有这个疑问；手机切页就看不见了）。
- 待办行「计时中」标记改为**实时读数**（`MM:SS`），暂停仍显示「已暂停」。
- 待办标题没有同名事项时，行内给一行灰字预告「开始后自动建同名事项」——
  后端 `todo_start` 的匹配/新建语义对用户可见。
- **已知边界不变**：待办与事项仍是**按标题匹配**，不是真绑定。两条同名待办无法区分，
  根治需给 `todos` 加 `item_id`（数据模型改动，须用户拍板，未在本轮做）。

### 门禁

- `npm run check` 全绿：typecheck / contract（67/67/67/67 · 16/16 · 11/11）/ size（448 文件）/
  version（0.11.0 六处）/ layers（403 文件）/ brand（违规 0）/ lint。
- `npm test`：42 文件 322 条全绿（新增 `appearanceStore.test.ts` 5 条；改写
  `ItemsPage.todoStart.test.tsx` 一条断言以匹配实时读数文案）。
- `npm run build` 与 `TAURI_ENV_FAMILY=mobile npx vite build` 均通过。
- **未做**：Rust 侧零改动，故未跑 `cargo test`（本工作副本不含 `src-tauri/target`）；
  安卓未出包（本机无 SDK/NDK/JDK）；真机视觉未确认。

## 0.5.0 — 品牌更名为 Timing（老数据自动迁移）


**显示名 / 包名 / 安装产物 / 托盘 / 窗口标题**：`TickBar` → **`Timing`**（决策记录见
`docs/decisions/ADR-036.md`；工程代号与产品的错位从 0.2.0 起就存在）。

| 面 | 旧 | 新 |
|---|---|---|
| npm 包 / Rust crate / lib | `tickbar` / `tickbar` / `tickbar_lib` | `timing` / `timing` / `timing_lib` |
| identifier（Windows 数据目录） | `com.tickbar.app` | `com.timing.app` |
| 安卓包名（Tauri mobile） | `com.tickbar.app` | `com.timing.app` |
| DB 文件名 | `tickbar.db` | `timing.db`（迁移时连同 `-wal` / `-shm` 一起映射） |
| 日志 / 级别变量 / 平台常量 | `tickbar-*.log` / `TICKBAR_LOG` / `__TICKBAR_MOBILE__` | `timing-*.log` / `TIMING_LOG` / `__TIMING_MOBILE__` |

### 迁移：老数据自动搬过来，**只复制、不移动**

首次启动时把 `%APPDATA%\com.tickbar.app` 整棵树复制到 `com.timing.app`，四重校验（逐文件
字节数 / `PRAGMA integrity_check` / 五表行数 / `schema.version` 可读）通过后才换名上线。
**老目录永久保留、一字节不动**——回滚到 0.4.x 仍能读到全部老数据。

失败时给三选一（重试 / 以空白数据启动 / 退出），并往老目录写 `migration-failed.txt`；
选过「以空白数据启动」的人下次启动仍会走覆盖式迁移（空白期数据改名保留，不删除）。

### 契约变化（**命令 65 → 67**，其余不变）

- **命令 65 → 67**：新增 `get_migration_info`（设置页卡片读迁移来源）与 `open_legacy_dir`
  （打开旧数据目录）。**这是 0.5.0 唯一的契约增量**，理由见 `docs/decisions/ADR-037.md`。
- 事件 **11 不变**；错误码 **16 不变**；DB schema **v4 不变**（无新表、无新列）。
- 设置 → 通用页签底部新增「数据迁移」卡片（桌面端；显示数据来源、行数摘要、迁移时间）。

### 升级须知

- **安卓**：包名从 `com.tickbar.app` 改为 `com.timing.app`，系统视为**另一个应用** →
  **必须先卸载旧版再安装**，不能覆盖升级。**本轮不提供安卓构建产物**（本机无
  Android SDK/NDK/java；包名与重装路径见 `docs/rename-v0.5.0/PRD.md` §5）。
- **桌面**：直接覆盖安装即可；老数据在首次启动时自动迁移。回滚到 0.4.x 能读老数据，但
  读不到 0.5.0 之后新增的记录（单向门）。
- 旧环境变量 `TICKBAR_LOG` 与 5 个 `tickbar.*` localStorage 键**保留一个版本的只读回落**
  （命中时日志会打一条弃用 WARN），0.6.0 移除。

### 门禁

新增 `npm run check:brand`：全仓 `git grep -i` 扫描品牌残留（大小写不敏感 + 未跟踪文件），
归档目录 `android-app/` 强制打印跳过数量而不是静默跳过。

## [未发布] V1.0-Android：Rust 侧平台门控 + APK 出包

依据 `docs/mobile/DESIGN-ANDROID-V1.md` 执行 **T2 / T3 / T4 / T5 / T13**，前端 T6–T12 已就位。
**契约零变化**：命令 65 / 事件 11 / 错误码 16，`check:contract` 输出 `65/65/65/65 · 16/16 · 11/11`。

### 手机端走查修复（2026-11-03，全前端）

以 390×844 视口真机式走查（CDP 点击）后修掉 4 项，桌面与移动共用部分一并受益：

- 新增 `hooks/useEndedFlash.ts`：`uiStore.endedAt` 是「时刻」且不清零，组件重挂载会把上一次
  结束重放成 900ms「已保存」。改为按窗口判定（过期不重放、只闪剩余毫秒），
  `PillBar` / `CollapsedDot` / `TimerPage` 三处共用（桌面折叠→展开的同一问题一并修掉）。
- `UndoToast` 撤销成功后 `bumpRecords()`；`ItemsPage` 订阅 `recordsNonce` 重拉今日记录——
  此前在记录页就地点撤销，总计条数不刷新。
- 触控目标：`.m-seg__item` 由 40px 抬到 `var(--m-tap)`（44）；取色行色点 18→24px 并用
  `::after` 把热区补到 44×44（不动桌面 `SwatchRow` 的 DOM）。
- `vite.config.ts` 新增 `platformCss()`：桌面构建在 transform 阶段摘掉 `styles/mobile/*` 的
  导入（CSS 无法像 JS 一样摇树）。桌面 CSS 102 → 86.53 kB，产物里不再有 `.m-*`。
- 重新出包 `release/TickBar-v0.4.1-android-arm64.apk`（8.6 MB，debug keystore，仅自测安装）。

### 手机端待办直连计时（2026-11-04，全前端）

用户口径：「安卓端关于事项的逻辑与电脑端不同，事项是绑定计时的，待办事项应可以直接开始计时，
参考电脑端的逻辑进行优化」。桌面一直如此，手机端此前只有空闲态能开计；本轮补齐「已经在计时时点待办」
这条路径，并修掉 QA 两轮走查暴露的死按钮与零反馈窗口。

**用户可见的变化**

- 计时中（running / paused）点待办「开始」：**原来**后端 `todo_start` 的第一道守卫就回
  `TIMER_ALREADY_RUNNING`，用户点第二次只得到一句报错、待办还留在列表里；
  **现在**弹「结束并新开 / 仅改归属」选单，**切换成功后**才把待办移出待办区
  （切换失败则待办原样保留，可重试）。
- 已完成待办的「开始」按钮移除：后端对 `done_at` 非空的待办一律回 `TODO_NOT_FOUND`
  （`services/todo_start.rs` 的守卫），那个按钮点了必报错，是死按钮。要计这件事先点圆圈取消完成，
  或直接新建一条。
- 「计时中」标记：**原来**同样按标题匹配，但待办开始后已被软删、不在列表里，标记几乎永不出现；
  **现在**标记由事项名称匹配驱动，且暂停态显示「**已暂停**」而不是「计时中」——
  手机端的「继续」入口只在计时页，光看「计时中」分不出秒表还在不在走。
- 空闲态连点「开始」不再发第二条命令：**原来**第二发必然撞 `TODO_NOT_FOUND`，
  用户在**已经看到开始计时之后**收到一条「待办不存在」红条；现在由一把锁挡住。
- 非 idle 时点**另一条**待办不再被「另一条正在开计时」挡住（锁只在 idle 分支内），
  任何时刻点待办都有明确反馈：要么开始计时，要么弹出选单。

**实现要点**

- 新增 `components/mobile/SwitchModeSheet.tsx`：`SWITCH_MODES` 成为「结束并新开 / 仅改归属」
  两句话的**唯一文案来源**，`SwitchItemSheet` 与新的 `TodoSwitchSheet` 共用 `SwitchModeSeg`；
  待办场景（会改写一条正在计时的记录）额外给一次确认，换事项场景（选完还要挑事项）不给。
- `mobileTimerActions.startTodo(target, mode)` 改造：空闲仍**整条交给后端** `todo_start`
  （匹配 / 新建 / 软删待办都在 Rust，前端不重写第二套规则）；非 idle 走「先切换、
  **成功了**才软删待办」，顺序反了就会出现「待办没了、时间也没记到这条上」。
  三个动作（`switchTo` / `startTodo` / `createAndSwitch`）由 `void` 改为返回 `boolean`，
  调用方据此决定删不删待办。
- 同名事项匹配**与后端 `repositories/item.rs:22-33` 的 `find_by_name` 三条口径全对齐**：
  `name = ? COLLATE BINARY` ≡ `===`；`deleted_at IS NULL`（**归档也算命中**，故用
  `itemApi.list({ includeArchived: true })`）；`ORDER BY id ASC LIMIT 1`（同名多条取**最小 id**）。
  **不得改回 `useItemStore.items`**——那是选择器口径（不含归档、按 `is_pinned/sort_order` 排序），
  拿它匹配会让 idle（走后端）与非 idle（走前端）两条路径选出不同事项，正好造出同名两条，
  破坏 `todo_start.rs` 写明的不变量。这份带归档的列表只用于本次匹配、不写回 store。
- 连点锁用 `useRef` 且**只放在 idle 分支内**：`useState` 读到的是本次 render 的闭包快照，
  两次点击落在同一 commit 时 DOM 上挂的还是旧 handler，锁会被绕过；而把锁提到 `startTodo`
  首行则会误伤「非 idle 弹选单」这条不发命令的路径（sheet 不弹、notice 不弹，界面零反馈）。
- `TodoRowMobile.onStart` 改为**可选**（`undefined` = 该行没有「开始」这个动作），
  已完成区不传；`active` 时同槽位渲染静态标记（`role="status"`），不再是可点按钮。

**契约与门禁**

- **契约零变化**：命令 **67** / 事件 **11** / 错误码 **16**，`check:contract` 输出
  `67/67/67/67 · 16/16 · 11/11`；DB schema 不变。本轮未新增任何 IPC 命令与事件——
  新面板 `todoSwitch` 是 `mobileUiStore` 的纯本地 Sheet 载荷，不走 IPC。
  （本子节记的是**写入时**的 `check:contract` 输出；同段落开篇那句「命令 65」是
  V1.0-Android（T2–T5）批次完成时的快照，两者不同源。65 → 67 的变动来自改名与数据迁移任务
  ——新增 `get_migration_info` / `open_legacy_dir` 两条迁移期命令——**不由本轮引入**，
  故原行按历史记录保留。）
- `npm run check`：typecheck / contract / size / version / layers / lint 全绿（单文件 ≤300 行，
  CSS 只用 `var(--*)`，本轮只新增一条 `.m-todo__live` 规则）。
- `npm test`：vitest 41 个文件全绿（本轮功能新增 **29** 条，分布在
  `services/mobileTimerActions.test.ts`（11）、`components/mobile/TodoRowMobile.test.tsx`（6）、
  `ItemsPage.todoStart.test.tsx`（6）、`ItemsPage.guard.test.tsx`（3）、
  `TodoSwitchSheet.test.tsx`（3）；QA 的 `TodoStartEdges*.test.tsx` 属走查验收集、
  会随轮次增补，故总数不写死）。

**已知边界（不美化）**

| 边界 | 说明 |
|---|---|
| pause 后切换失败无补偿 | running + 「结束并新开」时先 `pause`，若随后 `switch_item` 失败，秒表停在**暂停态**且不自动恢复。**此行为本轮之前就存在**（桌面 `useTimerActions.startOrSwitch` 同模式），修它需先定「失败后该恢复还是保持暂停」的产品口径，两端一起改 |
| 切换失败可能留下孤儿事项 | `createAndSwitch` 建事项成功但切换失败时，会留下一条同名事项。**可自愈**（重试按名字命中，不会二次新建） |
| 两条同名待办无法区分 | 「计时中」判定是标题匹配，两条同名待办会**同时**显示标记、且两行都没有「开始」按钮。根治需把 todo→item 做成真绑定（数据模型变更），未在本轮 |
| 标记播报不一定生效 | `role="status"` 挂在随内容一起新建的节点上，live region 需「先存在后变更」才会播报，部分 TalkBack / VoiceOver 版本可能不读。静态文本本身可读 |
| 安卓包未构建 | 本机无 Android SDK / NDK / JDK，本轮**未产出 APK、未做真机验证**。验收来自 vitest 全量用例（41 个文件）与代码审查，不含真机手感 |

（全前端改动：未触碰任何 `.rs`，故未跑 cargo 相关门禁。）

### 依赖与入口（T2）

- `Cargo.toml`：`tauri` 的 `tray-icon` / `image-png` / `image-ico` 与 `autostart` /
  `window-state` / `single-instance` 三个插件移入
  `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`。
  这些 crate 在 Android 无实现，留在通用段必然链接失败。
- `lib.rs`：`run()` 加 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`（Android 靠它找入口）；
  插件链拆两段，桌面独占三个插件与 `.on_window_event()` 用 `#[cfg(desktop)]` 门控。
- 新增 `platform/host.rs`：`OS` 常量 + `desktop_only(cmd)`（统一造 `IO_ERROR`，不新增错误码）。
- 新增 `platform/duration.rs`：`format_duration` 从 `infra::tray_menu` 提出——倒计时**通知**正文
  也要用它，而托盘模块要整块门控；`tray_menu` 保留 `pub use` 维持调用点与测试路径不变。

### 桌面模块门控（T3）

- `infra`：`autostart` / `geometry` / `tray_menu` / `window` / `window_note` / `window_rect` /
  `window_spec` 模块级 `#[cfg(desktop)]`。
- `app`：`tray` / `diagnostics` 门控；`bootstrap` 的托盘、启动钳制、诊断快照、`monitor` 与
  `md_sync` 调度按平台分段，移动端补 `boot_timing::mark("mobile_skip_desktop")`。
- `jobs::monitor` / `jobs::md_sync` 门控；`services::timer::tray_snapshot` 与
  `models::timer::TraySnapshot` 随托盘一起只在桌面编译。
- `app::events`：`tray::sync_status` 收成本地 `sync_tray()`，移动端空实现（**连快照查询都不做**）。
- `lib.rs` 加 `#![cfg_attr(mobile, allow(dead_code))]`：md-sync 整域、错误码闭集等在两平台共用
  源码但在移动端无触发点，逐个模块分叉比留一条「暂时用不到」的代码更糟。

### 命令层移动桩（T4）

- `commands/mod.rs` 用 `#[path]` 换文件，模块名/函数名不变 → `lib.rs` 的 65 条注册一字未改。
- 新增 `commands/{system,window,md_sync}_cmd_mobile.rs`：
  - `show/hide/toggle_window`、`save_window_position` → `Ok(())` 幂等空操作（前端首帧与拖动收尾会调）；
  - `main_work_area` / `main_window_rect` / `quit_app` / 5 条 `open_*` / `close_note_window` → `IO_ERROR`；
  - 4 条 `md_sync_*` → `IO_ERROR`「移动端暂不支持 Markdown 同步」。
- `settings_cmd.rs`：自启收成 `autostart_enabled()` / `set_autostart_enabled()` 一对，
  桌面读写注册表、移动端恒 `false`（`Settings.autostartEnabled` 字段保留，契约不变）。
- `note_cmd.rs`：便利贴置顶只推窗口层级（桌面），移动端只落列值。

### 移动端配置与通知（T5）

- `capabilities/default.json` 加 `"platforms": ["windows","macOS","linux"]`（Android 上
  `autostart:allow-*` 不存在，不隔离会让 `tauri android build` 的权限校验失败）。
- 新增 `capabilities/mobile.json`：`platforms: ["android","iOS"]`，窗口只留显隐/定位/读尺寸、
  事件 `listen/emit`、`notification:default`。
- 新增 `tauri.android.conf.json`：窗口改为不透明、有装饰、不置顶、不上任务栏、**可见**，
  去掉 WebView2 专用 `additionalBrowserArgs` 与桌面药丸尺寸。
- `AndroidManifest.xml` 加 `POST_NOTIFICATIONS`；`infra/notify.rs` 在 Android 启动时建
  单通道 `timer-reminder`「计时提醒」并让所有通知显式指向它（API 26+ 无通道即丢通知）。
- `gen/android` 的 `compileSdk` 由 CLI 默认的 **37** 降到 **36**、`targetSdk` 用 **35**：
  `tauri-android` / `tauri-plugin-notification` 的 AAR 元数据要求 compileSdk ≥ 36，
  而 targetSdk 才是运行时行为开关，按设计口径留 35；`minSdk 24` 不变。
- `gradle-wrapper.properties` 的 `distributionUrl` 换腾讯镜像（`services.gradle.org` 的 307
  会跳到 GitHub Releases，本机不可达）。

### 本机环境绕行（出包路径与设计 §9 的差异，都是环境限制）

| 现象 | 绕行 |
|---|---|
| `tauri android build` 把 `.so` **符号链接**进 `app/src/main/jniLibs` 时报「Creation symbolic link is not allowed」（本机未开开发者模式 / 无 SeCreateSymbolicLinkPrivilege） | 改为 `cargo build --lib --target aarch64-linux-android` + 硬链接 `.so` 到 jniLibs + 复制 `dist` 到 `assets` + `gradlew assembleArm64Debug -x rustBuildArm64Debug -x rustBuildUniversalDebug`。**产物与 CLI 路径等价**，只是踩过了那一步 |
| Gradle 分发与 AGP 依赖从境外源只有几 KB/s（AGP 9 + Kotlin 2.2 首次解析要几百 MB） | 分发走腾讯镜像；依赖解析用临时 init script 指向 maven.aliyun.com（`~/.gradle` 与本机临时文件，不入仓库） |
| 只装了 `aarch64` / `x86_64` 两个 rust-std，`armv7` / `i686` 下载被镜像 403 | 只出 `--target aarch64`（arm64-v8a）单 ABI APK；universal / 32 位需先补 rust-std |

### 验收

- 桌面：`cargo test` **338 passed / 0 failed**；`cargo clippy --all-targets -- -D warnings` 通过；
  `cargo fmt --check` 通过；`npm run typecheck` / `check:contract` 通过。
- Android：`cargo check --lib --target aarch64-linux-android` 通过（0 warning）。
- 出包：`src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`
  （debug · arm64-v8a），含 `lib/arm64-v8a/libtickbar_lib.so`、`classes*.dex`、
  `assets/index.html`、`assets/assets/index-*.js`（已确认打到移动分支：含 `m-shell`）。
  体积偏大是 debug 未 strip 的 183 MB `.so` 所致，release 会 LTO + strip。

### 本轮没做

- 前台服务 / 后台保活（PRD Q3）：进程被冻结时到点通知会延迟，数据由幂等补判保证正确。
- md-sync / SAF（PRD Q2）：4 条命令保留注册但返回不支持，设置页在移动端隐藏「同步」页签。
- 真机验证（无设备）：触摸、通知权限弹窗、返回键层级、后台冻结行为全部未实测。

## [0.4.1] - 2026-11-02

### 归档到 `261102-Timing` + 构建层优化

**本轮零业务改动、零契约改动**：命令仍 65、事件仍 11、错误码仍 16，
`src/` 与 `src-tauri/src/` 一行未改；改的只有构建配置、依赖声明与文档。

- **整包归档（含 `src-tauri/target`）**：从 `261017-Tickbar` 原样搬入 `261102-Timing`，
  源码 13605 个文件、`node_modules` 12754 个、`target` 24232 个文件，逐文件核对零缺失。
  上一轮归档把 `target` 排除在外，导致新目录必须从零编译（本机实测一次冷编要几十分钟）；
  这次连编译产物一起搬，`cargo build` 换路径后只重跑了少数 build script，**34.5 秒**即完成。
- **Vite 分包**：业务 + React + 图标库原先挤在单个 `index` 425.29 kB（gzip 129.95）chunk 里，
  现在拆成 `react` 210.92 / `index` 180.17 / `icons` 17.67 / `vendor` 16.16 / runtime 0.59。
  业务代码只占 180 kB（gzip 53.59），改动不再连带整包换 hash。
  注意 Vite 8（rolldown）的 `manualChunks` **只接受函数形式**，传对象会报
  `Expected Function but received Object`。
- **运行时依赖钉死**：`@tauri-apps/plugin-autostart` / `plugin-dialog` / `plugin-window-state` /
  `zustand` 由 `^x.y.z` 改为精确版本（等于当前实际安装版本）。本工程是离线可复现的桌面应用，
  `^` 只会在别人机器上悄悄换版；devDependencies 仍保留 `^`（靠 lock 兜底）。
- **版本号 0.4.0 → 0.4.1**：六处同步由 `npm run check:version` 断言。

门禁：`npm run check` 全绿（契约 65/65/65/65 · 16/16 · 11/11/emit 11；size 377；version 0.4.1；
layers 341）· `npm test` 245 · `npm run build` 通过 · `cargo test` 见 `更新日志.md`。

## [未发布]

### 可观测性与数据安全补强（评估后优化）

来源：`docs/reviews/2026-10-25-V0.4.0-ASSESSMENT.md`。**不改业务逻辑、不动 IPC 契约**
（命令仍 65、事件 11、错误码 16），只补「出事了能不能查」和「数据能不能救回来」。

- **前端运行时兜底**：新增 `components/ui/AppErrorBoundary`。此前主窗渲染期抛错会卸载整棵树，
  用户看到的是「透明窗里药丸凭空消失」，而错误发生在 WebView 内、Rust 侧零记录。现在渲染异常
  会落在一个**能点的**兜底卡片上（原因 + 重新加载），渲染之外的异常（事件回调 / 未处理 Promise）
  走 `NoticeBar` 提示，不再静默。
- **错误统一收口 + 日志分级**：在 `impl Serialize for AppError` 埋点——这是 65 条命令的 Err
  回到前端的唯一收口。`DB_ERROR` / `IO_ERROR` 记 `ERROR`，业务校验类记 `DEBUG`（此前
  `log_error!` 全项目 0 次使用，真故障与良性告警同级）。
- **关键业务事件埋点**：`timer start` / `timer switch` / `timer stop: saved` /
  `timer stop: discarded` / `md import <kind>` / `md write <path>`。真机日志此前一次运行
  只有 2 行，用户报「计时丢了」无法复盘。
- **Markdown 写前留底**：新增 `infra/md_backup`。`md-sync` 覆写用户日记前把原内容存到
  `<app_data>/backups/md/`（**不写进用户 vault**，不在 Obsidian 里堆 `.bak`），保留 30 份、
  按时间淘汰；空内容不备份、失败静默。原子写只防「半个区块」，不防「写错区块」。
- **文档漂移修正**：`error.rs` 的 `ErrorCode` 文档头写「共 15」，实际 16 个
  （V0.4.0 新增 `MD_SYNC_CONFIG_INVALID` 后未同步）。
- **测试**：后端 334 → **338**（新增 4 条 md_backup 单测）；前端维持 245。门禁全绿。

## [0.4.0] - 2026-10-20

### 第一个插件 `md-sync` + 插件 API v2

用户口径：「为该软件制作第一个插件，同时完善该软件的插件系统；插件名称 md-sync」。
落地为一个**真实可用**的声明式 v2 插件，而不是示例占位。

- **插件 API v2**：`PLUGIN_API_VERSION = 2`，新增 `contributes.mdSync` 贡献点。
  插件只声明落点（kind / enabled / root / file / heading），文件读写与冲突判定全在
  Rust 宿主侧；仍不执行任何插件代码（ADR-033）。
- **`plugins/md-sync`**：默认落点
  `%USERPROFILE%\OneDrive\应用\remotely-save\Elio\1-MemeX\Diary\{date}.md`，
  计时写 `#### 事项计时`（Planner 兼容 YAML log），便利贴写 `#### 便利贴`（三列表格 +
  隐藏 `<!-- tb-note:ID -->`）。
- **SQL → Markdown**：计时按事项分组、按时间排序；便利贴按更新时间排序；只替换目标标题
  下的区块，日记其他内容不动。
- **Markdown → SQL**：改时间 / 删组 / 增删改便利贴行都会写回数据库；导入后刷新事项、
  计时、记录、待办、便利贴窗口。
- **双向判定**：文件与内存基线、SQL 与基线分别比较；两边同时改时按「文件 mtime vs
  最大 `updated_at`」最后写入者胜；文件 / 标题不存在时只导出不导入。
- **设置 → 同步**：新增第 4 个页签。总开关、每种数据一张卡；根目录「选择…」调原生
  文件夹选择，文件模板与标题可改；「保存并同步」立即跑一轮；「立即同步」只读现有配置；
  每张卡显示最近方向 / 时间 / 错误原因，并可打开今日文件。
- **后台轮询**：`jobs::md_sync` 每 2 秒 tick；只有真的导入数据时才 emit
  `md-sync:changed`，空轮询不打扰前端。
- **契约增量**：命令 61 → **65**（`md_sync_get` / `md_sync_save` / `md_sync_run` /
  `md_sync_open`）、事件 10 → **11**（`md-sync:changed`）、错误码 15 → **16**
  （`MD_SYNC_CONFIG_INVALID`）。无数据库迁移，配置存 `settings` KV
  `plugin.md-sync.config`。
- **权限**：只新增 `dialog:allow-open`（选目录），不引入 `fs` 读写能力；前端仍不直连
  SQL / 文件。
- **测试**：后端 274 条、前端 210 条全绿。md-sync 覆盖导出 / 改时间 / 删组 / 便利贴往返 /
  缺文件不写空 / 非法配置错误码；`check:contract` 输出 65 命令 / 11 事件 / 16 错误码。

已知取舍：冲突是「最后写入者胜」而非逐行合并；同一段落两边同时改会丢一侧（ADR-033）。

## [Unreleased]

### 变更 · 事项菜单点行开始计时 / 强制退出可选补时 / 记录按连续性分行（ADR-035）

用户口径（一次三条）：
「在事项菜单点击事项 可以直接开始计时」「对于被强制退出的事项，可选择退出期间是否并入计时」
「同一事项若时间不连续，则分行记录，若时间连续则合并记录」。

- **点记录行 = 开始这一条事项**：事项窗「今日计时」的只读行整行可点（`Enter` 等价），
  编辑态不可点、行内按钮 / 输入框不算点行。口径收敛在 `useTimerActions.startOrSwitch`：
  空闲开始 → 正在计别的先暂停冻结累计再分段 → 就是当前这条则跑着不动、暂停着继续。
  右键菜单首项随之随状态切换（原来非当前会话只有一条恒禁用的「停止计时」）。
- **修掉「运行中换事项点了没反应」**：后端 `switch(end_and_start)` 有「会话在跑就报
  `TIMER_ALREADY_RUNNING`」的守卫，而 `ItemMenu` / `CommonItems` 原本直接调它——运行中切换
  一直只得到错误提示。三处入口一并改走 `startOrSwitch`（暂停 → 分段两跳）。
- **强制退出可选并入退出期间**：`resolve_open_record` 新增可选 `includeGap`（默认 false，
  R-2 不变）。为真时把 `running_since → 结束/现在` 的空档补进累计；暂停中崩溃、墙钟回拨、
  `discard` 一律不补。恢复对话框在空档 ≥ 1 分钟时给出「把退出期间（xx）也计入」勾选项，
  摘要行实时显示「已计时 → 计入后」。
- **记录行按连续性分行**：`lib/todayGroups.ts` 在「按事项 id 合并」之上再按连续性切段——
  同一事项相邻记录间隔 ≤ 60s 才并成一行，否则另起一行（上午 / 下午两段不再被拉成
  `09:00–14:15 · 45 分钟`）。行 key 改 `grp-{itemId}-{firstId}`（旧的 `grp-{name}` 拆分后撞 key）。
- **不改日记**：`#### 事项计时` 仍按事项合一个 Planner 任务，多段 `log` 分开写；
  合并连续段会破坏渲染 ↔ 解析的往返配对（ADR-035 §C）。
- **测试**：后端新增 `tests/timer_recover_gap.rs`（6 条，四种组合 + 暂停 / 显式 endAt / discard）；
  前端补 `lib/recoverGap.test.ts`（6 条）、`todayGroups` 连续性 4 条、记录行点击 3 条。

### 变更 · 图标重做：应用图标 + 独立的托盘图标（`scripts/gen-icon.py`）

用户口径：「任务栏和桌面图标太丑了，能不能优化一下，尽可能贴近现在的设计」。

- **旧图标**：一张黄铜径向渐变 + 深色圆心的位图，直接等比缩到 32px；通知区 16px 下
  是一团糊开的铜色圆圈，也和界面的深色玻璃 + `--accent` 蓝没有关系。
- **新图标**：超椭圆底板（n=4，同 `--ring-radius` 的超椭圆口径）+ 开口计时环
  （就是小条左侧那枚 `--ring-size` 环）+ 12 点刻度点。色值全部取自设计令牌：
  环 `#98CDF6 → #3885C9`（`--accent` 两端）、刻度 `--warn #E8A33D`（旧图标里唯一
  被记住的颜色）、底板 `#1B1F27 → #0A0B0E`（深色主题底）、发丝描边白 10%（`--line-2`）。
  纯平面、不投影，遵循 V0.2.10「去除整体阴影」。
- **逐尺寸分级**（`GRADES`）：<32px 去掉 1px 级的刻度点、环身加粗 0.098 → 0.140、
  开口 300° → 310°，否则小尺寸必然糊成一团。
- **`.ico` 自建 9 档**（16/20/24/32/40/48/64/128/256；256 存 PNG，其余 32bpp BMP），
  不再让 CLI 从单张 master 缩放——分级比例必须逐尺寸给，缩放做不到。
- **托盘图标独立** `icons/tray.png`（32×32，无底板、环更粗、开口更小），
  `app/tray.rs` 用 `include_bytes!` 内嵌，解码失败退回窗口图标。任务栏通知区只有
  16–24px，带底板的版本在那里只剩一个深色方块。
- **可复现**：`python scripts/gen-icon.py` 重出全部尺寸，`--lab` 出深/浅底色 × 各档
  尺寸的对比图；本仓库不再需要「设计师给一张图」。
- 桌面快捷方式（`TickBar 调试版.lnk`）本来就指向 `src-tauri/icons/icon.ico`，
  改完即生效；Windows 若仍显示旧图，是图标缓存没刷（见 `docs/design/BRAND-ICON.md`）。

### 变更 · 事项窗口待办区改为显示「全部未完成」，时间列区分逾期 / 未来日期（ADR-034）

用户口径：「在事项组件右键唤起的事项菜单，待办事项区应保存为规定时间及规定在以后完成的
待办事项」；追问确认「右侧显示逾期；对于未来的任务，显示日期」。

- **旧行为**：`lib/todoToday.ts` 的 `filterToday` 把待办区限制成「今天 + 未排期」（ADR-032），
  明天 / 下周的待办在面板里**完全看不到** —— 设了未来计划等于凭空消失。
- **新行为**：待办区 = **全部未完成**（今天 + 以后 + 已逾期 + 未排期），计数与空态跟着变；
  切分在 `lib/todoPanelLists.ts`。**已完成只留「今天完成的」**（`doneAt >= 今天 00:00`）：
  已完成是逐日累积的历史，全量铺进 252px 面板会把真正要做的待办挤出去；昨天的完成记录
  仍在库里，要看全量改这一处过滤即可。
- **时间列文案分级**（`lib/todoTimeLabel.ts`）：逾期 → `逾期`；不在今天 → `MM-DD`
  （跨年 `YY-MM-DD`，如 `27-01-05`）；在今天 → `HH:MM`；两项时间都没设 → 留白。
  完整时间 `YYYY-MM-DD HH:MM` 一律放 `title`，hover 可查。逾期仍只判 `planned_at < now`，
  与 `pendingTone` 共用 `isTodoOverdue`（两处各写一遍必然漂移）。
- **清理**：删除 `lib/todoToday.ts` / `todoToday.test.ts`（全仓无其它引用）；
  删掉 `TodosPendingRow.todoTimeText`；`.todo-pend__time` 的 `min-width` 34 → 40px
  兜住 `MM-DD` 与「逾期」（无新色值，逾期色仍走 `--todo-overdue`）。
- **不变**：md-sync 的 `#### 待办事项` 区块仍是「未完成 + 计划时间不在今天」（那是日记归档口径，
  与面板两套过滤器）；后端与 IPC 契约零改动。
- **测试**：新增 `lib/todoTimeLabel.test.ts`（13 条）、`lib/todoPanelLists.test.ts`（4 条，
  含「明天的待办必须在列表里」）、`components/todos/TodosPanel.test.tsx`（2 条，面板级）；
  `TodosPendingRow.test.tsx` 的时间列断言改成文案 + `title`。前端 **233** 条全绿。

### 新增 · 第三种同步落点「待办事项」+ 按天归日口径收紧

用户口径：「md 存储时注意只存储当日的记录；对于待办事项可以存在日记的待办事项标题下，
待办事项存储的是计划在未来完成的内容」。

- **新落点 `todos`**（`MdSyncKind::Todos`）：`plugins/md-sync` 增加 `#### 待办事项`，
  写「未完成、且计划时间不在今天」的待办。格式
  `- [ ] 标题 · 计划 2026-10-21 09:00 <!-- tb-todo:12 -->`；逾期写 `· 逾期 <时间>`，
  未排期不带后缀。种类扩展**不升 `apiVersion`**：`bindings` 的 schema 没变，不声明
  `todos` 的插件完全不受影响。
- **反向写回**：`- [x]` → `done_at`（下一轮从区块退场）；改标题或 `· 计划 <时间>` →
  `title` / `planned_at`；没有 id 的行 → 新建待办。**这一节从不删数据**：它是过滤视图
  （排除今天要执行的、排除已完成的），「文件里没有」可能只是计划时间落进了今天，
  按「缺失即删除」会在跨天那一秒把整批待办删光。
- **便利贴改成只写当天相关的**（当天创建、或当天改过）。旧实现把全部便利贴写进每一天，
  昨天贴的便条天天跟着出现，换一篇日记就换一份副本。现在今天的日记只承载今天动过的，
  没动过的留在它自己那天的文件里。代价：`file` 模板不带 `{date}` 时跨天会看到区块变成
  当天的内容（过滤结果，不是数据丢失）——已写进 spec 与 `repo::notes_in_day` 注释。
- **计时区块**沿用按 `started_at` 归日，本次未改；`duration:` 与实时段的既有语义也不变。
- **设置页**：落点卡、文件夹选择弹窗、插件页贡献点摘要统一读 `MD_SYNC_KIND_LABELS`，
  以前三处各写一个三元表达式，加第三种时漏一处就会显示错种类名。
- **升级兼容（不修这条，功能只对新装用户可用）**：`config::load` 从「保存值整体优先」
  改成「保存值优先 + **按 kind 补齐**」。v0.4.0 用户保存过的配置里只有 timers/notes，
  而设置页只渲染 `config.bindings`、没有「添加落点」入口——不补的话 `todos` 永远进不了
  生效配置，待办区块一次也不会被写出来（QA 实测复现）。用户改过的根目录 / 文件模板 /
  标题、以及主动禁用（`enabled: false`）的落点一律原样保留，不会被默认值复活。
- **前端刷新**：`md-sync:changed` 带 `todos` 时重拉待办列表（主窗启动钩子与待办窗口）。
- **测试隔离（本轮真实事故，务必保留）**：插件扫描的 dev 源（仓库 `plugins/md-sync`）
  优先于测试写在 `app_data` 下的插件，所以「只保存了部分落点」的用例经合并后会拿到仓库
  里声明的真实路径（作者的 OneDrive 日记目录），一次 `md_sync::run` 就把空库内容写进
  真实日记。修法：`tests::md_sync::env` 预先把三种 kind 都锁到临时目录，`save_binding`
  从「整体替换」改成「按 kind 就地替换」。修完跑全量测试，目标文件 mtime 逐值不变。
- **测试**：后端 **328** 条全绿（原 306 + 新增 22：`md_sync_notes`／`md_sync_todos`／
  `md_sync_upgrade` 共 8 条，其余为独立回归用例 `md_sync_edges`／`md_sync_notes_guard`／
  `md_sync_todo_export`／`md_sync_todo_import`／`md_sync_todo_edit`）；前端 218 条全绿；
  `check` / `clippy -D warnings` / `fmt --check` / `build` 全过。
- **拆文件**（单文件 ≤300 行硬约束）：新增 `repositories/md_sync_todo.rs`、
  `import/todos.rs`、`format/todos.rs`、`tests/md_sync_notes.rs`、`tests/md_sync_todos.rs`、
  `tests/md_sync_upgrade.rs` 与 5 个回归用例文件；`services::md_sync::mod.rs` 正好 300 行，
  所以把种类分发的 `match` 下沉到 `export::by_kind` / `import::by_kind`，`mod.rs` 反而短了。

### 修复 · 进行中的计时不出现在「事项计时」区块（V0.4.1）

用户口径：「新插件（md-sync）无法完成同步」→ 实际现场：`#### 便利贴` 有数据、
`#### 事项计时` 为空，库里今天 0 条 `saved`、1 条 `active`。根因是**导出链路上两处
`status='saved'` 过滤**，把正在计时的会话彻底挡掉了（不是文件读写问题）：

- `repositories::md_sync::records_for_day` 的 SQL 写死 `WHERE r.status = 'saved'`；
- `services::md_sync::export::timers` 里 `let Some(end_ms) = row.ended_at else { continue }`。

修复与配套取舍：

- **进行中的记录上屏**：新增 `repositories::md_sync::active_record_in_day`（独立函数，
  不往 `records_for_day` 加开关——导入侧必须只看到 `saved` 行），导出按
  「开始时刻 → 当前时刻」渲染成实时段。
- **实时段带 `ongoing: true` 标记**，导入侧按「是不是宿主写出的坐标」判定（见下面 P2）。
  没有它，那个「当前时刻」的假 `end` 会在用户编辑文件时被当成真实结束时间写回库，
  改写 active 记录的累计时长（甚至插出一条重复的 saved 记录）。
- **写盘频率收到整分钟**：轮询每 2s 一轮，秒级 `end` 等于每 2 秒重写整篇日记
  （Obsidian 不停重载、OneDrive 反复上传）。实时段 `end` 对齐到整分钟后，同一分钟内
  渲染文本完全一致，`body` 比较不触发写盘，肉眼仍是实时（最多落后 59s）。会话开始
  不足 1 分钟时不上屏（避免写未来时刻/零长度段）。
- **冲突判定不吃实时段**：`latest_record_update` 仍只统计 `saved` 行。active 行每 15s
  被 `flush_active` 推进一次 `updated_at`，若算进来会让冲突永远判给数据库侧，
  把用户刚写进文件的内容覆盖掉。
- **暂停中的会话也不消失**：用「已计到的位置」（`started_at + accumulated_sec`）当
  `end`，冻结不动；完全不画会让用户以为同步又坏了。

**返工（QA 回归发现的两条数据丢失路径）**：

- **P1 · 删除改成基线驱动**（既有缺陷，`import::apply_timers`）：原实现
  `db.iter().skip(intervals.len())` 是**按数量截断**，与同函数内「整组消失」判定
  （只删基线里有的 `started_at`）语义打架。实测丢数据：今日 1 条 saved（09:00–09:30）
  + 1 条 active（10:00 起），同步一轮后用户点停止并在 1.2s 内把文件里的 09:30 改成
  09:35，再同步一轮 → 刚停止的那条被写入 `deleted_at`，文件侧也已重渲染成 1 段，
  两个方向都无迹可寻。现在统一成一条规则：只有 `old_starts.contains(started_at) &&
  !new_starts.contains(started_at)` 且本轮没被「第 N 段」认领过的行才软删
  （`(事项, 开始时刻)` 是唯一键；整组消失 = `new_starts` 为空）。刚停止的会话在基线里
  还是实时段、被剔掉后不在 `old_starts` 中 → 不会被删。
  逻辑搬到 `services/md_sync/import/timers.rs`（import.rs 181 行 / timers.rs 253 行）。
- **P3 · 对位改成「精确匹配优先 + 索引兜底」**（P1 的 `paired` 豁免暴露出的缺陷）：
  P1 里「本轮被认领过就不删」的豁免本身是必要的（用户改某段 `start` 时，库里那行的旧
  `started_at` 已不代表现状），但它让**按索引对位的写错行**也被保护了。实测：库内 2 行
  `[09:00, 10:00]`，用户删掉第一段只留第二段 → 索引把「第 2 段」写到第一行上、两行
  `started_at` 撞车、且没有 delete；下一轮 `file == expected` 命中短路，**永不修复**。
  现在先按 `started_at` 精确匹配认领行，配不上的才按顺序兜底（`claim_rows`，同文件），
  于是「删首段 / 删中段」各自认回自己的行、被删的那行落进未认领集合被正常删除。
- **P2 · 用户手写 `ongoing: true` 不再静默删记录**（本轮护栏）：原实现见标记就剔段，
  该事项在新区块里整组消失 → 走删除分支。现在构造 `trusted` 坐标集合
  （`(事项名, 开始时刻)`），两个来源取并集：**(a)** 基线（剔段之前）里带 `ongoing` 的段
  ——覆盖「上一轮刚写出、这一轮用户恰好停止」；**(b)** `active_record_in_day` 的当前
  active 行——覆盖「基线为空」（进程重启后首轮）。命中才剔；未命中把 `ongoing` 降级为
  普通段，时间照常入库。`format::strip_ongoing` 已删除，语义只剩一套
  （`drop_placeholders`）。
- **测试**：`tests/md_sync_live.rs` 覆盖 ①active 被导出且 end 是当前时刻 ②停止后
  saved 接管、同一段不重复 ③导入不会把假 `end` 写回库（不多记录、不改 active 行）
  ④同一分钟内渲染文本完全一致、跨分钟才变 ⑤暂停中的会话冻结可见；
  `tests/md_sync_live_guard.rs` 覆盖 ⑥停止 + 同一 tick 内改文件后存活行数不变、
  用户改的时间入库 ⑦手写标记在唯一段 / 多段末段都不软删 ⑧基线为空时按 active 行
  识别占位段；`tests/md_sync_pairing.rs` 覆盖 ⑨删首段 ⑩删中段（两者都断言存活行数、
  `started_at` 无重复、文件里同一段只渲染一次）。`tests/md_sync_format.rs` 是 format.rs
  原单测（渲染/解析/标记往返）。
  后端 293 条全绿，其中 md-sync 相关 32 条（集成 6 / live 5 / guard 4 / pairing 2 /
  format 5 / time 3 / notes 5 / import 2）。
- **文档**：`docs/plugin-spec.md` §5 补实时段格式、`ongoing: true` 双语义、删除口径、
  以及「刚停止的 ≤2s 窗口内最后写入者判给数据库侧」这条如实说明。

已知限制：计时按 `started_at` 归日，昨天 23:00 开始、现在仍在跑的会话不会出现在今天的
区块里（裁剪到今日 0 点会让它停止后从今天的文件里消失，比看不到更糟）；实时段只表达
「墙钟跨度」，暂停时长在段落里看不出来（停止后由 saved 记录的真实起止接管）；点停止后
的 ≤2s 窗口内若又编辑文件，该次编辑会被一次导出覆盖（last-writer-wins 的固有取舍）。

### 新增 · 日记里同时写出「真实计时时长」（`duration:`）

用户口径：「为什么时长不对 我没理解」。现场：日记里那段是 `09:18:33 → 14:40:48`
（墙钟 5 小时 22 分），而 TickBar 界面显示 46 分钟，两者差 4 小时 36 分。

**两个数都没错，量的是两件事**：`started_at` / `ended_at` 是墙钟跨度，
`accumulated_sec` 才是真实累计。分叉是设计如此——应用关闭、电脑休眠期间不累计
（`timer::resolve_open` 的 R-2「不补算崩溃间隙」）。当天日志实证：`09:45:15`(v0.3.0)
之后直接跳到 `14:17:54`(v0.4.0)，中间 4 小时 32 分没有任何进程。

问题出在导出侧：Planner 的 log 段只有 `start` / `end`，`accumulated_sec` 被整个丢掉，
读日记的人只能把墙钟跨度当工作时长。现在每段多写一行 `duration:`：

- `services/md_sync/format/time.rs`：`format_duration`（`1h34m20s` / `46m06s` / `45s`）
  与宽松逆解析 `parse_duration`（也认纯数字按秒、大小写混写）。
- `format::TimerInterval` 加 `duration_sec: Option<i64>` 与 `with_duration`；
  `render_timers` 在 `end:` 之后写这一行，`parse_timers` 读回（只认紧跟 `end:` 的那一段，
  不影响 `ongoing:` 的定位）。
- `export::timers_at`：saved 段用库里的 `accumulated_sec`；实时段用
  `floor_to_minute(accumulated + 已流逝)`，**与 `end` 同粒度**——秒级会让这一行每 15 秒
  变一次，把「同一分钟内不写盘」打掉。
- **导入完全无视它**：`format::strip_durations` 在 `apply_timers` 解析后立刻剥掉，
  `old == new` 的早退不会被「用户手改 duration」误触发；落库的 `accumulated_sec` 仍由
  `(start, end)` 反推（既有语义，见 spec §5）。
- Planner 忽略未知键，它的时间线视图不受影响。
- **测试**：`tests/md_sync_duration.rs` 5 条（真实累计与墙钟并列可见、实时段同分钟逐字节
  相同而跨分钟才变、带 `duration` 的 render→parse 往返、只改 `duration` 不落库、
  文件里谎报的 `duration` 不会成为累计值）+ `format/time.rs` 2 条往返用例。
  后端 293 → **300 条**全绿。
- **文档**：`docs/plugin-spec.md` §5 新增「墙钟跨度 ≠ 真实时长」小节与样例。

已知限制：`duration` 只是展示——Planner 自己的统计仍按 `start`/`end` 算墙钟跨度。
要让第三方视图也准确，得把暂停 / 中断切成多段导入，而数据库目前没有存暂停区间。

### 过期待办自动删除（V0.3.15）

用户口径：「过期待办自动删除」。落地为**跨天清理**（与「只显示今天」同一条自然日边界）：

- `jobs::nudge` 每 15s 调 `services::todo::purge_overdue(pool, 今天 00:00)`，把
  **截止时间早于今天 00:00 且未完成**的待办批量**软删除**（`deleted_at`，行还在库里）。
- 只看 `planned_at`：没有截止时间的待办不会过期；已完成的不清；只有开始时间的不算过期。
- 为什么不是「一到点就删」：上一版刚把过期做成「降透明度 + 横线」的可见样式，一到点就删就白做了 ——
  **今天之内继续淡化展示，跨天自动清掉**。
- 触发：跨零点后 15s 内；应用关着的话下次启动第一次 tick 补齐（关一周再开，一次清完）。
- 零契约改动（无新命令 / 事件 / 错误码），前端零改动（面板本来就只显示今天）。
- 后端测试 244 条全绿（新增 `tests/todo_purge.rs` 2 条：只清过去的、改期到今天的不清、幂等）。

### 待办只显示今天 + 过期降透明度加横线（V0.3.14）

用户口径：「待办事项内仅显示今天事项  过期事项透明度降低且有一条横线表示过期」。

- **只显示今天**：任一时刻（开始 `remind_at` / 截止 `planned_at`）落在今天的待办才出现在待办区；
  两个时刻都没有的未排期待办仍显示（隐藏等于让它彻底消失）。规则在 `lib/todoToday.ts`（5 条单测）。
- **计数与空态跟着变**：「待办事项 · N」「已完成 · N」只数今天的；空态 = 今日记录与今日待办都为空。
- **过期样式**：整行 `opacity: 0.62` + 名字一道 `--todo-overdue` 横线（原来是红色文字，太抢眼）。
- 前端测试 210 条全绿。

### 编辑事项改成「就地打字」（V0.3.13）

用户口径：「编辑的方式是错误的，应该是直接手打修改的东西即可……点击一个事项名，随后可以删除、
写下其他名字，点击某一事项的开始时间，输入新的时间即可。修改完毕后再次点击编辑事项，结束编辑。」

- **名字**：点一下名字，名字本身变成输入框（自动全选），`Enter` 提交、`Esc` 取消、失焦也算提交；
  空名字被拒时**保持编辑态**并标红，不再弹「编辑条 + 确定 / 取消」。
- **时间**：点开始 / 截止（或计时行的开始 / 结束）就地输入 —— `09:00`、`明天 09:00`、`10-21 09:00`、
  `2026-10-21 09:00` 都认，全角字符先归一；解析不了就报错留原地。**不再弹日历浮层**
  （日历仍服务「新增待办卡」，新建时挑时间更省事）。
- **编辑模式是整体开关**：点「编辑事项」进入，再点一次退出；菜单里的「编辑事项」等价于打开它。
  编辑模式下行点击不再切换提醒（完成仍由行尾圆圈负责）。
- 删除组件 `InlineEditBar` / `TodoTimeChip` / `RecordTimeChip`；新增
  `InlineText` / `TimeTextChip` / `lib/timeInput.ts`（7 条单测）。
- 实测：252 宽面板的编辑态记录行「名字 76 + 时间位 106 + 删除」贴右沿不溢出，行高仍 26。
- 前端测试 203 条全绿（含手打时间往返、空名被拒、结束早于开始被拒）。

### 待办提醒链路 + 到点自动开始 + 记录时刻可改（V0.3.12）

用户四条口径：①「黄色圆点的提醒指的是，在事项开始前 15 分钟，弹窗提醒，是否要修改时间……轻提醒」；
②「待办事项提前五分钟弹出提醒，询问是否在当前事项结束时自动开启待办事项计时，若无事项，在既定时间自动开始计时」；
③「待办事项开始计时后自动挪至计时区，不再在待办区」；④「编辑事项功能开启后，可以修改所有事项的名称和时间，点击哪里就改哪里」。

- **两级提醒**（新增事件 `todo-nudge`，第 10 个事件）：都挂在待办开始时间 `remind_at` 上 ——
  T-15 轻提醒（浮出卡问「要不要改时间」，可推迟 15 分 / 1 小时 / 明天此刻）；
  T-5 自动开始询问（「当前结束后自动开始？」）。复用现有提醒浮出卡，永远只占一张卡。
- **阶段去重**：新增 `todos.remind_stage`（0/1/2，只升不降）；改开始时间会归零并让两级按新时刻重来。
- **抗休眠**：`remind_at + 10min < now` 的待办静默标记为已处理并撤回自动开始，关机一夜不补弹、不贸然起计时。
- **待办退出通用到点提醒**：`reminder-fired` 只发事项；待办的 `remind_at` 是「开始时间」。
- **到点自动开始**：空闲时到点直接开计时；忙碌时用户点「结束后自动开始」→ `auto_start=1`，
  本次会话一结束由 `timer_stop` 钩子顶上（新增列 `todos.auto_start`）。
- **待办 → 计时一次到位**（新增命令 `todo_start`，第 61 个命令）：按标题映射事项（没有就建），
  开始计时并**立刻**把待办移出待办区。
- **记录起止时刻可改**：编辑事项模式下，计时行的两段时刻变成两枚时间位（点开 `DateTimePicker`），
  落库复用既有 `update_record`；改时刻时时长跟着区间走，只改备注时保留原累计。
- 契约：命令 60 → **61**、事件 9 → **10**、错误码 15 不变；迁移 `0004_v0312.sql`（`schema.version = 4`）。
- 测试：后端 +7（`todo_nudge` 7 条、`todo_start` 5 条、记录时长重算 1 条）、前端 +4（计时行编辑态），
  后端 242 条 / 前端 191 条全绿。

### 事项窗口：两节列对齐 + 提醒圆圈 + 编辑事项覆盖计时（V0.3.11）

用户五条口径：①「待办事项时间应显示在对应的开始时间列」；②「编辑事项功能应也能修改计时的事项」；
③「现在计时的事项应按时间显示在计时最后」；④「今日计时后与待办事项后统一，将今日计时后的统计格式改为待办事项的格式」；
⑤「单击待办事项为是否提醒，提醒放在显示总时间的部分，黄色圆圈代表有时间提醒，无色为无提醒」
（追问后确认：**点整行 = 开关提醒，完成改由圆圈承担**）。

- **两节同一套三列网格**：名字 `1fr` / 时间 `auto`（居中）/ 右侧 `1fr`，两节同模板同 gap。
  左右 1fr 等分保证中列中心恒在行的水平中线上（与内容宽度无关）—— 实测两节时间列中心同为 `x=388`，
  待办行时刻现在与计时行「开始时间」**同一列**。
- **提醒圆圈**：行尾 12px 圆圈，`remind_at` 非空 = 黄色实心、为空 = 空心；贴右沿，正好落在表头
  「X 小时 Y 分」那一列下（实测两处右沿同为 `497`）。**点整行 = 开关提醒**（有则清空；没有就借用
  `planned_at`；两个时间都没有则当场弹时间选择器），**点圆圈 = 完成 / 未完成**。
- **编辑事项覆盖两节**：打开底栏「编辑事项」后，计时行名字变改名按钮、行尾出现删除（→ 既有内联确认条，
  记录挂的是事项，保留二次确认）；编辑态隐藏「时长」列 —— 四列时名字只剩 25px（实测），三列后回到 108px。
- **进行中排最后**：`TodosRecords` 先渲染已保存分组（开始时间升序），进行中的会话放最末（时间序上本就在末尾）。
- **表头格式统一**：`今日计时 · N 条` → `今日计时 · N`，与 `待办事项 · N` 一致；右侧总时长保留。
- 键盘：待办行 `Space` 完成 / `R` 开关提醒 / `Enter` 改名 / `Delete` 删除；编辑模式记录行 `Enter` 改名、
  `Delete` 删除确认。
- 零 IPC / 零迁移 / 零错误码；决策见 `docs/decisions/ADR-029.md`，`todos-panel.md` §1/§2/§3.1/§3.2/§3.4/§3.6/§5 同步。
- 测试：`TodosPendingRow.test.tsx` 扩到 14 条（列取值 / 圆圈状态 / 行点击开关提醒 / 借用截止 / 无时刻弹选择器 /
  已完成不动作 / 键盘 / 编辑态），全套 187 条绿。

### 待办「点哪改哪」+ 时间列与计时同格式（V0.3.10 / V0.3.11）

用户口径：①「在事项组件右键唤起事项菜单后，新增待办的逻辑有误」；②「编辑事项时，应可编辑事项时间、名称，
点击哪里可以改变哪里」，追问后澄清为「待办时间写不进去，待办时间应可空置」+「名称 / 开启时间 / 截止时间三项都能点开改」；
③（V0.3.11）「待办事项的显示格式应该和计时一样，没指定时间的右侧空白即可，有开始时间的就按开始显示」。

- **根因（时间"写不进去"）**：`todos.remind_at`（开始时间）自 V0.3.9 加进新增待办卡后，**行上从来没有渲染过它**——
  值其实落库了，但界面只显示 `planned_at`，用户无从确认，也无处再改。两条时间至今没有任何**事后**入口。
- **右列一格时刻，与「今日计时」行同格式**：`remind_at` 有值显示它，否则显示 `planned_at`，都没有就**留白**
  （不再写「未设时间」）；逾期时与名字一起走 `--todo-overdue`。胶囊、铃铛、「已逾期」措辞全部取消，
  铃铛只留计时记录行。
- **编辑模式“点哪改哪”**：底栏「编辑事项」打开后 —— 点**名称**就地改名（行尾铅笔删除，改名面就是名字本身）；
  行上展开成「开始 / 截止」两个可点文字位，各弹一次 `DateTimePicker`、只改自己那一项；行尾只留 `trash`。
  点时间位 `stopPropagation`，不会顺带勾选完成。
- **时间可空置**：未设的那项是淡淡的虚线「+」（点开即可补），设过的可点「清除」改回 `NULL`（`todo_update` 的
  `double_option` → SQL `NULL`）。
- **校验与新增卡同一条**：`planned_at < remind_at` → inline 报「截止时间不能早于开启时间」且不落库；
  被拒时浮层立刻收起，不留与库不一致的草稿。
- **修一个 portal 冒泡真 bug**：`DateTimePicker` 挂 `body` 但 React 事件仍按组件树冒泡，此前「点日历上的某一天」
  会把待办行上的 `onClick`（= 勾选完成）一起触发。现在浮层根节点对 `click / dblclick / contextmenu` 统一
  `stopPropagation`（组件测试抓到，非事后推理）。
- **新增纯函数** `lib/todoTimes.ts`（`todoTimePatch`：把「某行某一项改成 X」翻译成 patch + 校验）与
  `components/todos/TodoTimeChip.tsx`（编辑态时间位 + 浮层锚点取整行）。
- **数据层**：`todoStore.patch(id, patch)`（`rename` 改为走它，行为不变），`todosActions.patch`。
  **零 IPC 改动**（复用 `todo_update`）、零迁移、零错误码。
- 测试：`todoTimes.test.ts` 7 条、`todoStore.test.ts` 5 条、`TodosPendingRow.test.tsx` 9 条、
  `TodosComposeCard.test.tsx` 5 条（时间写入 / 空置 / 顺序校验 / 清除）、`todosActions.test.ts` 4 条（端到端写入读回）。
- 文档：`docs/design/pages-V0.2.0/todos-panel.md` §1 / §3.1 / §3.2 / §3.4.2 / §5 同步；
  决策与根因见 `docs/decisions/ADR-028.md`。

### 摸鱼菜单瘦身 + 常用摸鱼 / 常用事项框（V0.3.9）

用户五条口径：①「其他事项」后的说明文字去掉；② 菜单最下面三条会话操作删掉（鼠标能直接做）；
③ 新增**常用摸鱼管理**（名称 / 时间 / 正计时或倒计时 / 排序）；④ **左键事项名**弹出常用事项框
（最近 5 条 + 右下角管理点）；⑤ 悬浮面板唤出时不要「鼠标还没过去就消失」。

- **常用摸鱼改为应用内置**（`Settings.moyuPresets`，settings KV `moyu.presets`，JSON 数组，
  顺序即菜单顺序）：摸鱼菜单末行「管理常用摸鱼…」进入管理卡，可新增 / 编辑 / 删除 / 上下移。
  出厂三条（上厕所 10 / 摸鱼 25 / 吃饭 60）只在键缺失或 JSON 损坏时兜底，**删光是合法状态**。
  常见边界两端各一份归一化：空名丢弃、名称 40 字截断、分钟钳 1..1440、id 补齐、上限 20 条。
- **正计时条目**：`mode = countup` 时忽略分钟数，直接 `start_timer`；倒计时行右侧显示目标时长。
- **删掉菜单底部的继续 / 结束并保存 / 放弃**：分别由点圆环、右键圆环、记录/事项窗口承担。
- **「其他事项…」去掉 `滚轮定长` 说明位**（表单里已有提示，行上再写一遍是噪音）。
- **常用事项框回归**（V0.3.1 删掉的浮层重做）：计时中 / 暂停态左键事项名 → 置顶事项
  + 最近编辑（`updated_at` 倒序前 N 条）；点一行即切事项（空闲开始，计时中分段切换）。
  右下角小圆点 → 事项管理浮层：置顶开关 / 是否显示最近事项 / 显示 3、5、8、10 条
  （`items.show_recent`、`items.recent_count`，后端钳 1..10）。**契约零改动**，无迁移。
- **悬停收起改为「先移入、再移出 + 1s」**：`useHoverClose` 加 `requireEnter`，自动弹出的
  摸鱼菜单与常用事项框启用；指针必须先进入过浮层，离开后才开始 1000ms 计时。
  其余浮层维持 V0.2.7 行为（420ms，无需先移入）。
- **插件 `quickTimers` 不再驱动摸鱼菜单**（用户口径「都是应用内置功能，非插件」）：
  插件扫描 / 设置页列表保持不动，但菜单只读内置条目。见 `docs/decisions/ADR-026.md`。
- 测试：前端 `moyu.test.ts` 5 → 16 条（归一化 / 排序 / 置顶与最近筛选）；后端新增
  `tests/moyu_settings.rs` 5 条 + `models/moyu.rs` 6 条单测（默认值 / 往返 / 空表 / 归一化 / 钳制）。

#### 修订：两处入口点不开（用户实测报障）

- **「管理常用摸鱼…」点了没反应**：`GlassMenu` 的点击语义写死成「执行 `onSelect` 后立刻
  `onClose`」，而这两行只是把同一张卡换成二级形态（管理卡 / 自定义卡）——`onClose` 把刚挂载的
  二级卡连同整个摸鱼菜单一起卸了。`MenuItemEntry` 新增 `keepOpen`（默认 false，行为不变），
  「其他事项… / 管理常用摸鱼…」两行置 true，由二级卡自己的「返回 / 取消」决定何时回到列表。
- **左键事项名弹不出常用事项框**：`ItemName` 原来只挂 `onClick`。WebView2 在部分输入路径下
  会吞掉 click（该文件此前就为右键记过同类问题），改成 **pointerup 为主、click 兜底**：
  左键 pointerup 位移 ≤ 4px 才当点击（避免拖窗口收尾误开），click 用 400ms 时间戳去重；
  右键逻辑不变。
- **顺带**：`useHoverClose` 加挂载静默期 `MOUNT_GUARD_MS = 320`——浮层出现那一帧 auto-fit 会改
  窗口尺寸，WebView2 偶尔补派一次 `mouseleave`，旧代码会据此提前拉起收起计时（「刚开就没了」）。
  静默期内的 leave 只把等待补足到「静默期结束 + 宽限」，不影响正常移出收起。
- 验证：无头 Chrome + CDP 真实鼠标事件走查——计时中左键事项名出 `.menu--common`；暂停 → 摸鱼菜单
  →「管理常用摸鱼…」出管理卡 →「返回」回列表；「其他事项…」出输入卡 →「取消」回列表；
  指针移入菜单再移出 1.4s 内收起。

#### 修订：空闲态「新建事项」也走常用事项框（已被下一条修订撤回）

用户口径：空闲态左键点「新建事项」时，要唤起**常用事项框**，且框内要有「新建事项…」一行。

- **入口改向**：`PillBar` 空闲态 Zone.Task（`.pill__empty`）的 `onClick` 由 `beginCreate`
  改为 `openCommonItems`——先给「置顶 + 最近编辑」列表挑，挑不到再新建；圆环在无事项时
  仍直接 `beginCreate`（那条路径本来就没有列表可挑）。
- **框内新行**：`CommonItems` 末行加「**新建事项…**」（上方有列表时先画分隔线，空列表则独占一行）。
  点它 = 收起本框 + 回到小条上的内联命名；计时中点它只给「事项已锁定」提示，不进入输入框
  （与 `PillBar.beginCreate` 同一文案、同一拦截口径）。
- **顺带对齐**：空闲态在框里挑事项时，若已用滚轮/菜单设过倒计时档位则直接起倒计时，
  与圆环同一口径（此前只会起正计时）。
- 验证：CDP 真实鼠标事件三态走查——idle 点「新建事项」→ 常用框（置顶 + 最近 + 新建行）→
  点新建出输入框 → 命名回车后 running；paused 点事项名 → 常用框 → 新建 → 回车后切到新事项；
  running 点「新建事项…」→ 只出锁定提示、不弹输入框。vitest 120 passed、`npm run check` 全绿、build 通过。

#### 修订：直达新建保留 + 框内可直接添加 + 管理卡改成「摸鱼式」清单（用户口径）

用户五条口径：① 保留原来「点新建事项直接命名」的直达路径，同时悬浮框里也能直接加；
② 删掉悬浮框里那行「新建事项」；③ 管理卡去掉左侧图标与对勾、开启态改用高亮色，
条数从档位按钮改成「原对号位」的数字输入（默认 5）；④ 常用框里删掉「最近编辑 / 置顶」
这类说明文字；⑤ 常用事项管理参考摸鱼管理，可拖动、新增、设置倒计时。

- **入口**：空闲态「新建事项」恢复为**就地命名的内联输入**（上一版改成先弹框，这次退回）；
  计时中 / 暂停态左键事项名仍弹常用事项框 —— 两条路并存。
- **常用框**：删掉末行「新建事项…」，改为**底部常驻输入框**「添加常用事项…」：回车 =
  新建事项 + 置顶 + 排到置顶组末尾，**框不关、焦点回输入框**（可连续添加）；
  删掉「置顶常用事项 / 最近编辑」两个分组标题，只用分隔线区分；行右侧显示默认倒计时。
- **管理卡重做**：只列已置顶的常用事项；拖动手柄排序（聚焦后 ↑/↓ 也能调，落库重写
  `sort_order`）；底部表单新增 / 编辑（名称 + 默认分钟，**留空 = 正计时**）；
  删除 = 移出常用（取消置顶，事项保留）；「显示最近事项」开 = 高亮色、关 = 常规色
  （不再有图标与对勾），条数改为行内数字输入（默认 5，钳 1..10）。
- **数据**：新增 `Settings.itemsTimers`（settings KV `items.timers`，JSON `{itemId: 分钟}`，
  整表覆盖 + 归一化：itemId > 0、分钟 1..1440）。点带时长的事项 = 按该时长起倒计时；
  计时中则先结束当前再起倒计时。**无表结构变更、无迁移、无新命令**。
- 新增 `lib/commonItems.ts`（归一化 / 取时长 / 写时长 / 列表移动）+ 5 条单测；
  后端 `tests/moyu_settings.rs` 加 1 条（往返 / 越界丢弃 / 清空合法）。
- 验证：CDP 真实鼠标事件走查 —— 空闲点新建直出输入框；暂停态框内输入回车成功新增并清空；
  管理卡新增（30m）/ 拖动换位 / 移出常用 / 编辑改时长全部生效；点带 20m 的行起倒计时
  （小条显示 19:59）。`npm run check` 全绿、vitest **127 passed**、`cargo test --lib`
  **229 passed**、`npm run build` 通过。

#### 修订：空闲态「新建事项」改为弹常用框，输入框与框内功能全保留（用户口径）

用户口径：「新建事项时唤出悬浮菜单事项，应将输入框与悬浮框功能全部保留」。

- **入口改向**：`PillBar` 空闲态 Zone.Task（`.pill__empty`）的 `onClick` 由 `beginCreate`
  改为 `openCommonItems`（锚点仍是小条下沿 +4px）。此前的「点新建 → 直接进内联命名」
  撤回——用户要的是**先出框**，而不是只有列表没有输入。
- **框内两样都留**：① 底部常驻输入框原样保留（回车 = 新建 + 置顶 + 框不关、可连输）；
  ② 置顶行（右侧默认倒计时）/ 最近编辑 / 右下角「事项管理」小圆点全部保留。
- **焦点口径**：空闲态点「新建事项」进来 = 意图是建，挂载后把焦点交给底部输入框
  （`GlassMenu` 会先抢到首个可用行，故下一拍再交还）；计时中 / 暂停态从事项名进来是挑事项，
  焦点仍在行上。
- **勾选位**：空闲态没有会话，行上的当前项回落到 `lastItemId`，不至于一条都不亮。
- **内联命名的去向**：只留给「圆环 + 尚无任何事项」这条没有列表可挑的路径（`beginCreate` 仍在）。
- 验证：无头 Chrome + CDP 真实鼠标事件 —— 空闲点「新建事项」→ `.menu--common` 出（208×145，
  焦点在 `.common-items__input`）；输入「走查新建事项」回车 → 行就地刷新并置顶、框不关、输入清空；
  指针留在小条 1.6s 不收，移入框再移出 1.6s 收起；点首行 → 框关、状态转 running。
  `npm run check` 全绿（60/15/9、287 文件）、vitest **127 passed**、`npm run build` 通过。

#### 修订：新建回到事项组件内联；悬浮框去掉新建与输入框；修「打字时框消失」

用户两条口径：① 在悬浮框里打字时框会消失，要修；② 新建应回到事项组件上直接开（如以前版本），
不要在悬浮框里新建，把框内的新建功能去掉。

- **入口回退**：空闲态「新建事项」格恢复 `beginCreate`——就地长出 `InlineNameEntry`，
  回车建好即开始；上一版「点新建先弹常用框」撤回。
- **悬浮框不再有新建**：底部常驻输入框与其 `submitAdd`（新建 + 置顶 + 焦点回填）整体删除，
  框底只剩右下角「事项管理」小圆点（改为右对齐）；框内也不再自动聚焦任何输入。
- **打字掉框的真因与修法**：`useHoverClose` 的 `leave` 判定加**打字豁免**——焦点在浮层内
  文本控件（`input` / `textarea` / `contenteditable`）且窗口仍有焦点时，`documentElement`
  的 `leave` 不算离开。WebView2 在窗口尺寸变动 / 焦点切换 / IME 候选窗出现时会补派假 leave，
  计时中按「离开了」起算，于是「打字打着框就没了」。真移出一定先走 `pointermove`，
  那条路径照旧起算，不会漏收。
- 验证（CDP 真实鼠标/键盘）：空闲点新建 → 内联输入框（无悬浮框）→ 输入 `walk` 回车 → running；
  暂停后左键事项名 → 悬浮框 `inputs=0`、小圆点仍在；管理卡名称框连续打字 → 管理卡与悬浮框都还在。
  `npm run check` 全绿、`npm run build` 通过。

#### 修订：点事项组件时输入框与常用框**一起弹**（用户口径）

用户澄清：左键点事项组件后，应当是**新建输入框与常用事项框同时出现**；此前几次实现总是
「要么输入框在、要么常用框在」。

- **根因**：`uiStore` 的 `open*` 系列都以 `CLOSED` 铺底，`openCommonItems` 与 `openInlineEdit`
  互相清场，先开的那个必然被后开的顶掉。
- **合成 action**：新增 `openCommonItemsNew(pos)`，一次写入 `commonItemsPos` + `inlineEdit`
  （`itemId: null`）。`PillBar` 空闲态事项组件改调它，于是条上输入框与下方常用框同时出现。
- **焦点**：`GlassMenu` 新增 `autoFocus`（默认 true）。常用框与新建输入框同弹时传 false，
  焦点留在条上的输入框——打字直接生效，不再被菜单挂载抢走。
- **一起收**：回车提交后 `usePillInlineEdit` 同时 `closeInlineEdit` + `closeCommonItems`；
  点框内某行挑事项时 `CommonItems.choose` 先 `closeInlineEdit` 再起计时/切换。
- **打字豁免扩到小条**：`useHoverClose` 的 `isTypingInKeepAlive()` 从「浮层内输入框」扩到
  「小条 + 浮层内的输入框」——两者同弹后在条上输入框里打字，常用框不会被 WebView2 的假
  `leave` 误收。
- 验证（CDP 真实鼠标/键盘）：点事项组件 → `inline:true, popup:true`、焦点 `pill__input`；
  连打 `demo` 1.6s 两者都在；回车 → running/demo 且两者一起收；重开改点框内首行 →
  running/品牌视觉改版 且两者一起收。`npm run check` 全绿（287 文件）、`npm run build` 通过。

#### 修订：最近事项改为框底小胶囊（用户口径）

用户口径：「最近事项形态改为最初版的小胶囊状，尽可能小巧显示」。

- **形态**：最近编辑不再占整行（原来与置顶行同高 30px、带图标与勾选），改为框底一排
  **18px 高的小胶囊**：`--text-cap` 字号、左右 6px、`--radius-full`、自然宽度横排、
  放不下自动换行；当前项 accent 底色，其余 `--bg-field`，hover 提亮，名称过长单行省略
  （`title` 保住全文）。
- **位置**：胶囊与右下角「事项管理」小圆点同一行（圆点贴底对齐），省掉原来的一整行；
  有置顶项时保留一条分隔线，没有置顶时菜单只剩「胶囊 + 圆点」一行高。
- **点选**：点胶囊与点原来那行完全等价（有默认倒计时就按它起倒计时、空闲起正计时、
  计时中分段切换）。胶囊在 `footer` 里、不走 `GlassMenu` 的行渲染，所以自己 `close()` 收框。
- **样式拆分**：新增 `styles/common-items-chips.css`（`common-items.css` 已接近 300 行上限）。
- **置顶行去掉图钉**：`MenuItemEntry.icon` 改为可选，不传就只渲染文字（置顶行不再有行首图标，
  当前项那条 accent 高亮仍保留）；其他菜单（摸鱼 / 倒计时等）照常传图标，表现不变。
- 验证（CDP 真实鼠标）：空闲点事项组件 → 菜单 **191×77**（上一版 208×145）、两个胶囊 18px 高；
  点胶囊 → running / 客户方案评审、框与输入框一起收；注入 6 条（含超长名）→ 菜单 208 宽、
  4 行自动换行、超长省略；只有胶囊时菜单高 36px。
- `npm run check` 全绿（288 文件）、vitest **127 passed**、`npm run build` 通过；无 Rust 改动。

#### 修订：事项窗口（右键事项组件唤出）宽度缩到 3/4

用户口径：「事项菜单栏宽度缩小四分之一 …… 是在事项组件右键点击唤出的菜单」。
（前一轮先把常用事项框误当成目标改到 144px，已撤回——常用框恢复内容自适应。）

- **窗口宽度 336 → 252**（`infra/window_spec.rs` 的 `TODOS`：`width` / `min_width` / `max_width`
  三处同步，仍不可横向缩放；高度区间 [360, 560] 不变）。
- **面板铺满视口**：`todos-panel.css` 的 `.todos` 由 `width: var(--todos-w)` 改为 `width: 100vw`
  —— 窗口多宽面板就多宽；`--todos-w`（336）保留给主窗的今日摘要面板，两者不再耦合。
- **底栏防折行**：窄到 252 后「编辑事项」会折成两行，给底栏两个按钮加
  `white-space: nowrap; min-width: 0`。
- 验证：`Emulation.setDeviceMetricsOverride` 按 252×560 渲染事项窗 —— 表头 / 记录行 /
  待办行 / 底栏全部单行，长事项名正常省略（`todo-row__title` 走 ellipsis）；
  `cargo test --lib` **229 passed**（含 `todos_spec_matches_adr_009` 已改 252）、
  `npm run check` 全绿、vitest **127 passed**、`npm run build` 通过。
- 文档：`ADR-009` 窗口目录、`pages-V0.2.0/todos-panel.md`（4 处）同步为 252（注明原 336）。

#### 修订：事项窗新增待办「打着字窗就没了」

用户口径：「在事项组件右键唤起的事项菜单中，添加待办事项，写入文字时悬浮框消失，修复此 bug」。

- **真因**：事项窗（`todos`）的「指针离开即隐藏」只看 `documentElement` 的
  `pointerleave` / `mouseleave`。WebView2 在 **IME 候选窗弹出**、焦点切换、窗口重绘时会补派
  一次假 leave，旧逻辑当成「人走了」，420ms 后 `hide()`——用户看到的就是「新增待办写着字，
  悬浮窗消失」。这与 V0.3.9 早前修过的「常用事项框打字掉框」同源（`useHoverClose` 已加豁免），
  只是窗口层那条漏了。
- **修法**（`hooks/useWindowLeaveHide.ts`）：leave 分两级豁免——① 焦点在窗内文本控件
  （`input` / `textarea` / `contenteditable`）且窗口仍有焦点；② 输入法**组词期间**
  （`compositionstart` ~ `compositionend`，候选窗开着时窗口焦点可能短暂不稳，只靠 ① 会漏）。
  两种情况都只撤销计时、不隐藏；输入框失焦后照常「离开即隐藏」，切走应用（`hasFocus()` 为假）
  也照常隐藏。
- **顺带修掉同源的第二处**：`TodosPanel` 的窗级 `keydown`（Esc 关窗 / ↑↓ 行导航）原来连输入框
  里的事件一起吃——在「新增待办 / 改名」输入框里按 Esc 会**连窗一起关掉**，按 ↑↓ 会把焦点
  抢到列表行。现在事件源自 `input` / `textarea` / `contenteditable` 时直接放行，按键归输入框自己。
- **测试**：新增 `hooks/useWindowLeaveHide.test.tsx` 7 条（正常移出 / 宽限期内回来 / 未进入过 /
  打字豁免 / 组词豁免 / 失焦后照常隐藏 / 输入框失焦恢复），前端 vitest **127 → 134**。
- 验证（无头 Chrome，252×560）：点「＋新增待办」→ 输入框出现并聚焦 → 输入 `走查待办` →
  派发假 leave 后 0.9s 输入框与窗都在、值未丢、焦点仍在输入框；↑↓ 不再抢焦点；
  输入框内 Esc 只取消这条新增，窗照旧（记录行 6 条不变）。`npm run check` 全绿（289 文件）。

#### 修订：设置两处收敛 + 便利贴归属 + 事项窗待办改版（用户七条口径）

用户的七条：① 调「最短记录时长」时不要高亮；② 设置右上角的关闭删去；③ 查清「默认存在一张便利贴」；
④ 便利贴应默认绑定事项；⑤ 新增待办要像常用摸鱼 / 常用事项那样弹表单，可填开启与截止时间（可不填）；
⑥ 事项窗内悬停事项时，若该事项有便利贴，在事项左侧预览；⑦ 待办行显示与计时行一致，去掉左侧圆点。

- **① 最短记录时长不再高亮**：删掉输入框的 `onFocus → select()`（点进来时整段文字被反白）与
  `.num-field:focus-within` 的强调色描边；控件聚焦不再变色。
- **② 设置去掉右上角 ×**：`SettingsPanel` 标题栏只剩「设置」；关闭走底栏「完成」或 Esc
  （独立设置窗仍是 `decorations:false`，标题栏保留 `data-tauri-drag-region` 可拖）。`.settings__close`
  样式一并删除。
- **③ 默认便利贴的真因**：`app::bootstrap` 最后一步 `jobs::restore_notes::restore_open` 会按
  `notes.is_open=1` 重开「上次没收纳」的便利贴；而 `is_open` 只在点便利贴黄点（收纳）时归零，
  退出应用不清零，于是下次启动它就自己冒出来。**改为启动不恢复**：删掉 `jobs/restore_notes.rs`，
  启动时把 `is_open` 统一归零（`services::note::reset_open`），便利贴一律从清单 / 手柄 / 右键显式打开。
  残留标记也不会再占满「最多同时开 20 张」的额度。
- **④ 便利贴默认绑定事项**：`openNewNote()` 不传 `itemId` 时挂到**当前事项**（计时中会话事项，
  空闲取最近事项）；显式传 `null` 才是「随记」。清单里「写一张新的…」、托盘入口都随之有归属。
- **⑤ 新增待办改成表单卡**（`TodosComposeCard`）：名称 + 可选**开启时间**（→ `remind_at`）与
  **截止时间**（→ `planned_at`）；两个时间都不填 = 未排期无提醒，与旧行为一致；截止早于开启会拦下。
  卡片贴在底栏上方，Esc / × 取消。事项窗不再在列表首行塞内联输入。
- **⑥ 事项窗悬停预览便利贴**：事项窗整体加宽到 **492 = 面板 252 + 左侧 240 透明预览区**
  （`TODOS_PANEL_W` / `TODOS_PREVIEW_INSET`），面板靠右贴住主条原位，窗口整体左移 240
  （`PanelPlacement::BelowMainInset`）；悬停记录行 → 该事项最近更新的便利贴以玻璃卡画在左侧透明区
  （`NotePreview`，portal 到 body 避开 `.todos` 的 overflow/backdrop 裁切），点卡片打开那张便利贴。
  缓存里没有就按事项补拉一次（窗开着时新写的便利贴也能立刻预览）。
- **⑦ 待办行去掉左侧圆点**：`TodoMark` 组件与 `.todo-mark` 样式删除；待办行改成与记录行同构的
  网格（名 / 时刻 / 行尾动作），**整行点击 = 勾选切换**（Space 同），行尾「编辑事项」模式的
  改名 / 删除按钮 `stopPropagation`，不会误触勾选。
- **验证**（无头 Chrome，492×560 事项窗）：面板 252 靠右（left=240）；待办行 0 个圆点标记；
  新增待办卡 234×188、三个字段、名称自动聚焦，填 21:30 后落行为「走查新待办 21:30」；
  记录行右键 →「便利贴…」建贴后悬停该行 → 左侧预览卡（left=8、224 宽）显示事项名与正文。
- **门禁**：`cargo test --lib` **229 passed**、`npm run check` 全绿（294 文件、契约 60/15/9）、
  vitest **137 passed**（新增 `useWindowLeaveHide` 7 条、`notePreview` 3 条）、`npm run build` 通过。
  Rust 侧只动窗口规格与启动装配（`window_spec` / `window` / `bootstrap` / `note` 服务与仓库），契约零变化。
- **决策记录**：七条口径与「492 = 252 面板 + 240 预览区」「截止 → `planned_at` / 开启 →
  `remind_at`」「启动不恢复便利贴」的取舍见 `docs/decisions/ADR-027.md`。

#### 修订：待办时间字段换成自绘选择器（默认今天 / x 天后 / 上午下午）

用户两条：① 新建待办时时间默认在今天，点开日历后下面额外显示「x 天后」；
② 点开日历后可切上午 / 下午，分钟每 5 分钟一档。

原生 `<input type="datetime-local">` 是 Chromium 的原生面板，**加不了自定义提示行**，
中文环境也**固定 24 小时制**（切不了上午 / 下午），`step="300"` 只能约束分钟步进。
因此两个时间字段改为自绘 `DateTimeField` + `DateTimePicker`（样式 `styles/todos-datetime.css`）：

- **默认今天**：打开浮层时停在「今天 + 下一个 5 分钟档」，但**不落值** —— 字段仍是灰字
  `今天（未设）`，没点过就不写 `remind_at` / `planned_at`（「可留空」这条口径保住了）。
- **x 天后**：日历下方一行「今天 / N 天后 / N 天前」，右侧「清除」置空并收起。
- **上午 / 下午 + 5 分钟档**：`上午|下午` 分段 + 小时 1–12 + 分钟 `00,05,…,55`；
  改动即生效（没有「确定」按钮，撤销走「清除」）。
- **读数仍是 24 小时制**（`今天 21:30` / `10月22日 19:45` / 跨年带年份），
  与「今日计时」行同一口径 —— 上午下午是选择习惯，不是读数格式。
- **浮层几何**：`position: fixed` + portal 到 body（`.todos` 有 overflow/backdrop，绝对定位会被裁）；
  宽 = 卡片宽、**右对齐卡片右沿**（对齐字段会顶出 492 宽的窗口）；纵向**贴卡片**而非贴字段 ——
  贴字段会把标题输入框盖住。
- **Esc 只在 document 捕获阶段拦**：按 Esc 时焦点还在字段按钮上，事件不经过浮层，
  只写浮层的 `onKeyDown` 会把卡片和窗口一起关掉（走查时抓到并修掉）。
- **两个字段互斥**：点另一个字段先收前一个浮层（按元素身份判断，不能按 `.dt-field` 类，
  否则会出现两个浮层同时挂着）。
- 纯逻辑归口 `lib/datetime.ts` + `lib/pickerBox.ts`，新增 `datetime.test.ts` **16 条**
  （5 分钟取整 / 日历日差 / 12 小时制往返 / 月历网格 / 浮层贴边与翻边）。
- **走查**（492×560，无头 Chrome + 真实鼠标键盘事件）：浮层 234×239 且全在视口内；
  默认 `2026年10月` + 「今天」+ 下午 7:45 + 分钟 12 档；点 +3 天 → 「3 天后」、
  字段变 `10月22日 19:45`；切上午 → `07:45`；提交后落行「走查日期时间 19:45」；
  Esc 一次只收浮层（卡片在），再 Esc 才收卡片；开着「开启」浮层点「截止」只剩一个浮层。
- **门禁**：`npm run check` 全绿（301 文件、契约 60/15/9、分层 267）、vitest 137 → **153**、
  `npm run build` 通过；Rust 零改动。

### 暂停自动弹出摸鱼菜单（V0.3.8）

用户口径：「暂停瞬间摸鱼菜单未弹出……修改成自动弹出」。

- **原因**：V0.3.1 删除常用事项菜单时，把 Timing 式的「暂停 + 摊开菜单」连招第二步一并砍掉，
  暂停只剩裸翻状态；V0.3.2 上线摸鱼菜单时只接了手动入口（暂停后右键数字 / 点事项名），
  于是「暂停 → 想换件事」变成了两次点击。
- **修改**：连招收进新 hook `usePauseMoyu`（圆环左键 / 数字左键（Zone.Time 委托圆环）/
  Space 三条路径共用同一回调），**双向**：
  暂停方向（running → paused）在 `togglePause` 收口后自动弹出摸鱼菜单，锚点与手动入口同源
  （小条下沿 +4px）；继续方向（paused → running）自动收掉摸鱼菜单——菜单是暂停态的配件，
  环已恢复行进还挂着「换件事」菜单属于状态错位（真实渲染验证时抓到后补上）。
- **失败不骗人**：等 IPC 往返后以 store 真值为准——暂停失败会被 refresh 回 running，
  此时菜单不弹；继续失败同理不误收（不会出现「状态与菜单错位」）。
- **测试**：新增 `usePillKeyboard.test.tsx`（7 条）：running / paused / idle 三方向的
  Space 分派都交给连招回调、repeat 长按不重复、未传回调时向后兼容退回裸 togglePause、
  Enter 分派回归；另有真实浏览器 T0–T3 走查（idle 不弹 / 开始不弹 / 暂停弹 / 继续收）。

### 状态环改为超椭圆（V0.3.7）

用户反馈「不太像小米的弧度感觉，再圆一点」。上一版虽然按小米 logo 的比例取了 31% 圆角，
但形状本子上是**圆角矩形**——直线接四分之一圆弧，切点处曲率从 0 突跳到 1/r，放大看有一道
生硬的接缝；小米 logo 的弧度是**曲率连续**的超椭圆，四边近乎平直、角部缓慢收弯。

- **形状换成超椭圆 `|x/R|ⁿ + |y/R|ⁿ = 1`，取 n = 3**（n=2 是正圆、n→∞ 是正方形）。
  中线口径半边长 R = 6.8（描边 2.4，inset 1.2），路径仍从顶边中点起、顺时针闭合。
- **路径改为运行时生成**（`squirclePoints` + Catmull-Rom 过点转贝塞尔，每象限 8 段 → 整圈 32 段，
  实测最大径向偏差 ≈ 0.01px），不再硬编码一长串坐标。好处是 n 成了唯一旋钮
  （想更圆取 2.6、想更方取 3.4），且单测能把每个采样点代回方程验算——
  旧的硬编码路径「写错一位仍然渲染、门禁全放行」（V0.3.3 曾把切点写成 5.4，四段弧被拉成椭圆）。
- **全状态单一载体（实施中升级的裁决）**：初版只换计时态的形状，实施时发现空环（idle）
  恰恰是用户最常看到的状态，只改计时态会让环在 idle ↔ running 切换时「变脸」
  （超椭圆 ↔ 圆角矩形）。裁决升级为 **idle / ended 也走 SVG 弧，`border` 彻底退场**：
  idle 未待命 = 整周弧无轨；ended = 整周弧 + `data-thick` 描边加粗到 3px（取代原 border 加粗）。
  附带收掉三笔旧账：① 环的粗细只剩 SVG 一处，F2 的 2.00 vs 2.44px（18%）偏差及
  「随系统缩放翻转」从结构上消失；② `::before` 命中区从 19.2×19.2 修正为 24×24
  （border 曾吃掉 4.8px padding box）；③ idle→running 不再有一次「换载体」的瞬间。
- **`--ring-radius` 5px → 5.6px**：border 退场后这个令牌只服务 `::before` 命中区的
  同心外扩取形（SVG 用不到它）。5.6 是超椭圆 n=3 的**视觉等效**：超椭圆外沿（半边长 8）角部内缩
  `8·(1 − 2^(−1/3))·√2 ≈ 2.334px`，圆角矩形内缩 `r·(√2−1)`，反解 r ≈ 5.64。
  两者角部内缩差 0.01px 量级，idle 与计时态切换时看不出接缝。
- **测试**：`ringGeometry.test.ts` 14 → 15 条，几何断言从「四段弧半径 3.8 / 切点 5·11」
  改为「每个曲线点满足超椭圆方程（容差 1%）」「32 段贝塞尔」「极角单调、总转角 2π」
  「45° 方向半径随 n 单调」——圆角矩形会被第一条直接判死。
  `MainButton.test.tsx` 的「idle / ended 不渲染 svg」改为「恒渲染 svg」
  （idle 无轨 / ended 加粗），`data-arc` 断言随属性删除。

### 状态环动画统一（V0.3.6）

一次把「正计时 / 倒计时两种模式的环」收成同一套语义。此前两模式各长各的：底环一套是
CSS `border`、一套是 SVG 轨；暂停一套是 270° 静弧、一套是冻结的进度弧；而倒计时运行时
`data-state` 仍是 `running`，于是被 `.ring[data-state="running"] .ring__arc` 的旋转动画命中——
**递减弧一边缩短一边绕圈，用户读不出剩余量**。本次把弧的「结构、语义、是否行进」三件事
分别钉死，并清掉了 V0.3.3 改 SVG 后遗留的死代码。裁决与备选方案见 `docs/decisions/ADR-024.md`。

- **D6（P0，V0.3.3 的静默回归）正计时环不再被转歪**：旧实现把 `transform: rotate()` 加在
  **整个 `<svg>`** 上，圆形时代无害，但 V0.3.3 换成圆角方形（squircle，**只有 90° 旋转对称**）后
  ① 底轨跟着转 → **整个环歪成歪框**（QA 实测 `matrix(0.752, 0.659)` ≈ 41°）；
  ② 90° 弧段只在 90° 整数倍上与轨道曲率吻合 → **弧浮出轨道**。
  改为 `stroke-dasharray: "25 75"` + `@keyframes ring-march` 把 `stroke-dashoffset` 从 0 推到
  −100：dash 段永远是真实路径的一段，**弧贴着轨道走、track 一个像素都不动**；
  动画落在 bar 上（`[data-spin="true"] .ring__arc-bar`），`.ring__arc` 不再有任何 transform。
  两套 dasharray 口径由 `arcSpec.march` 显式区分（静态 `100` / 行进 `25 75`），
  新增 `ringGeometry.arcDashArray()` 并有单测钉住。机器判据：墨迹包围盒恒 16.0（旋转态 ≈18.5，实测 18.50）。
- **暂停进出统一为瞬时定格（N2）**：`[data-state="paused"] .ring__arc-bar` 把
  `stroke-dashoffset` 从 `transition` 里摘掉、只留颜色过渡。此前正计时 running→paused 是 1 帧
  硬切（90°@任意角 → 270°@0°），倒计时却是 **1s 线性长过去**（70% 弧缓缓长到 75%，剩 20% 时
  从 65.88 长到 25，看起来像进度回退）。改后两边一致：一个 rAF 内定格；倒计时 running 每秒
  tick 的平滑不受影响。
- **已知偏置（刻意保留）**：`stroke-linecap: round` 让 dash 两端各多出 1.2 个归一单位，短弧
  视觉长度有约 **5% 周长的下限**（剩 1% 时肉眼约 6%）。保留它是为了配合「归零整条 bar 不渲染」，
  避免末尾出现「弧先没了、数字还在走」的空窗；若将来要弧长严格等于数值，须改 `linecap: butt`
  并接受端点变平、与行进态圆头不同形。详见 `ADR-024` 的 Consequences。
- **D1（P0）倒计时弧不再动**：是否行进改为**显式** `data-spin` 属性，CSS 只认
  `[data-spin="true"]`（正计时 running 独占），不再用 `[data-state="running"]` 隐式命中。
  倒计时 running 的 `data-spin="false"`，弧只按剩余比例收缩、且 `dasharray: 100`（静态口径）。
- **D2（P1）底环只留一套**：只要有弧，就一律「SVG `ring__arc-track` + `ring__arc-bar`」，
  同时把 `border` 置透明（`data-arc="true"`）。删掉 `surfaces.css` 里 running / paused 那两条
  35% 的 `border-color`，轨道透明度只剩 `ring__arc-track` 的 37% 一处——两套载体在分数 DPI 下
  抗锯齿不同（SVG 走 subpixel、border 走像素对齐），同一个环会看起来差一个号。
- **D3（P1）暂停态统一 270°**：本计时的 270° 静弧与倒计时的冻结进度弧合并为同一种语言
  （warn 色 + 270° + track + 不行进）。倒计时暂停不再显示「停在 63%」的弧。
- **D4（P2）待命态不再误用进行时**：`armedIdle`（时长已选好、尚未开始）改为
  「全周弧 + 全周 track + `--color-running` 系 + `data-spin="false"`」表达**就绪**；
  弧色由 `var(--color-running)` 写死改为 `currentColor`，与轨道同源，
  idle 待命时 `color` 从 `--state-idle` 切到 `--color-running`（新增
  `.ring[data-state="idle"][data-arc="true"]`），不再出现「亮绿弧 + ink 轨道」的分叉。
- **D5（P2）归零不留圆点**：`stroke-linecap: round` 下零长度 dash 会渲染一个直径 2.4 的圆点。
  新增 `ARC_MIN_FRAC = 0.001` 与 `isArcVisible()`，`frac` 低于阈值时 **bar 整条不渲染**
  （track 保留，环不塌）。选「不渲染」而不是「临时切 `linecap: butt`」：后者要在动画中途改
  描边端点形态，一秒一 tick 的过渡里端点会闪一下。
- **结构收口（`lib/ringGeometry.ts`）**：`clampFrac` / `arcDashOffset` / `isArcVisible` 同源，
  `arcDashOffset = 100 × (1 − clampFrac)`；`MainButton.tsx` 的 `arcSpec()` 返回
  `{frac, track, spin}` 并导出 `ARC_RUNNING_FRAC`(90°) / `ARC_PAUSED_FRAC`(270°)，弧长不再是散落的魔数。
- **描边同源 / 动画保留**：track 与 bar 的 `stroke-width` 都是 `var(--ring-stroke)`；
  bar 保留 `stroke-dashoffset var(--dur-tick) linear` 的每秒平滑过渡，track 不加 transition；
  `data-warn` 的 1s blink 仍同时作用于弧与轨道，paused 态仍不切红；未加任何发光 / 渐变 / 阴影。
- **死代码清理**：删除 `tokens/05-typography-rules.css` 里
  `.ring[data-state="running"]{stroke-width:3px}` 与 `.ring[data-state="paused"]{stroke-dasharray:4 3}`——
  `.ring` 是 `<button>`，`stroke-*` 对 HTML 元素无效，这是 V0.3.3「环 = CSS 描边」时代的残留。
- **测试**：新增 `src/components/pill/MainButton.test.tsx`（`createRoot` + `act`，**不用**
  `renderToStaticMarkup`——zustand v5 的 `useSyncExternalStore` 在 SSR 下会读到初始 state），
  覆盖倒计时不动 / 正计时 90° 行进（dasharray `25 75`）/ 两模式暂停 270° / idle 两副面孔 / ended / 归零不画残点；
  `ringGeometry.test.ts` 同步补 `clampFrac` 与 `isArcVisible` 断言。
- **契约无改动**：命令 60 / 事件 9 / 错误码 15 不变，版本号仍为 `0.3.0`。

### 设置面板微调（V0.3.5）

- **不透明度行只留读数**：「文字不透明度」「背景不透明度」两行的百分比后面原本缀着
  「· 小条 / 便利贴」「· 除设置面板」，现在只显示百分比，说明文字删除。
- **高亮颜色并入「配色」卡**：原在「显示」卡单独一行，现在与四个主题色同卡同形制
  （`HighlightColorRow`：色点 + 名称 + 可编辑 hex 胶囊），颜色类设置集中在一处。
  「显示」卡只剩两条不透明度。
- **最短记录时长改手动输入**：滑杆换成数字输入框，单位由「秒」改为大写 **S**，
  「低于此时长不记录」说明删除。失焦或回车提交，输入过程中不写库；空值 / 非数字回退原值，
  越界钳到 5 / 300，其余整数原样保存（不再按 5 秒步进取整）。`Slider` 仍供两条不透明度使用。

### 记录策略与设置精简（V0.3.4）

- **日记模块整体下架**：四条命令（`diary_get_config` / `diary_set_config` / `diary_today` /
  `diary_open_today`）、`DiaryConfig` / `TodayDiary` 两个 DTO、后端三文件
  （`commands/diary_cmd.rs` / `services/diary.rs` / `models/diary.rs`）、设置页「日记」页签
  与那个**零挂载点的死组件** `components/diary/TodayDiaryWindow.tsx` 一并删除。
  **契约再次减量**：命令 64 → **60**（事件 9 / 错误码 15 不变），`check:contract` 输出
  `命令 60 / 60 / 60 / 60`。日记配置从来没有独立表（走 `settings` KV 的 `diary.*` 四行），
  这四行历史数据**保留只读不删**（迁移一律不改，服务层不再读写即无害）。原混装 mock 文件
  `browserMockDiary.ts` 只删日记部分并更名 `browserMockDaily.ts`
  （日状态 / 丢弃计时 / 计时窗三条命令仍在）。
- **「扩展」改名「插件」，且不再展示任何内置功能**：`ExtensionsTab.tsx` → `PluginsTab.tsx`，
  类名 `.ext__*` → `.plg__*`（样式拆到 `settings-plugins.css`，控制单文件行数）；
  删掉「内置快捷计时」整块与 `PluginListResult.builtin` 字段 / `usePluginStore.builtin` 状态
  （`builtin_quick_timers()` 仍作为后端合并底座供摸鱼菜单使用）。没有插件时显示一行
  「还没有安装插件。把插件文件夹放进上面的目录，点「重新加载」即可。」而不是留白。
  **仓库不再随包示例包（推翻 V0.3.2「首次自动创建并写入示例包 `moyu-kit`」的行为）**：
  `plugins/` 只留 `.gitkeep` 占位，`infra/plugin_fs.rs` 的 `SAMPLE_MANIFEST` /
  `SAMPLE_README` / `sample_id_taken()` / 播种块与 `ensure_user_dir` 的写入逻辑全部删除，
  连带那条依赖 `include_str!` 的编译期硬依赖（单测改为内联 JSON 字面量，不再碰磁盘）；
  用户目录首次只建**空目录**，全新安装打开插件页看到的就是上面那条空态文案。
  删的理由是示例包让空态**永远不可达**（一个插件都没装，页面上却有一行 `moyu-kit`），
  与「插件页不展示任何内置功能」直接冲突。已经装到
  `%APPDATA%\com.tickbar.app\plugins\moyu-kit` 的旧副本**不会被代码删除**（宿主不碰用户文件），
  需要清掉请手工删除该文件夹。
- **高亮颜色去掉说明文字**：那一行只留「高亮颜色」+ 色块，「双击托盘图标时，小条按这个
  颜色闪三下」整段删除（文字 / 背景不透明度两行的 hint 保留）。
- **倒计时到点恒结束并保存**：删「倒计时到点自动结束并保存」开关（`Settings.countdownAutoEnd` /
  `KEY_COUNTDOWN_AUTO_END` / `services::settings::countdown_auto_end()` /
  `settingsActions.setCountdownAutoEnd`）。`countdown::tick` 到点直接 `finalize`，
  不再有「仅通知」分支。
- **新增「最短记录时长」**（默认 **30 秒**，设置页可手动输入 5–300 秒）：
  手动结束计时时若累计低于阈值，`services::timer::stop` **不保存**（软删），
  `stop_timer` 返回 `StopResult { record, discarded }`，前端只给一条
  「不足 N 秒，未记录」的中性提示、不展示撤销条。判定收敛在
  `services::timer_stop::should_ignore` 一处，计时中换事项产生的**分段**共用它
  （旧段太短就丢弃，但新会话照常开始，切换不中断）。
  **两条显式保存的路径不受阈值约束**：倒计时到点（`countdown::tick`）与崩溃恢复的
  「结束并保存」（`resolve_open` 的 `Close`）——用户已经明确说要留下，丢掉比多记一条更糟。
  详见 `docs/decisions/ADR-023.md`。
- **去掉短记录「保存 / 丢弃」二选一弹条**：`UndoBar` 只剩一种形态
  （`已记录 <时长> · <事项名>` + 「撤销」），删 `isShort` 判定、`data-short` 属性、
  `handleDiscard` 与 `SHORT_RECORD_SEC`。短会话已由上面的阈值直接忽略，
  留下来的记录有 3 秒撤销兜底——不再问第二次。

### 视觉与设置精简（V0.3.3）

- **状态环改为小米 logo 式圆角方形**：原来是正圆，现在改成「正方形 + 约 31% 圆角半径」的
  squircle 近似（16px 边长取 5px 圆角，与 SVG 描边中线圆角 3.8 + stroke/2 对齐）。弧形进度
  也跟着从 `<circle>` 换成圆角方形路径，`pathLength=100` 归一化——倒计时递减弧、暂停 270°、
  进行中 90° 弧的长度比例都保持不变。路径从顶边中点起笔，所以 CSS 侧去掉了原来把圆环
  起点转 12 点的 `rotate(-90deg)`（整圈转速仍为 3.2s）。收起态圆点（`.dot__ring`）保持圆形：
  它只有 8px，做圆角方形看不出角，反而糊成一团。
- **三行「显示类」设置迁到「外观配色」页签**：文字不透明度 / 背景不透明度 / 高亮颜色原来混在
  「通用」里，和「开机自启」这类行为开关排在一起。现在独立成一张「显示」卡
  （`AppearanceCard.tsx`）挂在配色卡之后，「通用」只剩两个开关。
- **删除「感知壁纸自动提高不透明度」**：它从来没接线过——`opacityEnabled` 写在库里、
  没有任何代码读它，用户拨开关等于什么都没发生。开关、字段、键、命令参数一并删除。
- **窗口恒定置顶，删除「保持窗口置顶」**：主窗一直是 `alwaysOnTop: true`，浮层窗口（设置 /
  事项）却是 `false`，于是"置顶开关"只对主条生效，与用户"浮层应该压在最上面"的直觉相反。
  现在所有窗口固定置顶，开关下架（`set_always_on_top` 命令删除）。
- **全局快捷键整体下架**：`register_shortcut` 从来只返回 `false`（从未注册任何热键），
  UI 里那三行「未注册 + 编辑」的按钮永远是灰的。连同 `infra/shortcuts.rs`、
  `ShortcutAction`、`ShortcutMap`、`shortcut:triggered` 事件、`SHORTCUT_REGISTER_FAILED`
  错误码一起删除。**契约三处数字同步变小**：命令 66 → 64、事件 10 → 9、错误码 16 → 15；
  `check:contract` 的 `EVENT_ALLOWLIST` 随之清空（不再有"特性关闭先留着"的口子）。
  **依赖也已清掉**：`src-tauri/Cargo.toml` 的 optional `tauri-plugin-global-shortcut` 与
  `p1-shortcuts` feature、`package.json` 的 `@tauri-apps/plugin-global-shortcut` 一并移除
  （`package-lock.json` 已刷新，`Cargo.lock` 由下次构建收敛）。
- **环几何从注释搬进代码并加了单测**：`ARC_PATH` 与它的算术（inset / 角半径 / 切点）
  收进 `src/lib/ringGeometry.ts`，配 `ringGeometry.test.ts` 逐段验算——「切点写成 5.4」
  这类错误 tsc / lint / 契约门禁都抓不到，只有人肉验算能发现，现在改数字会被测试拦住。
  顺手修了 `.ring::before` 命中区圆角（24px 盒子上要「半径相加」5 + 4 = 9px，才与 16px
  主环的轮廓等距同心），并删掉全仓零调用的 `setCurrentWindowAlwaysOnTop`（便利贴置顶
  统一由后端 `apply_note_pin` 处理）。
- 数据库里 `ui.always_on_top` / `ui.opacity_enabled` / `shortcut.*` 的历史行**只读不删**：
  迁移文件一律不改，没人再读即无害。决策与替代方案见 `docs/decisions/ADR-022.md`。

### 插件系统 · 内置预设不再是「插件」（V0.3.2）

- **摸鱼菜单的三条出厂预设改成应用内置功能**：原来它以 `builtin-moyu` / 名字「摸鱼基础包」的
  身份混在插件列表里，看起来像一个可以删、可以开目录的插件，实际既没有目录也不能停用。
  现在它只作为合并的底座存在，不再出现在插件列表中；设置 · 扩展页单列一块「内置快捷计时」，
  标注来源为**内置功能**，写清「装插件可按同名项覆盖」。
- **数据契约同步**：`PluginSource` 去掉 `builtin` 变体（只剩 `dev` / `exe` / `user`），
  `PluginListResult` 新增 `builtin: QuickTimer[]` 字段单独承载预设。覆盖优先级不变
  （内置预设 < dev < exe < user）。
- `docs/plugin-spec.md` §5 由「内置包」改为「内置预设」，写明它不是插件。

### 计时状态（V0.3.2）

- **暂停后一瞬间的右键（约 30ms 内）不再被吞**：暂停原本是「等后端返回再刷新状态」，这中间的
  窗口里 `pillState` 还是 `running`，此时右键时间数字落进「计时中」分支（什么都不做）。
  现在 `pause` 先乐观落 `paused` 再发 IPC，失败回滚并刷新；实测暂停后 10–30ms 右键即能开到摸鱼菜单。

### 插件系统（V0.3.2）

- **新增插件模块**：`plugins/` 下一个文件夹 = 一个插件，必须有启动头 **`plugin.json`**。
  插件是**声明式**的——宿主只读启动头，不执行插件代码，所以插件不能拖慢启动、不能触碰数据。
- **三个扫描位置，同 id 先到先得**：`dev`（调试构建的仓库根 `plugins/`）→
  `exe`（exe 同级 `plugins/`，随包分发）→ `user`（`%APPDATA%\com.tickbar.app\plugins`，可写）。
  用户目录首次自动创建并写入示例包 `moyu-kit`。
- **v1 唯一贡献点 `quickTimers`**：往摸鱼菜单加「事项名 + 分钟」。同名事项后加载者覆盖
  （内置 < dev < exe < user），位置不变。
- **新增 IPC**：`plugin_list`（插件快照 + 合并后的菜单项 + 用户目录）与 `plugin_open_dir`；
  载入失败的插件**不隐藏**，带 `error` 返回，由设置页原样展示原因。
- **设置 · 扩展页实装**：插件列表（来源 / 版本 / 贡献项 / 失败原因）、插件目录路径、
  「打开目录」「重新加载」；原「暂无扩展」空态样式整段下线。
- 规格与字段全表见 `docs/plugin-spec.md`。

### 插件系统 · 修复（V0.3.2）

- **同名事项的覆盖顺序不再取决于插件叫什么**：合并原先按「插件列表顺序」落，而那个列表为了好看
  按 `name` 排过序——`A 用户包` 排在 `Z 调试包` 前面，于是调试包反压用户包，用户改了自己的
  插件却不生效。现在先按**来源优先级**（内置 < dev < exe < user）排再合并，位置仍保持首次出现处。
  合并逻辑单独成 `src-tauri/src/services/plugin_merge.rs`（同时守住 300 行上限），带 4 条用例。
- **同 id 多份不再静默丢弃**：后到的一份列成一条「本份被跳过」的记录，原因写明是哪个来源先到
  （「同一 id 已由「开发」来源加载，本份被跳过」），在设置 · 扩展页直接可见——这一条正是
  「我改的文件为什么没生效」的答案。
- **每条插件显示自己读自哪个目录**：`dev` / `exe` / `user` 三处可能出现同名包，列表里补上实际路径，
  排查时不用猜。
- **不再往用户目录种重复示例**：上游（dev / exe）已经提供了同 id 的 `moyu-kit` 时跳过示例写入，
  免得设置页多出一行被跳过的副本。

### 摸鱼菜单（V0.3.2）

- **暂停态新增摸鱼菜单**，两个入口：
  - 右键**时间数字**（原暂停态右键无响应）；
  - **左键点事项名**——沿用 V0.3.1 定下的暂停态语义，但目标从「开事项窗口」改成「开摸鱼菜单」，
    因为暂停时点名字的真实意图是"换件事做"。事项窗口仍由**右键事项名**直达，功能没丢。
- **菜单内容全部来自插件**：内置包兜底「上厕所 10m / 摸鱼 25m / 吃饭 60m」，
  外部插件可追加或按名覆盖；选中即开始，当前会话先结束并落盘（撤销条仍可用）。
- **「其他事项…」两步合一**：先打事项名，再用**鼠标滚轮**定长（1 分钟/格，Shift 为 5 分钟/格，
  ↑↓ 同效），Enter 或「开始」开跑。名称不存在时自动新建同名事项。
- 菜单底部给当前会话操作：继续计时 / 结束并保存 / 放弃这次。

### 删除常用事项（V0.3.1）

- **删除「常用事项」浮层**（`components/panel/CommonItems.tsx` 及 `services/itemsActions.ts`）：
  随之消失的是「固定任务（`items.is_pinned`）+ 最近 5 条派生 + 倒计时预设副标题 + P 键固定」整块能力。
- **入口全部下线**：
  - 小条圆环（运行中）：左键原来「暂停 + 摊开常用事项」，现在**只暂停**；
  - 小条事项名（暂停中）：原来弹常用事项，现在改开**事项窗口**（保留切换任务的入口）；
  - 托盘「编辑固定任务…」菜单项与其 `app:open-common-items` 事件（前端 `IPC_EVENTS.openCommonItems`、
    后端 `APP_OPEN_COMMON_ITEMS` / `ID_OPEN_COMMON_ITEMS`）一并删除。
- `uiStore` 去掉 `commonItemsPos` / `openCommonItems` / `closeCommonItems`；`PinIcon` / `PinOffIcon`
  两个已无引用的图标导出删除。
- **`items.is_pinned` 列保留**（Rust 仓储仍按它排序、`update_item` 仍接受该字段），只是前端不再有任何写入点，
  恒为 0——真要彻底删列需重建表（SQLite 不支持 DROP COLUMN IF EXISTS），另行评估。

### 便利贴落点 · 指针 · 圆点（V0.3.1）

- **便利贴真正落在小条旁**：`mainWindowRect()` 原来走前端 `Window.getByLabel('main')`，
  它内部用 `get_all_windows`，而能力白名单没放行该权限 → 调用被 catch 吞掉 → 落点退回写死的
  `(120,120)`。这就是「提过修改意见但没生效」的根因。改走新 IPC `main_window_rect`
  （Rust 直接读主窗，返回 DIP），左对齐小条、贴下沿 +6px，下方放不下翻到条上方，再按工作区钳制。
- **便利贴内指针恒为默认箭头**：正文聚焦不再切 I-beam、缩放手柄不再切 `nwse-resize`、
  拖动期不再整窗切 grabbing（`html[data-window-dragging]` 规则删除）。文字仍可选中（Shift + 拖动）。
- **删除便利贴右上角白色圆点**（置顶切换）：便利贴恒为置顶（建窗取该行 `is_pinned`），
  只保留红点「删除」与黄点「隐藏」。

### 移除显隐悬浮条 · 新增高亮定位（V0.3.1）

- **托盘菜单删除「显示 / 隐藏」**，设置里的「显示 / 隐藏」快捷键行一并移除；
  托盘图标**单击只显不隐**（保留「小条被关掉后叫回来」的路径），`tray:toggle-visibility`
  事件常量与监听器删除。
- **双击托盘图标 = 高亮定位**：小条按「高亮颜色」闪三下（0.8s × 3，描边画内侧，
  因为窗口按内容贴合、外发光会被裁掉）。
- **高亮颜色可在设置 · 通用里调**：复用已存在的 `timing.highlight_color`
  （`ReferenceSettings.highlightColor`，默认 `#4DA3E8`），无需新增表结构；
  主窗在收到双击事件时现读，改完立刻生效。

### 修复 · 崩溃恢复对话框让主窗「整窗点不动」

- **现象**：崩溃后重开程序，小条上的计时在正常走，但左键、右键全都失灵，窗口还会悄悄涨成一大块。
- **根因**：`.dialog-scrim` 是 `position: absolute; inset: 0`，参考系是**整个布局空间**
  （`--fit-w/--fit-h` = 工作区 2560×1440），而不是真实窗口。ADR-020 之后主窗只有胶囊那么大，
  遮罩里 `place-items: center` 就把对话框摆到了工作区正中（层坐标 1124, 583）——**落在窗口之外，
  用户根本看不见**；而遮罩本身 `pointer-events: auto` 又铺满了窗口内部，把胶囊上的点击全部吃掉。
  同一份看不见的对话框还会被 auto-fit 算进包围盒，把窗口撑到 482×768。
- **修法**：主窗内遮罩改为贴着胶囊下方就地渲染（`inset: auto` + `top: 小条下沿 + 8px`），
  并把 `pointer-events` 交给对话框自己（遮罩 `none`、对话框 `auto`）。窗口按内容自适应会把
  对话框算进去，实测 300×284，三个按钮全部可点。
- 只在主窗生效（`html[data-window="main"]`），设置窗 / 便利贴窗的居中模态行为不变。

### 事项列表显示 / 菜单收窄

- 事项记录行不再显示合并计数后缀（例如 `测试 ×2` 的 `×2`），保留事项名称、时间和时长。
- 事项菜单默认宽度由 148px 收窄至 136px，最大宽度由 224px 调整为 208px。

### 悬浮条与浮层定位 / 菜单收窄

- 事项菜单默认宽度由 160px 收窄至 148px，最大宽度由 248px 调整为 224px；保留长标签省略，避免菜单占用过多横向空间。
- 悬浮条移动时，主窗浮层继续使用同一布局坐标系并随窗口重算包围盒，确保菜单、倒计时卡和其它浮层与悬浮条保持相对位置。

### 悬浮面板 · 贴小条展开 / 翻到上方 / 收窄

- **菜单改贴「小条外沿」展开**：下方放得下就贴下沿（间距 4px），放不下就翻到上方贴条的上沿。
  以前锚点是光标（落在条内部），紧贴展开会盖住小条 20px，条只剩半截。`GlassMenu` 新增可选
  `bar` 锚，主菜单经 `MenuPos.bar` 传入小条上下沿，`PillBar` 的右键与圆环右键共用它。
- **布局上界补上原点**：`BoundsSize` 新增 `x`/`y`（层坐标，主窗通常为负），`computeFitBox`
  的原点钳制从 `[0, 边长)` 改成 `[上界原点, 上界原点 + 边长)`。原来原点硬钳在 0，窗口只能
  向右下长，翻到上方的菜单会被窗口上边缘整块裁掉（实测只剩 120px 的 MIN_MENU_H 残条）。
  `autoFit.test.ts` 补 2 条用例（负原点可生长 / 越界钳回上沿），前端测试 45 → 47。
- **事项菜单收窄**：`--menu-w` 184 → 160px，另加 `--menu-w-max: 248px` 给超长标签兜底；
  6 项标签实测 `scrollWidth` 未溢出。
- **「今日计时」去掉冗余文案**：待办区「预计执行」、已完成区「计划」两个小标签删除
  （`.todo-sec__meta` 规则随之下线），头部「共 1 小时 20 分钟」去掉「共」。

### 界面 · 「今日计时」记录行

- 去掉行首状态圆（`TodoMark` 只保留给待办行），状态改由时长色 + 删除线 + 进行中行左侧
  3px 竖条表达。
- 记录行改三列网格（名字 / 时间 / 时长），时间落在整行水平中线。

### 行为变更 · 事项允许同名（ADR-021）

名称不再是事项的身份，`id` 才是。`create_item` / `update_item` / `unarchive_item` 三处唯一性
校验整体移除，`repositories::item::name_exists` 随之删除（没有第二个调用方）。

- **错误码 17 → 16**：`ITEM_NAME_DUPLICATE` 不再有触发点，从闭集下架（`error.rs` /
  `models.ts::ErrorCode` / `errorText()` 三处同步）。下架与新增一样要走一次契约评审。
- **`ItemPicker` 去掉 duplicate 态**：不再有「已存在同名事项 + 直接使用该事项」的兜底
  按钮，连同失效的 `.inline-error__action` 样式一起删除。
- **「今日计时」改按事项 id 分组**（`src/lib/todayGroups.ts`）：同名不同事项各占一行，
  右键只作用于自己那条；改名前的历史记录仍与主记录并成一行（`nameOf` 取的是当前名字）。
- 新增 `src/lib/todayGroups.test.ts`（7 条），前端测试 38 → 45。

### 破坏性架构变更 · 删除主窗 384×360 固定画布（ADR-020）

主窗从此**没有「地板」**：HTML 根元素就是视口，`.layer` 是 `position: fixed` 的视口置层，
浮层用绝对定位向外长，真实 OS 窗口由 `useWindowAutoFit` 撑到「内容包围盒」。
原先那张写死 384×360 的透明画布（`--window-w` / `--window-h`）连同 `src/lib/canvas.ts` 一并删除。

- **新增 `main_work_area` 命令**（第 63 个）：返回主条所在显示器工作区（DIP）。前端
  `src/lib/fitBounds.ts` 用它把 CSS 令牌 `--fit-w` / `--fit-h` 写成「屏幕多大就多大」，
  替代写死尺寸——跨屏时窗口 `onMoved` 重取，浮层贴边钳制自动跟随。
- **浮动内容不再被画布裁剪**：菜单 / 提醒浮层 / 待办面板 / 今日摘要 / 设置面板的
  `max-height` 全部改用 `var(--fit-h)`，长菜单在屏幕内滚动，而不是被窗口边缘切掉。
- **`check:contract` 现在断 63 命令**（`lib.rs` / `IpcApi` / `ipc.ts` / `browserMock` 四处一致）。
- **贴边钳制改用「层坐标下的工作区」**：`fitBounds()` 返回的 `x/y` 是工作区左上角减窗口左上角
  （通常为负），三个浮层的右/下边界写成 `x + w` / `y + h`；下沿不足时把 `maxHeight` 收到
  「下沿 − y」内部滚动，不再靠 384 画布天然限高。`.layer` 必须有实体尺寸
  （`var(--fit-w)` / `var(--fit-h)`），否则会触发放大小自我坍缩的反馈环。
- **菜单锚点从视口坐标换算成布局坐标**（`fitBounds.clientToLayer`）：`.layer` 被 `translate(-l,-t)`
  平移过，右键 / 键盘唤起的菜单此前稳定偏左上 `(l,t)`（闲置态 6,16px）；现在按光标精确落位。
  同时 `--fit-w/--fit-h` 改 `Math.floor`、`refreshFitBounds()` 并发去重、`onMoved` 重取节流到 160ms，
  首帧等上界就位再测量，消除启动时「胶囊按窄窗口排版 → 自我坍缩 → 再撑开」的一拍。
- 后端单测仍为 195、前端 38（`autoFit.test.ts` 的边界用例由「画布 384×360」改写为「显示器工作区 1440×900」，条数不变）。

## [0.3.0] — 2026-10-18

架构加固轮：按 `docs/reviews/2026-10-18-ARCH-ASSESSMENT.md` 的 P0 / P1 清单逐项落地。
**核心变化是「约束从文档搬进 CI」**——此前 `AGENTS.md` 写的分层、300 行、版本一致、IPC 契约，
全部没有机械检查，实测已不同程度失效。本版把能自动判定的一律变成脚本，并顺手清掉了它们暴露出的真问题。
命令 62 / 事件 10 / 错误码 **17**（本版新增 1），**一次数据库迁移**（v2 → v3，仅加一列）。

### ⚠️ 升级注意

- **升到 0.3.0 说明这是一次结构性变更**（移除两个 Tauri 插件、后端目录重排、新增三道门禁）。
  功能行为不变，但如果你 fork 过本项目并在 `infra/` 下加过代码，需要按 ADR-016 的新分层挪位置。
- 移除 `tauri-plugin-sql` / `tauri-plugin-store` 与对应 capability。**若你的自定义脚本直连过数据库，会失效**（这是有意的，见 ADR-015）。

### 新增 · 五道机械门禁

- **`npm run check:size`**（`scripts/check-size.mjs`）：扫 `src/**` + `src-tauri/src/**`，单文件 >300 行即失败。白名单 `scripts/size-allowlist.json` 每条**必须**带 `owner` + `expires`，到期即红，并会在文件降回 300 行内后提示删除条目。**本轮结束时白名单已清空。**
- **`npm run check:version`**（`scripts/check-version.mjs`）：断言六处版本字段一致（`package.json` / `package-lock.json` ×2 / `Cargo.toml` / `Cargo.lock` / `tauri.conf.json`），终结「人工核对五处」。
- **`npm run check:layers`**（`scripts/check-layers.mjs`）：6 条 grep 规则把分层约定变成断言——`components` 不 `invoke`、`stores` 不碰 `ipc.`、只有 `lib/window.ts` 引 `@tauri-apps/api/window`、`infra` 不 `use crate::services`、`commands` 不 `use crate::repositories`、全库无 `eprintln!`。
- **`scripts/check-contract.mjs` 重写**：在原有命令/错误码之外，新增**事件三方一致**（后端常量 ↔ 前端 `IPC_EVENTS` ↔ emit 点）、**禁止事件名字面量**、**mock 覆盖 62/62**。事件文件位置可迁移（先 `app/events.rs` 再回退 `infra/events.rs`），死常量判定改为「标识符出现 ≥2 次」（纯文本匹配会把 `NOTE_WINDOW_OPENED` 这种间接引用误报）。
- **ESLint + Vitest**：`eslint.config.js`（typescript-eslint recommended + react-hooks，**刻意零风格规则**）、`vitest.config.ts`（jsdom）。仓库此前没有任何前端 lint 或测试配置。
- **CI 重排为三 job**（`.github/workflows/ci.yml`）：`gates`（ubuntu，不编译，~40s 先给结论）/ `frontend`（typecheck + lint + test + build）/ `backend`（test + clippy `-D warnings` + `cargo fmt --check`）。

### 变更 · 后端分层解环（ADR-016）

- **新增 `platform` 叶子层**：`clock`（单调时钟锚点表）/ `log`（分级滚动日志 + panic hook）/ `boot_timing`（冷启动埋点）。只依赖 std + chrono，可以待在依赖图最底部。
- **新增 `app` 装配层**：`events`（读业务状态再广播）/ `tray` / `bootstrap`（composition root，声明启动顺序）/ `diagnostics`。原 `infra/{events,tray,setup,runtime}.rs` 迁入。
- **新增 `jobs` 调度层**：`monitor` / `flusher` / `reminder` / `countdown` / `restore_notes`，每任务一文件，只做「定时 → 调服务 → 发事件」。原 `infra/{monitor,reminder,countdown,note_windows}.rs` 迁入。
- **`infra` 只剩平台适配**：`autostart, db, geometry, migrate, notify, shortcuts, tray_menu, window, window_spec`。
- **依赖环从结构上消失**：`infra → services` 的 grep 结果为 **0**（此前 6 个文件反向依赖，`infra/clock` 是最典型的一处）。不是加 allowlist 遮住，是这条依赖不再存在。

### 新增 · 可观测性

- **文件日志**（`platform/log.rs`，零新增依赖）：`%APPDATA%/TickBar/logs/tickbar-YYYY-MM-DD.log`，按天分文件、保留 7 天、`TICKBAR_LOG` 控级、panic 另写 `panic.log`（`panic = "abort"` + `strip = true` 下这是唯一能拿到的现场）。原 21 处 `eprintln!` 全部替换为 `log_warn!` / `log_error!`。
- **启动诊断快照**（`app/diagnostics.rs`）：`setup` 结束时落一份现场（版本 / 系统 / 日志目录 / 数据库路径与体积 / 显示器 / 窗口可见性），出问题让用户直接发文件。
- **冷启动时序埋点**（`platform/boot_timing.rs`）：`run()` 入口 → 各启动步骤 → 前端首次 `show_window`，每次启动输出一行 trail（`log_ready=… db_ready=… tray_ready=… setup_done=… first_frame=…`），并把样本追加到 `logs/boot-timing.tsv`，日志里给出最近 30 次的 **setup P50/P95** 与 **first_frame P50/P95**。历史文件随日志 7 天清理一起走，启动路径不碰 SQL。

### 变更 · 时间口径（记录 T23）

- **双时钟约定**：落库字段（`started_at` / `ended_at` / `running_since`）用**墙钟**（跨进程重启必须能对齐）；「这次跑了多久」用**单调时钟**（`std::time::Instant` 锚点表），每次折账后重新锚定。NTP 校时 / 手动改时不再让时长跳变；锚点缺失（重启、测试构造的记录）自动退回纯墙钟差值，行为与 v0.2 一致。
- 期间修掉一个真实竞态：锚点原为单槽，并发场景下会被别的会话清掉；改为按墙钟时刻索引的锚点表（`Vec<WallAnchor>`，上限 8），`clear_anchor(wall_ms)` 只删自己那条，另加 `clear_all_anchors()` 供测试。

### 修复 · 门禁抓到的真问题

- **`app:open-settings` 是死常量**：前端 `IPC_EVENTS` 声明了、`useAppBootstrap` 一直订阅着，后端**从未 emit**（托盘/快捷键直接 `open_settings_window`）。已删除声明与订阅。
- **`browserMock` 缺 8 条命令**（日记域 4 条 + 丢弃计时 + 日状态 2 条 + 便利贴清理）：浏览器 dev 模式下日记与「丢弃本次」走不通。补齐后 mock 覆盖 62/62。
- **`infra/window.rs` 残留 `eprintln!`**：被 L6 规则抓到，改走 `log_warn!`。
- **空闲倒计时每秒查一次库**：`jobs/countdown` 加 `active_hint()` 原子位，无倒计时时 15 个 tick（15s）才做一次权威校验，SQL 频率从 ~1/s 降到 ~1/15s；有倒计时时立即恢复 1s，自愈窗口 ≤15s。

### 变更 · 前端收口

- **IPC 收口**：新增 `src/services/api.ts` 领域门面（`itemApi` / `recordApi` / `todoApi` / `noteApi` / `settingsApi` / `timerApi` / `reminderApi` / `diaryApi` / `windowApi`），7 个组件 + 5 个 store 里的 `ipc.xxx` 全部改为领域调用。`grep "ipc\." src/components` 与 `src/stores` 均为 **0**。
- **窗口平台收口**：`@tauri-apps/api/window` 只在 `src/lib/window.ts` 出现一处，`useWindowAutoFit` / `useNoteGeometry` 改从它引。
- **`useWindowAutoFit` 抽出纯计算内核**：新增 `src/lib/autoFit.ts`（`isRendered` / `unionEdges` / `computeFitBox` / `toCanvasRect` + `DEFAULT_FIT_THRESHOLDS`），hook 只剩「测量 → 交给纯函数 → 落地到 OS 窗口」。21 条用例覆盖遮罩/stack 展开/负偏移/画布上限/阈值/坐标换算。
- **12 条边界改用共享黄金用例**：`tests/fixtures/timer-formula.json` 一份 fixture 同时被 Rust（`include_str!`）与 TS（`resolveJsonModule`）读取，任一端改公式另一端立刻红。

### 变更 · 文件拆分（T12，白名单已清空）

| 文件 | 拆分前 | 拆分后 |
| --- | --- | --- |
| `src/types/domain.ts` | 552 | 门面 8 行 + `types/domain/{constants,models,ipc}.ts` |
| `src/styles/design-tokens.css` | 486 | 索引 30 行 + `styles/tokens/{01-primitives,02-theme-dark,03-theme-light,04-aliases,05-typography-rules}.css` |
| `src-tauri/src/tests/timer.rs` | 347 | `timer.rs` 250 + `timer_todo_link.rs` 87 |
| `src/styles/app.css` | 301 | `app.css` 279 + `utilities.css` 29（`.sr-only` / `.kbd`） |

`design-tokens.css` 的 `@import` **顺序不可调换**：`--input-placeholder` 在 `02-theme-dark` 由 `:root[data-theme="dark"]`（特异性 0,2,0）给出 rgba 白，在 `04-aliases` 由 `:root` 给出 `var(--ink-4)`；顺序一动，深色主题的占位符就会跟着变暗。

### 修复 · 其他

- `computeLiveSec` 负增量钳制为 0（`Date.now() - runningSince` 在被注入未来时间戳时会出现负数，原来会算出负秒）。
- `ItemMenu` 的 `pos` 包进 `useMemo`、补 `status` 依赖；`TodayDiaryWindow.refresh` 包 `useCallback`；`PillBar` 去掉多余依赖并注明原因——三处都是 `react-hooks` 规则报出的真实闭包风险。

### 修复 · 0.3.0 收尾：清空 OPEN-DECISIONS 最后两条（ADR-018 / ADR-019）

架构加固轮结束时，`OPEN-DECISIONS` 还剩 2 条未决——它们分别要动 `ErrorCode` 闭合 union 与 `notes` 表结构，
与分层改造不同源，所以单独走了一次契约 / 迁移评审。本小节即那次评审的结果，**登记册至此清零（OPEN 0 / RESOLVED 11）**。

- **新增第 17 个错误码 `ITEM_NAME_TOO_LONG`（ADR-018）**：此前「文本超长」只能借用 `ITEM_NAME_EMPTY`，
  前端 `errorText()` 会把「标题太长」渲染成「名称不能为空」，表单还会高亮到错误分支。
  现在三个超长检查点（事项名 >60 / 待办标题 >200 / 便利贴正文 >4000）统一用新码，
  构造器收敛为 `AppError::text_too_long(field, max)`。`check:contract` 随之输出 `错误码：17 / 17`。
- **补上后端缺失的事项名长度校验**：前端两处输入框限 60 字，后端此前**不校验**——
  直接调 IPC 能存进任意长名称，而托盘按显示宽度截断，数据与展示会不一致。
  新增 `ITEM_NAME_MAX_LEN = 60`（前端 `ITEM_NAME_MAX_CHARS` 同值）。这是本次唯一的行为收紧：
  超长名字现在会被拒绝而不是静默接受（不做历史数据清理，只在写入路径拒绝）。
- **便利贴置顶持久化（ADR-019）**：加列 `notes.is_pinned INTEGER NOT NULL DEFAULT 1`，
  迁移 `0003_v030.sql` + `ensure_column` 守卫，`schema.version` 2 → **3**。
  建窗按列值决定 `always_on_top`（此前是 `window_spec` 里硬编码 true），
  `note_update` 带 `isPinned` 时落库后立即 `set_always_on_top`。
  默认 1 让老便利贴升级后行为不变。
- **便利贴头补第三枚「置顶点」**：V0.2.1「零文字」重构时把 pin 入口一起删了，
  导致 AC-64 的后半句（可取消 + 持久化）长期无法达成。现为 10px 圆点，
  实心 = 置顶、空心环 = 取消，仍在悬停时才显影，不破坏「只剩正文」的默认观感。
- **文档修复**：`IPC-CONTRACT-v2.md` §2 一直写着「共 11 个，锁定」，从未回写 v0.2.0 的 5 个码；
  现补成 17 个并分段标注版本。同文档附录 A 还留着已删除的 `sql:allow-*` / `store:allow-*`
  capability，一并更正（ADR-015 已移除这两个插件）。
- **测试**：后端 195 项（+5：事项长名校验 3、便利贴置顶 2），前端 38 项（+4：`noteStore` 置顶乐观更新与失败回滚）。

### 已知未做（依赖外部前提，非技术债）

- **自动更新（T19）**：需证书与外网托管 `latest.json`，代码侧未接线。
- **安装包签名（T20）**：需购买代码签名证书；未签名时 SmartScreen 会拦。
- **E2E（T18）**：`tauri-driver` + WebDriver 在单人项目里维护成本高于收益，改为 5 条手测清单（见评估报告 §4）。
- **跨平台**：明确不支持，边界写在 README「运行平台」一节（T21）。

### 并入本版：上一轮加固（原 [Unreleased] 条目，2026-10-18）

> 保留原文措辞以便追溯。其中「版本号五处同步」「`domain.ts` 的 `IpcApi`」等表述已被本版
> 的 `check:version` / `types/domain/*` 取代，参考实现时以上文与 ADR-017 为准。

深度评审后的加固轮：把「文档说一套、代码做一套」变成机器可查，顺手收掉几处并发与越界打开的风险。无新功能、无数据库迁移、无版本号变更。

#### 工程

- **IPC 契约自检**：新增 `scripts/check-contract.mjs` 与 `npm run check:contract`，解析 `lib.rs` 的 `generate_handler!`、`domain.ts` 的 `IpcApi`、`ipc.ts` 的 `call()`/方法名、`error.rs` 的 `as_str`，四处不一致即退出 1。当前 62 命令 / 16 错误码全绿。此前 Spec 写 52、代码 62 的漂移只能靠人眼发现。
- **CI**：新增 `.github/workflows/ci.yml`（windows-latest）：`npm ci` → `typecheck` → `check:contract` → `build` → `cargo test` → `clippy`。仓库此前没有任何自动门禁。
- **文档口径统一**：AGENTS / README 版本改 0.2.10、测试数改 174、命令数改 62；Spec §5 增加「实装增量 10 条」注记；IPC 契约新增 §11 记录这 10 条命令的参数/返回/行为。
- **门禁本机复跑**：装好 VS Build Tools（MSVC 14.44）+ Windows SDK 10.0.26100 后，`cargo test` 174 passed / 0 failed、`cargo clippy --all-targets` 0 warning（清掉 `diary.rs` 两处手写字符比较、`window.rs` 的否定偏序比较），`npm run check`（typecheck + 契约）与 `npm run build` 全绿；桌面端以 devUrl 连 vite 实跑，小条热区与间距肉眼验收。

#### 修复

- **开始计时的并发竞态**：`start` 是「先查 active、再 insert」两步，两个并发请求都可能查到空，第二条 insert 撞 `uq_records_open` 后原样冒泡成 `DB_ERROR`。仓储层新增 `active_conflict()`，把唯一冲突翻译为 `TIMER_ALREADY_RUNNING`，与串行路径同一语义（`src-tauri/src/repositories/record_session.rs`）。
- **结束计时静默成功**：`finalize` / `end_and_start` 的 UPDATE 影响 0 行（会话已被并发结束）时原本照样 commit 并返回 `Ok`。现改为返回 `TIMER_NOT_RUNNING`，事务随之回滚，不再让 UI 以为保存成功。
- **日记打开路径的 shell 二次解释**：`open_today` 原用 `cmd /C start "" <path>`，vault 目录名里的 `&`、引号会被 cmd 重新解析。改为 `canonicalize` + `is_file` 校验后直接 `explorer.exe <argv>`；`set_config` 拒绝 `relativeDir` 中的 `..` 段与 `fileNameFormat` 中的路径分隔符（`src-tauri/src/services/diary.rs`）。
- **提醒卡的叠层**：`openReminderPopover` 是唯一不展开 `CLOSED` 的 `open*`，提醒卡会压在菜单/面板上。现补 `...CLOSED`；`resetTransient` 一并清 `reminderPopover`（窗口失焦后不再残留）。
- **窗口不可见时的自动收缩**：`useWindowAutoFit` 在 `document.hidden` 时跳过测量，并监听 `visibilitychange` 回到可见时再排程，避免最小化期间空跑 `getComputedStyle` 与 `setSize`。

#### 变更

- **PillBar 拆分**：原始行数 323 → 274（回到 300 硬约束内）。滚轮逻辑移到 `src/hooks/usePillWheel.ts`，键盘逻辑移到 `src/hooks/usePillKeyboard.ts`，组件只保留渲染与热区分派。
- **小条间距**：时间数字与事项名之间的净间距由 8px 收到 4px（只在数字之后的元素上抵掉 `--space-1`，环与数字不动），事项名、新建入口、内联输入框与括号手柄整体左移。

## [0.2.10] — 2026-10-17

倒计时手感与可读性这一轮：滚轮就能调倒计时、事项窗贴着主条打开、时长读数换成 h/m，深色主题的文字全部改成纯白。命令 / 事件 / 错误码零变更，零数据库迁移。

### 新增

- **滚轮调倒计时**：空闲时在主条上滚动滚轮，按 5 分钟一档加减（5 分钟 ~ 90 分钟封顶），上滚加、下滚减，起点是「上一次用的倒计时时长」，没有则取参考设置的默认 25 分钟（`src/lib/countdown.ts` 的 `COUNTDOWN_STEP_SEC` / `clampCountdownSec`）。调完即 `armed`，数字直接显示该时长，点左侧圆环开始倒数——不必再进菜单选档位。空闲且已设定时长时，就地命名后**直接起倒计时**（`usePillInlineEdit` 读 `armedSec`），不再回落成正计时。滚轮先按 `WHEEL_NOTCH_PX = 100` 攒够一格才步进：触控板 / 精确滚轮给的是 ±3 这类小 delta，逐事件步进会让一次轻扫连跳好几档。
- **事项窗贴着主条打开**：`open_panel_window` 增加落位策略 `PanelPlacement`，事项窗用 `BelowMain`——读主窗 `outer_position`/`outer_size` 除以 `scale_factor` 得到 DIP，放在主条正下方、左边缘对齐、留 6px（`PANEL_GAP_DIP`）；设置窗与只读计时窗仍居中。窗口已存在时只 `show + set_focus`，一关一开不再「自己跳回屏幕中间」。**坑**：`tauri_plugin_window_state` 的默认 flags 含 `POSITION`，会在建窗后把上次坐标还原、盖掉 builder 里设的位置——故对它 `skip_initial_state("todos")`（`src-tauri/src/lib.rs`）。

### 修复

- **小条底板被窗口边缘削掉**：`useWindowAutoFit` 把窗口收到内容包围盒的**边**，胶囊的圆角与描边正好压在窗口边界上，实测底部像被切平了一刀。新增 `FIT_PAD_PX = 3`，四边各留 3px 余量（窗口 176×32 → 183×39），圆角与描边完整；3px 透明带对点击穿透无影响。
- **未悬停时残留底板 / 整体投影**：上一版为纯白字加过常驻底板与文字暗影，实测在深色壁纸上反而像「糊了一层」。按用户要求改回：未悬停时 `.pill` 背景**全透**（无底、无描边、无投影），悬停 / 聚焦 / 菜单展开才显影 74% 药丸；`--pill-idle-plate` 令牌删除。同时把 `--shadow-pop/plate/float/panel/balloon/ink` 与 `--text-halo` 全设为 `none`（深浅两套主题都改），界面回到纯平面——`--shadow-ring`（0 模糊 1px 描边）与 `--focus-ring` 保留，它们不是投影。

### 变更

- **今日计时读数改用 h/m**：`src/lib/format.ts` 的 `formatMinutes` 改为 `「<1m」` / `「23m」` / `「2h1m」`（整点省略分），表头合计沿用同一函数，写「共 2h1m」；中文口径的 `formatHoursMinutes` 删除。事项窗、桌面今日事项面板同步。
- **深色主题文字一律纯白**：`--ink` / `--ink-2` / `--ink-3` / `--ink-4` 四个令牌全部对齐 `#FFFFFF`，层级感改由字号、字重、留白承担——此前 `--ink-3`（`#8B93A2`）、`--ink-4`（`#7A8292`）把次要信息压成灰字，在透明浮层上读不清。浅色主题不动。
- **纯白字不再挂暗影**：`--text-halo` 已设为 `none`（深浅两套主题），`html, body` 的 `text-shadow` 继承随之失效——文字就是纯色平面，不再有勾边。浅色壁纸上的可读性交回给用户调「玻璃板不透明度」（`--ui-bg-opacity`）。
- **输入占位符不与正文同色**：`--input-placeholder` 在深色主题单独设 `rgba(255,255,255,.62)`（写在 `:root[data-theme]` 里以盖住共享映射的 `var(--ink-4)`），否则「还没写的提示」和「已输入的内容」都是纯白，分不出来。

### 测试

- `cargo test --lib` 174 passed / 0 failed；`npm run typecheck` 0 错。

## [0.2.9] — 2026-10-17

窗口命中与拖动手感这一轮：悬浮面板不再吞掉桌面点击，便利贴整块面板都能拖；顺带把倒计时默认时长和设置页的快捷键展示收成真话。命令 / 事件 / 错误码零变更，零数据库迁移。

### 修复

- **悬浮面板下方的桌面点不动**：`.layer { pointer-events: none }` 只是 CSS 层语义，Linux/macOS 的 WebView 会把它翻译成逐像素命中测试，Windows 的 WebView2 不会——窗口矩形覆盖到哪，鼠标事件就吃到哪。新增 `src/lib/canvas.ts`（`canvasViewport()`）与 `src/hooks/useWindowAutoFit.ts`：把**真实 OS 窗口**收缩到 `.layer` 直接子节点的可见包围盒（每帧采样，变化 ≥2px 才 `setSize`），画布坐标、浮层锚点、`--window-w/h` 全部不动，真正的窗口尺寸上限仍是 384×360。配套：`tauri.conf.json` 主窗 `minWidth/minHeight` 由 384/360 放开到 1/1（否则 Windows 的 `WM_GETMINMAXINFO` 会把 `setSize` 夹回去），capability 增 `core:window:allow-set-size`。为什么不选全局鼠标钩子（`WH_MOUSE_LL`）：要写原生轮询 + 跨进程坐标换算，DPI 与多屏组合下极易漂移，还会拖慢全系统鼠标。决策记录见 `docs/decisions/ADR-014.md`。
- **最后一圈透明带也吃掉**：上一版只按 `right/bottom` 收缩，窗口原点仍是画布原点，于是 `.layer__stack` 的 `--snap-margin`（16px）与 `--pill-inset`（6px）变成窗口左上两条看不见的挡片。`useWindowAutoFit` 改为量四条边：内容在画布内偏移 (L, T) 时窗口位置同步 +（L, T），`.layer` 用 `transform: translate(-L, -T)` 把画布整体挪回窗口原点，裁掉的正好是四周留白，**内容在屏幕上一点不动**；偏移量存 `localStorage` 的 `tickbar:fit-offset`，与 window-state 恢复的窗口位置/尺寸成对还原（否则首帧会跳 16px）。capability 增 `core:window:allow-outer-position`。排版容器（`.layer__stack`）会被递归展开成孩子再量，否则它自己的内边距又把透明带算回来（实测 198×64 → 展开后 176×32）。
- **便利贴只有顶部一条能拖**：新增 `src/hooks/useWindowDragAnywhere.ts`，按下后位移超过 4px 才 `startDragging()`，单击不动；`[data-no-drag]` 子树（右上两枚圆点、右下缩放手柄）永不拖动；`Shift` + 拖动仍可选中文本；拖完紧跟的那次 `click` 会被吞掉，避免误触按钮。
- **拖动时鼠标是「写入」那个 I-beam**：便利贴正文占满整块面板，指针一直是文本光标，拖动时看着像在选字。`.note__input` 默认改回正常箭头（`:focus` 时才给 I-beam），并在跨过拖动阈值时给 `documentElement` 挂 `data-window-dragging`，`html[data-window-dragging] * { cursor: grabbing !important }` 全量覆盖；松手 / 10s 兜底复位。

### 优化

- **倒计时默认时长只有一个口径**：新增 `src/lib/countdown.ts`，默认值统一取参考设置 `default_countdown_minutes`（Timing 默认 25 分钟）。此前小条拿预设档位第一档（5 分钟）当默认、卡片又自己回落 `1500`（25 分钟），同一个动作两处不同答案；`CountdownCard` / `CountdownMenu` 的「自定义…」也一并改口径。`settings.countdownPresets` 只保留为 DTO 字段（九档预设本身对齐参考版，不可配置），不再参与默认值计算。
- **参考设置真正被加载**：`useAppBootstrap` 首帧增加 `reloadReference()`（失败容忍），此前 `settingsStore.referenceSettings` 恒为 `null`，等于接线只接了一半。
- **设置页不再显示假快捷键**：`GeneralTab` 的全局快捷键表改为读 `settings.shortcuts`，未注册就写「未注册」，不再硬编码 `Ctrl+Alt+T / +S / +E / +N` 这些并不存在的键位。
- **时间数字右键直接切倒计时**：对齐 Timing v1.7.3 的 `Zone.Time` 右键（`MainForm.cs` `OnMouseUp` → `ToggleCountdownMode`）——空闲时右键数字一次给齐九档预设 / 输入分秒 / 改为正计时 / 开始倒计时，不再先弹主菜单；计时中右键仍是主菜单。
- **今日计时的同名记录合并成一行**：新增 `src/lib/todayGroups.ts`（`groupTodayRecords`），按**事项名**分组（改名前的历史记录也并），开始取组内最早 `startedAt`、结束取组内最晚 `endedAt`、时长求和，行尾标 `×N`；整列按开始时间升序。行内时间列显示「09:12–09:40」区间（对齐参照版今日计时面板的名字 / 起点 / 止点四列口径）。

### 测试

- 新增 `src-tauri/src/tests/settings_reference.rs`：把 `ReferenceSettingsPatch` 的 17 个字段一次写成非默认值再读回逐项断言（读写两侧的字符串键必须成对），外加「部分 patch 不清空其他键」。

## [0.2.8] — 2026-10-17

浮层身份收尾这一轮：所有浮层窗口都不再出现在任务栏，事项窗也跟随指针离开而隐藏。命令 / 事件 / 错误码零变更，零数据库迁移。

### 新增

- **事项窗指针离开即隐藏**：新增 `src/hooks/useWindowLeaveHide.ts` 与 `WINDOW_LEAVE_HIDE_MS = 420`（`src/lib/constants.ts`），配合 `hideCurrentWindow()`（`src/lib/window.ts`）。在 `documentElement` 上听 `pointerleave` / `mouseleave` 起 420ms 计时，`pointerenter` / `mouseenter` 取消，到点 `hide()`——不销毁窗口，再点「事项窗口」立即原位显示，滚动位置与未提交的编辑都还在。**必须先「进来过」才允许「离开即收」**：窗口刚显示时指针往往不在它上面，否则会收到一个立刻触发的 `pointerleave` 让窗口一闪就没。

### 变更

- **设置窗与事项窗不再上任务栏**：`src-tauri/src/infra/window_spec.rs` 的 `SETTINGS.skip_taskbar` 与 `TODOS.skip_taskbar` 由 `false` 改 `true`（便利贴与主窗本来就是 `true`）。tao 的 `skip_taskbar` 走 `ITaskbarList::DeleteTab`（只能删已存在的按钮），窗口 `show()` 之后外壳可能把按钮加回来，所以 `showCurrentWindowOnReady()`（`src/lib/window.ts`）在显示后再对设置窗 / 事项窗补一次 `setSkipTaskbar(true)`（capability 增 `core:window:allow-set-skip-taskbar`）。至此 TickBar 的所有窗口都只在桌面上出现，任务栏里只留托盘图标。
- **便利贴不受影响**：仍是独立窗口，点圆点隐藏、拖右下角缩放；设置窗也不自动消失（编辑到一半不能丢）。

## [0.2.7] — 2026-10-17

浮层「指针离开即收」这一轮。命令 / 事件 / 错误码零变更，零数据库迁移。

### 新增

- **指针离开浮层自动收起**：新增 `src/hooks/useHoverClose.ts` 与 `HOVER_CLOSE_GRACE_MS = 420`（`src/lib/constants.ts`）。挂在 `GlassMenu`（主菜单 / 事项菜单 / 倒计时菜单 / 常用事项 / 便利贴清单 / 事项窗内行菜单）、`ItemPicker`、`RecordsPanel`、`ReminderPopover`、`CountdownCustom` 上；判定容器为 `.pill, .menu, .panel, .records, .reminder, .note`——指针在这些容器上不计时，离开后 420ms 才收，期间回到任一容器立即取消。
- **便利贴不在其列**：便利贴是独立窗口（`note-{id}`，各有一份文档），结构上不会走到这段逻辑；点圆点隐藏、拖右下角缩放照旧。

### 变更

- 浮层不再「一直挂着等点外部」：从菜单移到桌面、移到别的窗口，浮层都会自己收掉；从小条拖窗（指针离开）时开着的浮层同样收起。
## [0.2.6] — 2026-10-17

悬浮条操作语义 1:1 对齐 Timing v1.7.3 这一轮。命令 / 事件 / 错误码零变更，零数据库迁移。

参照 `D:\101-Workshop\261015-Timing\Timingv1.7.3\src\ElioTimer.Ui\MainForm.cs`：`ZoneOf()`（1717-1738）把条面切成 圆环 / 时间 / 事项 / 手柄 / 空白 五个热区，`OnMouseUp()`（1846-1965）与 `OnRingLeft()`（3948）、`OnRingRight()`、`ToggleCountdownMode()`（4043）、`ShowCommonMenu()`（1975-2050）决定每个区左键/右键做什么。

### 新增

- **五个热区各自的手势**：圆环 / 时间数字 / 事项区 / 便利贴手柄 / 空白处，左键与右键都按参照表分派（`PillBar.tsx`、`MainButton.tsx` 的 `onMenu`、`TimerDisplay.tsx` 的 `onActivate`）。
- **时间数字左键 = 正计时 ⇄ 倒计时**：空闲态点时间切到«倒计时 · 第一档»（浮层提示），再点切回正计时；对位 `ToggleCountdownMode()`。
- **圆环左键计时中 = 先暂停、再摊开常用事项菜单**：对位 `OnRingLeft()` 的 `Pause` + `ShowCommonMenu()`；菜单本身已是 `name · 正计时 / 倒计时 N 分` +「其他事项…」，与参照同构。
- **圆环右键计时中 = 结束并保存**（空闲 = 主菜单）：对位 `OnRingRight()`。
- **主菜单重排**：前段对齐参照 `MenuRows()`（3293-3360）——便利贴清单、事项窗口、切到深色/浅色、设置…、隐藏到托盘；分隔后保留 TickBar 自己的计时动作（开始计时 / 结束并保存 / 倒计时… / 提醒… / 常用事项… / 新建事项… / 便利贴… / 微调开始时间 / 丢弃本次记录 / 保持置顶 / 收起为圆点）。
- **事项区右键 = 展开事项窗口**（参照 `Task → ToggleTodoPanel()`）；事项级菜单仍在窗内逐行给。
- **菜单内部滚动条收敛**：行数超过窗口高度时（主菜单 16 行）不再出现亮灰实心滚动条，改 8px `--line-3` 圆角细条。

### 变更

- `PillBar.handlePointerUp` 的右键兜底归一为「空白处 = 主菜单」，各热区由子组件的 `onMenu` 拦截（不再把右键一律当结束并保存）。

### 修复

- **便利贴聚焦时的蓝色边框**：`app.css` 的通用 `:where(button, input, select, [tabindex]):focus-visible { box-shadow: var(--focus-ring) }` 会给正文输入框套一圈 accent 蓝环，`note.css` 末尾显式清零（`outline: none; box-shadow: none`）。
## [0.2.5] — 2026-10-17

便利贴外形与倒计时口径这一轮。命令 / 事件 / 错误码零变更，零数据库迁移。

### 新增

- **便利贴右下角缩放手柄**：`NoteWindow` 末尾 `.note__resize`（14×14，两道斜纹，悬停现形），按下即 `startResizeDragging('SouthEast')` 交给系统做 nwse 缩放；依赖新增 capability `core:window:allow-start-resize-dragging`，`src/lib/window.ts` 增 `startCurrentWindowResize()`（`ResizeDirection` 在 `@tauri-apps/api` 未导出，故按同构联合重声明 `ResizeDir`）。
- **倒计时「先设定、再开始」**：新增 `src/stores/countdownArm.ts`（`armedSec`，localStorage `tickbar.countdownArm.v1`）。`CountdownMenu` 点档位只**设定**时长（当前档位勾选），另加「开始倒计时」「改为正计时」两行；空闲且已设定时小条直接显示该时长（对位 Timing v1.7.3 的 `TimeText()` / `CountdownMenuRows()`），点圆环才真正开始倒数。

### 变更

- **便利贴圆点移入正文框**：`.note__head` 改绝对定位到 `.note__body` 右上角内侧（`top/right: var(--note-pad)`），不再独占一行高度。
- **便利贴正文框悬停显影**：显影选择器由 `.note:hover` 改为 `.note__body:hover, .note__body:focus-within`，只有鼠标进到文字框里才亮底板、才露出圆点与缩放手柄。
- **小条右键在计时中/暂停一律给事项菜单**：`PillBar.handlePointerUp` 不再把右键直接当「结束并保存」（事项名只有几十像素宽，右键常落在空白处，表现为「右键没菜单」）；结束与保存改为菜单里的显式点选。

## [0.2.4] — 2026-10-17

右键语义与小条手感这一轮。命令 / 事件 / 错误码零变更，零数据库迁移。

### 新增

- **右键时间数字 = 倒计时菜单**：小条里的计时数字右击直接展开时长菜单（预设 + 自定义），不再被当成「结束并保存」。对位 Timing v1.7.3 的 `CountdownMenuRows()`（`MainForm.cs:4083-4120`）与时钟区触发热区（`TimeZoneScreenRect()`）。菜单锚点贴到小条下沿 +4px，不再盖住小条本身。
- **空闲态右键事项区也有事项菜单**：`NewItemEntry` 补上右键处理，空闲时右击「新建事项」同样弹出事项菜单（此前只有运行态的事项名绑了右键）。

### 变更

- **便利贴悬停恢复正文底板**：悬停 / 聚焦时 `.note__body` 浮出玻璃底板（`--note-body-bg`），外层 `.note` 仍保持零边框全透明。
- **长菜单内部滚动**：`.menu` 增加 `max-height: calc(100vh - 16px)` + `overflow-y: auto`，倒计时 8 行以上的菜单在小条 384×360 的窗口里不再被裁掉。

### 修复

- **右键菜单点一下关不掉**：小条窗口只有 384×360，`.menu-scrim` 覆盖不到窗口外的桌面，点到外面事件根本进不来。现监听窗口 `blur`（`src/main.tsx`），失焦即 `resetTransient()` 收起全部浮层。

## [0.2.3] — 2026-10-17

小条的「快捷添加」与「事项级菜单」这一轮。命令 / 事件 / 错误码零变更，零数据库迁移。

### 新增

- **事项菜单（右键事项名）**：`src/components/menu/ItemMenu.tsx`，结构对齐 Timing v1.7.3 的事项行菜单——开始·停止计时 / 编辑事项 / 开·关提醒 ｜ 新建便利贴 / 便利贴清单 ｜ 删除事项（两步确认，走软删除，历史记录保留）。系统事项的「开始计时」「删除事项」置灰。
- **小条内联命名**：`src/components/pill/InlineNameEntry.tsx`，事项名位置直接长出输入框，`Enter` 落地、`Esc` 放弃、失焦即取消；新建后立即开始计时（计时中则结束当前并切换）。
- **完整表单入口回收**：右键菜单新增「新建事项…」→ 原 `ItemPicker` 面板（选颜色等仍在）。

### 变更

- **左键事项 = 快捷添加**：idle 时点「新建事项」、运行中点事项名，都改为就地命名，不再弹出添加工单。
- **小条更靠左**：`.layer__stack` 左内缩由 `--snap-margin`(16px) 改为 `--pill-inset`(6px)，事项名与手柄整体左移 10px。
- **便利贴彻底无底板**：悬停 / 聚焦也不再显影底板与投影，只留文字 + 右上角两枚圆点（圆点仍随悬停出现）。
- **状态管理收敛**：`uiStore` 用一个 `CLOSED` 常量统一清空所有浮层（面板 / 菜单 / 倒计时 / 常用事项 / 便利贴清单 / 事项菜单 / 内联命名），避免新增浮层后漏清导致叠层。

## [0.2.2] — 2026-10-17

悬浮条与便利贴的一轮交互打磨。命令 / 事件 / 错误码零变更，零数据库迁移；`cargo test` 164 绿。

### 新增

- **便利贴清单浮层**：小条右侧手柄右键弹出当前事项的便利贴列表（按更新时间倒序，最多 8 条，空态一行提示，末尾「写一张新的…」）。见 `src/components/note/NotesListPopover.tsx`。
- **设置 · 外观不透明度**：新增「文字不透明度」「背景不透明度」两条滑杆（`src/components/ui/Slider.tsx`）。背景不透明度作用于小条、菜单、面板、快捷条、便利贴，设置面板与托盘菜单不参与；两项为本机偏好（`localStorage`，见 `src/stores/appearanceStore.ts`），不入数据库。
- **便利贴轻量 markdown 列表**：行首 `-` 按空格自动变成 `• `，`Enter` 续行继承缩进与圆点，`Tab` / `Shift+Tab` 对选中行做 2 空格缩进 / 反缩进。文本变换在 `src/lib/noteText.ts`（纯函数）。
- **构建脚本** `scripts/build-release.cmd`：加载 MSVC 环境 → 前端构建 → `cargo clean` + release 构建 → 复制到 `release\TickBar.exe`。

### 变更

- **小条手柄**：由「折叠」改为便利贴入口——左键打开（无则新建）当前事项的便利贴，右键弹出清单；折叠入口移到右键菜单「收起为圆点」。
- **小条拖动**：去掉 `data-tauri-drag-region`，改自绘指针拖动（4px 阈值 + 240ms 吞点击），拖动不再误触按钮。
- **小条排版**：内容由居中改左对齐贴齐；`+` 新建入口与「新建事项」合并为纯文字；计时数字与色环共用中心线、字号 20px → 18px、整体上移 1px。
- **收窄留白**：`--pill-pad-l/r`、事项名内边距压缩，idle 小条宽 188 → 175px。
- **便利贴零文字**：标题、页脚、关联事项、删除确认条全部移除，只剩正文框 + 右上角两枚圆点（红删除 / 黄隐藏）；删除为两步确认（3.5s 内二次点击生效）。
- **透明化**：小条底板与便利贴未悬停时背景全透明（只剩文字/圆点），悬停或聚焦才显影为玻璃板；文字浓淡不再随悬停变化，改由设置里的「文字不透明度」控制。
- **右键**：屏蔽 WebView2 原生右键菜单（捕获阶段 `preventDefault`），自绘菜单照常。

### 修复

- `src-tauri/Cargo.toml` 缺 `custom-protocol` 特性：release 版会去连 `http://localhost:1420` 导致白屏，补后走 `http://tauri.localhost/` 内嵌资源。
- `src/lib/window.ts::currentWindowKind()` 不认 `note` 这个 label（浏览器 dev 用 `?w=note`），便利贴路由落到主条。
- 运行态色环弧比轨道小一圈：`.ring__arc` 由 `inset:0` 改为居中 50% + 负 margin，两环同径同宽。

### 移除

- `src/components/pill/CollapseHandle.tsx`、`src/components/note/NoteConfirm.tsx`。

## [0.2.1] — 2026-10-17

仓库整理与升版。功能面与 0.2.0 一致（零命令 / 事件 / 错误码变更，零数据库迁移）。

### 变更

- **仓库结构**：应用源码从 `Timing_Rustv0.2.0/tickbar/` 平铺到仓库根（`src/`、`src-tauri/`、`package.json` 等），与既有 `docs/agents/` 合并成单一文档树。
- **版本号**：五处同步升到 `0.2.1` —— `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。此前三处填的是占位值 `1.0.0`，与产品版本号（V0.2.0）脱节。
- **文档归档**：v1 阶段文档（`Spec-v1` / `PRD-v1` / `ARCHITECTURE-v1` / `UIUX-v1` / `DESIGN.md` / `design/pages/*` / v1 令牌 / `schema.sql` / `QA-REPORT.md`）移入 `docs/archive/v1/`，现行 v0.2.0 文档留在原位。
- **`.gitignore` 重写**：原文件是 GBK 编码（UTF-8 下为乱码）且规则与布局不符（`**/target/` 未生效、产物路径缺失）。改为 UTF-8，按根布局覆盖 `node_modules/`、`dist/`、`src-tauri/target/`、`src-tauri/gen/schemas/`、`release/*.exe` 等。
- **文档内路径**：`tickbar/src/...` 一类旧前缀统一改为 `src/...`，与平铺后的布局一致。

### 移除（未纳入本仓库）

- `release/TickBar.exe`、`release/TickBar.new.exe`：构建产物；两者字节数相同（6,192,640 B），可重新构建。
- `src-tauri/gen/schemas/*.json`（`acl-manifests` / `desktop-schema` / `windows-schema`，共 375 KB）：Tauri 构建期生成，已入 `.gitignore`。
- `docs/design/_archive/`、`_ac53_*.mjs`、`_contrast_check.py`：一次性自检脚本。
- `.workbuddy/memory/`：团队工作记忆，不属于仓库内容（源目录仍保留）。

### 新增

- `README.md`：项目说明、技术栈、目录、开发 / 打包命令、文档索引。
- `CHANGELOG.md`：本文件。
- `docs/archive/v1/README.md`：归档说明与「归档 → 现行」对照表。

## [0.2.0] — 2026-10-16

批 2「重功能」+ 小条 UI 统一 + Timing 全面对齐优化轮。交付常用事项、倒计时、便利贴、提醒铃四组功能与托盘 IA 扩展；IPC 命令 29 → 52，事件 +6，错误码 +5；零新增迁移（`0002_v020.sql` 已前瞻建好）。QA verdict = PASS，`cargo test` 164 绿。详见 `docs/overview-V0.2.0.md`。
