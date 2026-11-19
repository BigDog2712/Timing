# Timing UI 重构 · Phase 2 体验规范

- 日期：2026-11-19 · 作者：体验（优希）· 状态：待 team-lead 对齐
- 上游：遵循 `UI-REFACTOR-P1-视觉方向.md`（视觉已定稿，本文不改视觉数值）与 `PLAN-20261119-UI重构设计方案.md`（A1–A7 默认采纳）
- 范围：信息架构（功能入口）/ 交互流程（dot·pill·handles）/ 设置菜单重组 / 键盘与无障碍 / 验收清单。**不写代码、不碰视觉数值、不改 IPC。**
- 硬约束继承：13 个 `handleCatalog` id 为持久化键**绝不可改名**（只能改 label、调默认绑定、调分组呈现）；功能完整不可回退；分层 L1–L10、单文件 ≤600 行、IPC 契约不动。

---

## 0. 现状盘点（证据）

**桌面设置的真实归属**（澄清 team-lead 简报里"两处散落"的具体形态）：
- 桌面端设置实际由**分析窗**承载：`activity/features/settings/components/Settings.tsx` 已是一张五组网格（见 `settingsGroups.ts`：计时行为 / 外观与主题 / 悬浮条与把手 / 数据与同步 / 通用与启动；组名已于 B5b `5a4cd29` 按新口径重命名），带左侧 `SettingsGroupNav` 锚点导航。
- `timing/components/settings/*`（GeneralTab / AppearanceCard / ThemePicker / PluginsTab / SwatchRow / HighlightColorRow）当前**只被移动端** `mobile/SettingsPage.tsx` 复用（4 tab：计时/外观/插件/通用）。桌面主窗自己不再直开这组卡。

> 结论修正：设置并非"主窗面板 + 分析窗两套并行"，而是**桌面=分析窗五组、移动端=主窗四 tab 两套实现**，文案/分组口径不一致、且分析窗五组内部仍有深层嵌套与高级/基础混排。P2 的设置重组以**统一这两套的分组心智**为目标，不强行把移动端塞进桌面布局（A6：移动端只继承令牌与分组语义，不做布局重排）。

> **[实测修正 2026-11-19]** 上面两条已逐行核过、成立。补两点：① 五组标题在 B5b（`5a4cd29`，已提交）已改为「计时行为 / 外观与主题 / 悬浮条与把手 / 数据与同步 / 通用与启动」，前三组与 §3.1 提案同序；② "桌面=分析窗"要读成**桌面只有这一套**——`timing/components/settings/*` 在编译期被 `__TIMING_MOBILE__` 分叉掉，桌面产物里不含这组组件（详见 §3.5(3)），所以在桌面设置页里"发现另一份同名实现"时不要急着合并。

## 1. 功能入口信息架构重构

### 1.1 心智模型：三层展开

把所有分散入口归入一条"越往外、越少用；越靠里、越常用"的单轴心智。任何功能只属于一层，禁止同一动作在两层都给入口（当前"结束"既能点数字又能进菜单，就是这种分裂）。

```
L-本体（条本身，0 次展开）—— 看一眼就在、最高频：开始 / 暂停 / 读事项名 / 读计时数字
   ↓ 悬停药丸
L-把手（HandleCluster，1 次悬停露出）—— 次高频、用户自定义：切事项 / 便利贴 / 看今日 / 主界面
   ↓ 点击把手或右键
L-浮层（popover / panel / 独立窗，1 次点击弹出）—— 低频、信息密集：菜单 / 倒计时 / 摸鱼 / 设置 / 记录面板
```

每层的收纳原则：

| 层 | 放什么 | 为什么 | 不放什么 |
|---|---|---|---|
| 条本体 | 计时主控（开始/暂停）、事项名、计时数字 | 常驻可见、零展开即可完成"看+控"最核心回路 | 不放不可逆动作（结束）、不放低频入口 |
| 把手簇 | 用户高频自定义入口（切事项、便利贴、今日、唤出主界面） | 悬停才露，不占视觉重量；槽位可绑定满足个体差异 | 不放"只用一次就走"的配置类（设置本身低频，可留但非默认） |
| 浮层 | 菜单、倒计时/摸鱼、设置、记录/摘要面板、改名编辑态 | 信息密集或需要专注，弹出后独占焦点、Esc 可退 | 不放需要常驻观察的状态 |

### 1.2 "结束"的防误触归位（落实 PLAN A4）

现状"点数字=结束（不可逆）"在最高频的本体层放了一个最危险的动作，违背防错原则。按 A4 默认：**数字区点击 → 展开计时小面板（popover），"结束并保存"按钮在面板内**，并带一次确认语义（P1 的 ended 900ms 闪烁作为结果反馈，不替代确认）。
- `timer.stop` 的 `irreversible: true` 已在数据层标注，UI 必须把它从"单击直达"降级为"面板内带确认的按钮"。
- 把手上仍可绑定 `timer.stop`（高级用户自愿），但出厂默认不绑在单击槽，避免误触。

### 1.3 把手默认绑定调整（不改 id，只调默认 slots 与 label）

现状 `DEFAULT_HANDLE_BINDINGS` 的问题：`full` 形态左右键给了 `note.current` / `note.list`（便利贴），而"切事项""看今日"这类更高频的被放到双击（`leftDouble`/`rightDouble`）——高频动作藏在双击里，低频占了单击，不符合使用习惯。

建议默认绑定（仅调默认值，用户仍可自定义；id 全部不变）：

| 形态 | 槽位 | 现状默认 | 建议默认 | 理由 |
|---|---|---|---|---|
| full | left | note.current | `todos.open`（事项窗） | 切事项是最高频的把手动作，给最顺手的左单击 |
| full | right | note.list | `today.panel`（记录面板） | 看今日记录次高频 |
| full | middle | null | `note.current`（当前便利贴） | 便利贴降为中键，仍一键可达 |
| full | leftDouble | today.panel | `patina.open`（唤出主界面） | 唤出完整界面属"进一层"，适合双击 |
| full | rightDouble | today.digest | `note.list`（便利贴清单） | 清单低频，留双击 |
| half | left | patina.open | `todos.open` | 与 full 左键语义对齐，减少形态间记忆负担 |
| half | right | todos.open | `patina.open` | — |
| dot | left | today.panel | `patina.open`（唤出主界面） | 圆点态下最可能的诉求是"展开回来" |
| dot | right | today.digest | `today.digest`（今日摘要） | 保持轻量只读入口 |

> 约束：以上仅改 `DEFAULT_HANDLE_BINDINGS` 常量值与必要的 `label` 文案，**不新增/改名任何 id**，不改 slot 枚举。老用户已存配置不受影响（只影响首次/重置）。

### 1.4 常用操作最短路径对照表

点击数 = 鼠标主要动作次数（悬停不计为点击，但标注）。"现状"取当前默认绑定与"点数字=结束"。

| 操作 | 现状路径 | 现状点击 | 重构后路径 | 重构后点击 | 变化 |
|---|---|---|---|---|---|
| 开始计时 | 药丸主按钮点击 | 1 | 同（本体层不变） | 1 | ±0 |
| 暂停 | 药丸主按钮点击 | 1 | 同 | 1 | ±0 |
| 结束并保存 | 点数字区直接结束（误触风险高） | 1 | 点数字→面板内"结束并保存"（带确认） | 2 | +1（刻意，换防误触） |
| 切换事项 | 悬停露把手→双击 leftDouble？否则右把手→事项面板→选 | 悬停+2~3 | 悬停→左把手单击直开事项窗→选 | 悬停+2 | −1 |
| 看今日记录 | 悬停→双击 rightDouble（today.digest） | 悬停+2(双击) | 悬停→右把手单击→记录面板 | 悬停+1 | −1 |
| 唤出主界面 | 悬停→左把手（half）/ 需展开 | 悬停+1~2 | 悬停→leftDouble 或 dot 左键 | 悬停+1~2 | ±0（语义更一致） |
| 改事项名 | 双击事项名 | 2(双击) | 同（本体层保留行内改名） | 2 | ±0 |
| 开倒计时菜单 | 右键→倒计时 或 绑定把手 | 1~2 | 右键→倒计时（浮层层固定） | 1~2 | ±0 |

净结论：**最高频的开始/暂停保持 1 次不变；切事项、看今日各省 1 次（把高频从"双击/多级"提到"单击直达"）；结束刻意 +1 换取防误触**。整体把"高频浅、低频深"的梯度理顺。

## 2. dot / pill / handles 交互流程

### 2.1 三形态与状态的关系（承接 P1 §4.1）

形态（dot/pill）决定**信息量**，四态（idle/running/paused/ended）决定**颜色与动效**，两者正交：dot 和 pill 都要能表达四态。

```
            idle        running      paused       ended(900ms)
  pill   中性环+灰字   accent环+白字  muted+呼吸   success/danger闪
  dot    中性描边点   accent实心点   muted实心点   闪一次后回对应静息态
                         └─ 累计≥2h：dot 点色升 violet（P1 §4.2，叠加在上述之上）
```

### 2.2 dot（收窄小圆点）行为流

| 触发 | 行为 | 约束 |
|---|---|---|
| 静息 | 显一个随状态着色的 ⌀33 正圆点，不显文字/把手 | 最低视觉重量终态（**[实测修正]** 原写 ⌀32 是错的：实测 `--dot-size: 33px`（搜 `--dot-size`：`styles/design-tokens-compat.css` 的兼容覆盖与 `styles/dot.css` 里「22px → 33px」的注释两处同值）；32 是**条高** `--pill-h`（搜 `--pill-h`，在 `styles/tokens/01-primitives.css`），两个数不要混） |
| hover 进入 | ① 浮出 tooltip「事项名 · 已计 mm:ss」opacity 150ms 淡入；② 点周围 1px `border-strong` 微亮一档 | 点本体**不放大**、不加投影（P1 硬约束） |
| hover 停留（按 A1）/ 单击 | morph 回 pill：窗口几何切到药丸尺寸，内部单色点扩成环 | **[实测修正]** 原写「width 280ms / 只动 width+opacity」不成立：morph 是**窗口尺寸变化**，由前端 `useWindowAutoFit` 调 `win.setSize`（`timing/hooks/useWindowAutoFit.ts`，搜 `setSize`）完成，不是 CSS 宽度动画；`--dur-morph: 280ms` 实测只被浮层/移动端纸张消费。前端**不得为形态切换新增 `width` / `height` / `border-radius` 过渡**（判据见 §5.2） |
| 绑定了把手动作的键（dot 形态可独立绑定）| 执行对应 `handleCatalog` 动作 | dot 形态把手默认：左=唤出主界面、右=今日摘要 |
| hover 离开 | tooltip 150ms 淡出，微亮回落 | — |

> dot 的"hover 停留即展开"与"点击即展开"二选一由 fe 按 A1 实现；本规范建议**单击展开**为主、hover 仅出 tooltip，避免鼠标路过误触撑开（降低打扰）。

### 2.3 pill ↔ handles 露出时机

| 状态 | 把手簇可见性 | 理由 |
|---|---|---|
| 鼠标不在药丸上 | 完全隐藏（opacity 0，不占命中区） | 常驻低干扰，药丸只呈现"事项+时间+主控" |
| hover 药丸 | 两端把手 opacity 淡入滑出（≤16px，P1 §4.1），150ms | 渐进展开：悬停才露功能 |
| hover 离开 | 延迟 ~200ms 再淡出（给鼠标移向把手的缓冲） | 防手抖导致把手刚露就消失，够不着 |
| 拖动中 | 把手隐藏，整条进 `--z-drag` | 拖动时不误触把手动作 |

morph（dot↔pill）与把手露出是**两套独立动画**，不得联动：morph 只在形态切换时跑一次；把手淡入是 hover 的持续反馈。

### 2.4 四态在条上的一致感知（统一反馈语言）

同一状态在 dot 与 pill、在主窗与分析窗镜像处，必须用**同一个信号维度**表达，用户学一次即可跨端复用：

| 状态 | 唯一主信号 | 辅助信号 | 禁止的做法 |
|---|---|---|---|
| idle | 无强调色（中性） | 数字走 tertiary/白 | 不得用额外图标提示"空闲" |
| running | 一处 accent（环或主按钮二选一，P1 一处强调） | 秒进位 opacity 淡入 | 禁数字跳动、禁多处上色 |
| paused | accent 降 muted + 1.2s 呼吸 | — | 禁用灰字+变色双重提示造成歧义 |
| ended | success/danger 闪一次 900ms | 面板内结束按钮的确认结果 | 禁循环闪、禁常驻红 |
| 倒计时告警 | 数字转 warning 色 | — | 这是唯一允许数字变色的场景 |

## 3. 设置菜单重组方案

### 3.1 目标分组树（按使用场景，统一桌面与移动语义）

沿用分析窗已有的五组骨架（已验证合理），但**统一命名、明确每组内的基础区/高级区分界**，并把移动端四 tab 的语义映射到同一棵树。

```
设置（5 组 / 12 个锚点；**锚点总数与归属不改动**）
├─ 1. 计时行为                                                  [s-tracking]
│   ├─ 时间规则（时间线合并间隔 / 空闲超时 / **最短记录时长**）· 三行单列
│   └─ 记录选项（暂停追踪 / 全局标题）
│
├─ 2. 外观与主题                      [s-theme / s-highlight / s-display]
│   ├─ 主题与主色（含四色 running / warn / done / bar）
│   ├─ 高亮颜色（独立于四色，见 §3.3 D3）
│   └─ 显示与语言（配色预设 / 语言 / 灵动视效）
│
├─ 3. 悬浮条与把手                      [s-pill-handles / s-pill-look]
│   ├─ 把手绑定（三形态 × 五槽位 × 13 动作）        [高级·默认折叠]
│   └─ 悬浮条外观（文字/背景不透明度 + 常驻形态 bar/dot）
│
├─ 4. 数据与同步                                  [s-sync / s-backup]
│   ├─ 同步与备份（md_sync：Markdown 落点 / 本地 / WebDAV / 备份）
│   └─ 数据安全（导出与导入：数据导出 / 数据导入 / **定时导出** / 全额数据包 · 本机目录 · 清理）
│       └─ [高级·默认折叠] 存储路径 / 缓存清理
│
└─ 5. 通用与启动              [s-general / s-resident / s-plugins / s-ai]
    │  （组名沿用既有命名、**不逐项罗列**：本组另含「插件」「AI 与标签」两个锚点）
    ├─ 通用（**只剩开机自启** ← 最短记录时长已迁往第 1 组）
    ├─ 常驻与启动（单组「运行行为」：关闭到后台 / 显示托盘图标 / 静默启动）
    ├─ 插件（默认展示磁盘事实，无启停开关）
    └─ AI 配置
```

> **[实测修正 2026-11-19 · 已按 `d09ffe4` 落地版对齐]** 上面这棵树是**当前代码的样子**，不是提案。两处行级搬迁已生效、锚点与 `TOP_LADDER` 一动未动：
> - 「最短记录时长」在 `SettingsTrackingPanel` 的**时间规则组第三行**（组件 `SettingsMinRecordRow`，单列不套 `-pair`：3 是奇数，两列会在第二行留半格）；`s-general` 只剩「开机自启」，组名「通用与启动」仍贴题。
> - 「定时导出」从导出弹窗的四级深挖提为**导出与导入组的第三行**，行序 = 数据导出 → 数据导入 → 定时导出 → 全额数据包（按"单次动作 → 定时动作 → 全量动作"读）。导出弹窗头部那个日历图标已删，**入口唯一**。
> - 组名以代码为准：「时间规则」/「记录选项」（`timeRulesTitle` / `recordingOptionsTitle`），不是早期草稿写的"记录规则"；「数据安全」「导出与导入」同理。
> - 定时导出按钮文案复用 `settings.webDavConfigure`（值「配置」）——**键名撒谎**（键是 WebDAV 配置、值被借来当通用词），已记 B6 的 i18n 债，等 contract 有余量再正名；文档不为此展开。

> **[实测修正 2026-11-19 · 口径已与代码层对齐]** 与原树的五处差异，都是"照原树写会做错事"的地方：
>
> 1. **常驻形态不并组**：`HostPillLookCard`（内容 = 文字/背景不透明度 + 常驻形态 `floatForm`）**整张卡留在第 3 组 `s-pill-look`**，第 2 组不拆出第二个锚点。原树一边把"悬浮条外观（不透明度+常驻形态）"列进第 2 组、一边又把"常驻形态"列进第 3 组并要求按 D1 只保留一处，**自相矛盾**。三条理由：① 拆成两处锚点会新增第 13 个锚点，`TOP_LADDER`（`settingsNavAnchors.test-utils.ts`，搜 `TOP_LADDER`；12 项、长度必须等于锚点数）与四个导航用例的落点要全部重算，而收益只是分组语义更"纯"；② D1 已核实桌面**只有一处**入口，本来就没有重复要消，这一项没有需要解决的问题；③ 把不透明度与常驻形态拆到两个锚点，会让"改悬浮条外观"变成两次跳转。
> 2. **常驻形态的值域是 `bar` / `dot`**，没有第三个值；`dot / half / full` 是**手柄三形态**（`HANDLE_FORMS`），属第 3 组「把手绑定」的内容（§3.3 D1-b）。
> 3. **第 2 组只有三个锚点**（`s-theme` / `s-highlight` / `s-display`），与代码一致；第 3 组两个锚点（`s-pill-handles` 先、`s-pill-look` 后——顺序即 DOM 顺序，别按"基础在前"重排）。
> 4. **第 5 组保留「通用」与「常驻与启动」**：原树只写了 插件 / AI / 关于，**漏掉了 `s-general`（开机自启、最短记录时长）与 `s-resident`（关闭到后台 / 托盘图标 / 静默启动）**——照原树落地会把这两个锚点从页面上删掉，属功能回退。
> 5. **「关于 / 第三方声明 / 版本」不属于设置页**：它是分析窗的**壳级独立视图**（`activity/features/about/components/About.tsx`，由 `AppShellViews` 的视图路由挂载），设置页内不提供「关于」入口，故从第 5 组移除。
> 6. **通用规则：锚点标题必须等于卡片标题。** 导航逐条渲染锚点 `title`，点进去看到的卡头必须是同一个名字，否则用户以为点错；**要改就两处同批改**（B5b 的「手柄绑定 → 把手绑定」即此）。`s-ai` 与 `HostAiCard` 当前都是「AI 与标签」，**原样保留**。
> 　**判断一个词是否空挂，看卡内有没有对应实体，不看仓里有没有同名目录**——`s-ai` 的「标签」指卡内「建议范围」块管着的 AI 标签建议（卡内「启用 AI」那一行的 hint 写了「标签建议」、正文有「建议范围」`h3`）。完整的踩坑记录在 `HostAiCard.tsx` 的防复发注释里，本文不重复。
>
> **组名结论（第 5 组 = `通用与启动`）：保持现名，不改。** 两条理由：
> ① **该组主体是通用项与常驻/启动行为**——`s-general`（开机自启）与 `s-resident`（关闭到后台 / 显示托盘图标 / 静默启动）是本组权重最高的内容；「插件」「AI 与标签」这两个锚点是尾部低频项。**不为次要项改整组名**，否则组名会把高频内容藏起来——正是本文 §3.1 反对的"名字与内容错位"。
> ② 左侧导航**逐条渲染锚点标题**（`SettingsGroupNav` 按 `SETTINGS_GROUPS` 逐个渲染 `group.anchors`），用户找"插件"扫的是锚点名，组名不承担索引职责；而改名要再动一次刚被 B5b 改过的分组表标题与四个导航用例的期望组名，收益只是标签精确度。
> 原「插件与关于」这个命名**前提是"通用/常驻/启动会被重新分配出去"**；但 D1 核实后已决定**不动锚点归属**（`HostPillLookCard` 不拆、无锚点迁移），前提不成立，组名也就不该跟着改。
> **组名不需要随搬迁调整**：「最短记录时长」迁走后，`s-general` 只剩「开机自启」、`s-resident` 仍是「常驻与启动」，「通用与启动」对这个组**反而更贴题**（未迁时反而要解释"通用"里为什么装着记录规则）。唯一真实的触发条件只剩一条：**分组名纳入 i18n 时**再议（届时改名不再牵动导航用例的中文字面量）。在那之前，本组名作为既有命名沿用。
>
> **[已落地 · `d09ffe4`] 原「本轮不做的提案」已作废改写**：原树把「最短记录时长」列在第 1 组，而它当时长在第 5 组的 `s-general`。这是**行级搬迁**——`s-general` 锚点依然存在（只少一行）、锚点总数仍 12、`SETTINGS_ANCHOR_IDS` 与 `TOP_LADDER` 全不动。已随 B5d 完成：读写逻辑抽成 `SettingsMinRecordRow`（约 50 行草稿 / 钳制 / 提交，塞进面板会让面板从"排布"变成"排布 + 一条写库"），渲染在 `SettingsTrackingPanel` 的时间规则组**第三行**，**不套 `TrackingMinuteField`**（那是分钟粒度，秒值 5–300 会被挤成 0–5 分钟）。语义零改动：失焦 / 回车提交、空值不写库、越界钳 5/300、非 5 的整数倍也照存。
>
> **[未做且已否决] 把 `s-general` 并进 `s-resident`**：前者是**即改即存**（写注册表 + 双写 `launchAtLogin`），后者三行是**草稿 + 页头保存**；合并会让"这两个一改就存、那两个要按保存"无法解释，且 `HostGeneralPanel` 挂着 g09–g11 三个用例。记技术债，**不要为了消除单行卡而并组**。

分组顺序理由：计时行为是产品主职能、改得最勤 → 置顶；外观与悬浮条/把手视觉相邻 → 2、3 相连；同步数据偏运维 → 靠后；第 5 组（通用 / 常驻启动 / 插件 / AI）整体最低频 → 收尾。相比 0.12.1 把"悬浮条与手柄"强置第一组（那是为"手柄绑定"这个新功能配的可发现性口径，PRD A-01），本规范建议**把高频的"计时行为"提到第一组**，把手绑定作为高级项收进第 3 组折叠区——可发现性由 3.4 的首次引导承担，而非靠占据第一屏。

> **[实测修正 2026-11-19]** "提到第一组"这一项**已在 B5b 落地**（`5a4cd29`：`settingsGroups.ts` 已把 `tracking` 排到首位，`Settings.tsx` 网格同批调整，DOM 顺序与表严格一致）。剩余动作只有"把手绑定默认折叠"（B5c）与 §3.4 的首次引导。

### 3.2 基础区 / 高级区分界规则

- **基础区**：装机即用、多数用户会碰的开关与数值，直接平铺。
- **高级区**：把手绑定、存储路径、缓存清理、AI 配置——**默认折叠**（复用分析窗现有的 `FoldBlock`），标题旁标"高级"。**定时导出不在高级区**：它是一条带入口的长期设置行，与数据导出一组平铺（原四级深挖已收，见 §3.5(2)）。
- 判定标准：一个设置项若"90% 用户一辈子不改"或"改错会破坏数据/行为"，归高级。把手绑定属于前者（强自定义），存储路径属于后者（改错丢数据）。

### 3.3 重复项与深层嵌套清理（逐条迁移映射）

> **[实测修正 2026-11-19] 本节已按源码实测整表重写**（基线：`5a4cd29` B5b 已落地后的工作区 + HEAD 历史；证据一律写「文件 + 可搜索记号」，不写行号）。
> 原表把 D1–D4 列为"待去重"待办，**实测结论是这四项都不需要去重**：桌面端每项本就只有一个可编辑入口，
> 第二处全部落在 **Android 包**（`timing/components/settings/*`，编译期 `IS_MOBILE` 分叉，桌面产物里被整块摇掉）。
> 只有 **D5 是桌面真实重复**。照原表执行会做出 3 处无谓改动，且 D1/D3/D4 的"合并入口"会动到 Android 唯一的设置入口——
> 所以下面每条的「动作」列写的是**该做什么 / 不该做什么**，不是待办编号。

| # | 实测结论 | 证据（文件 + 可搜索记号） | 动作 |
|---|---|---|---|
| **D1** 常驻形态 `floatForm` | **不需去重**。桌面只有一处，且在「悬浮条与把手」组、不在「外观与主题」组；第二处是 Android 专用 | 桌面 `activity/features/settings/components/host/HostPillLookCard.tsx` 里的 `floatForm` 那一段（下拉 + 写入，搜 `floatForm`）；Android `timing/components/settings/AppearanceCard.tsx` 里的同名段（同搜 `floatForm`）。Android 侧三重隔离：`!IS_MOBILE` 门控（搜 `!IS_MOBILE`）、`ThemePicker` 唯一消费者 `mobile/SettingsPage.tsx`（搜 `ThemePicker`）、`MobileShell` 由编译期常量分叉（`__TIMING_MOBILE__` 只在 `timing/lib/platform.ts` 声明并导出为 `IS_MOBILE`，搜 `__TIMING_MOBILE__`；`entry/App.tsx` 搜 `IS_MOBILE` 即见分叉点） | **不动代码，也不并组**：`HostPillLookCard` 整张卡（不透明度 + 常驻形态）留在第 3 组 `s-pill-look`，第 2 组不拆第二个锚点（理由见 §3.1 注 1）。原表"移动端 AppearanceCard 对齐同文案"降级为**跨端一致性待办（非本轮）**：它在桌面不可达，改它只影响 Android 包 |
| **D1-b** 概念澄清（新增行） | `floatForm` 值域只有 `'bar' \| 'dot'`；`dot / half / full` 是**手柄三形态** `HANDLE_FORMS`，编辑点在 `SettingsHandlesPanel` 一张卡内三行 | `shared/pillAppearance.ts` 里 `floatForm` 两处：类型定义与归一化（搜 `floatForm`）；`shared/handleCatalog.ts` 的 `HANDLE_FORMS`（搜 `HANDLE_FORMS`） | 文档与文案**禁止用 dot/half/full 描述常驻形态**。"收起为圆点"= `floatForm='dot'`，不是第三形态（该口径原表已正确，此处只补证据） |
| **D2** 文字/背景不透明度 | **不需去重**，且不存在"组件层各写一份"：控件实现只有一份，根变量写入点全仓只有一个 | 控件：`HostPillLookCard.tsx` 的局部 `opacitySlider()`，同一个函数被调用两次、分别渲染**两个不同字段**（`textOpacity` / `bgOpacity`，搜这两个词各命中一处），不是同一字段写两遍。唯一 `setProperty`：`timing/stores/appearanceStore.ts`（搜 `--ui-text-opacity`，全仓只此一处写入）。CSS 全部经令牌消费（grep `--ui-text-opacity` / `--ui-bg-opacity` 即列全：`tokens/01-primitives.css` 定义、`02-theme-dark.css` / `03-theme-light.css` 两套值、`04-aliases.css` 别名，以及 `overlays.css` / `panels.css` / `surfaces.css` / `note.css` 的消费点）。分析窗自身 0 处消费（activity 目录 grep 命中 0） | **不动代码**。原表「组件层不得各写一份」这句话作为**长期规约保留**（它已经是事实）；文案「只影响悬浮条，不影响本页」保留——实测准确（搜 `只影响悬浮条`） |
| **D3** 高亮颜色 | **不需去重**。数据层本就是两条独立设置（不同字段、不同命令），桌面分两张卡、两个锚点、两个标题 | `ReferenceSettings.highlightColor`：`host/HostHighlightCard.tsx`（搜 `highlightColor`，控件与写入各一处）→ `platform/desktop/hostSettingsGateway.ts`（搜 `highlightColor`）；Android `settings/HighlightColorRow.tsx`（搜 `HighlightColorRow`，挂在 `ThemePicker` 里）。无联动代码：`applyAccents` 只写 `--color-*`（`timing/lib/theme.ts`，搜 `applyAccents`），`--highlight-color` 只由 `timing/services/highlightActions.ts` 写（搜 `--highlight-color`） | 不动代码。**防歧义短注本轮不做**（已裁决：为加一行注释去动 `HostThemeCard` / `HostHighlightCard` 不划算，B5c 明确不碰这两张卡）→ 留作后续项。根因备查：两者出厂值同为 `#4DA3E8`（`tokens/02-theme-dark.css` 里 `--accent` 与 `--highlight-color` 相邻两行同色，搜 `--highlight-color: #4DA3E8` 即命中）且互不联动，是"看起来像同一条设置"的根源；将来要做，就是两卡各加一句"改这里不影响主色/高亮" |
| **D4** 主题四色 | **不需去重**；已回落语义令牌，但"两端读同一组"对**分析窗不成立** | 回落：`tokens/04-aliases.css`（搜 `--color-running`，四个别名同块定义）→ `--accent/--danger/--warn/--ok`；运行时不硬写：`timing/lib/theme.ts` 的 `applyAccents`（搜 `applyAccents`；等于出厂默认即 `removeProperty`，只有用户改过才内联）。**四色实际是 running / warn / done / `bar`**：色键在 `timing/lib/theme.ts`（搜 `--color-bar` 见映射表）、四行 UI 在 `host/HostThemeCard.tsx`（搜 `小条底色` 即第四行）；`--color-danger` 只是别名、**没有可配键**。**分析窗 0 处使用 `--color-*`**（grep 计数 0），它用 `--at-*`（`shared/theme/deriveTheme.ts`） | 不动代码；**修正文档写法**（原表"running/danger/warn/done"→ running/warn/done/bar）。另需接受一个交互事实：**改四色在设置页自身零可见反馈**，只有悬浮条会变→ 不做"本页预览控件"（那会制造第二处看起来的入口），验证途径只能是悬浮条 |
| **D5** 开机自启 | **唯一的桌面真重复**。但性质不是"同一设置两份 UI"，而是**两个字段驱动同一 OS 状态**、持久化两份、且会互相覆盖 | 见下方「D5 详述」 | 按已定方案：**保留 `HostGeneralPanel` 的即改即存开关、移除 `SettingsResidentPanel` 的 `launchAtLogin` 行、切换时双写同步两字段**（不新增 IPC、不改 Rust、不改表结构） |
| **D6** 把手绑定卡降级 | **已在 B5b 落地**（`5a4cd29`：`s-pill-handles` 从第 1 组挪到第 3 组，`settingsGroups.ts` 与 `Settings.tsx` 同批改，DOM 顺序与表一致） | `settingsGroups.ts` 当前 group 顺序：tracking → appearance → pill → data → general；卡头已同步为「把手绑定」（`SettingsHandlesPanel.tsx` 里 `<FoldBlock title="把手绑定">`，搜 `title="把手绑定"` 即命中），与锚点标题一致 | 剩余仅"默认折叠"（B5c，**已落地**）。**卡头与锚点已对齐，不要再用旧名「悬浮条与手柄」**——改组名/锚点名时该卡 `title` 必须同批改（`5a4cd29` 已把这条规矩写进该文件头注释） |
| **D7** 时间统计/Patina 入口 | **[实测修正] 桌面根本不存在这个入口**，不是"埋在深处" | 该入口在 `timing/components/settings/GeneralTab.tsx` 里，由 `{!IS_MOBILE && (` 包着（标签「时间统计 / Patina · MIT」，搜 `Patina · MIT` 即命中）。**这里不写行号**——该文件头部注释一改，行号就整体位移（本轮已发生一次：插入 9 行注释，整段下移 9 行）。它**被双端同时排除**：桌面不挂载 `GeneralTab`（`MobileShell` 编译期分叉，唯一调用点 `src/windows/timing/components/mobile/SettingsPage.tsx`），移动端 `IS_MOBILE` 恒真 → 那个 `!IS_MOBILE` 分支永不渲染。桌面侧等价入口只有托盘「时间统计…」（`src-tauri/src/infra/tray_menu.rs`，搜 `时间统计`） | **无需动作**。原表"保留一处即可"自动成立（桌面本来只有托盘一处）；不要为了"归组"去把 GeneralTab 接回桌面 |
| **D8** 设置 CSS 多文件叠加 | 与 IA 无关，仍是 fe 的 B6 职责 | `settings.css` 1275 行 + `settings-dialog.css` / `settings-sync.css` / `settings-groups.css` / `settings-handles.css` | 维持原样：分组树落地后每组一文件、折叠区独立，见 §6 |

#### D5 详述：两个开机自启开关的真实链路

桌面曾有 **两个开关、都在「通用与启动」组内相邻**，写的是**两个不同字段**、走两条不同后端链路，最终打到**同一个 OS 注册表值**。**已在 B5c（`7ece349`）落地为单入口 + 双写**，下表按"现状 / 已移除"标注：

| 位置 | 字段 | 生效方式 | 现状与链路 |
|---|---|---|---|
| `host/HostGeneralPanel.tsx` 的「开机自启」行（标签硬编码；搜 `ariaLabel="开机自启"` 即命中，双写在同一 `onChange` 内的 `commitSettingsPatch`） | `autostartEnabled`（timing 设置表） | **即改即存**，不等页头保存 | **保留 = 唯一入口**。`set_autostart`（`src-tauri/src/commands/settings_cmd.rs`，搜 `fn set_autostart`）→ 注册表 + 回写 `autostart_enabled`；随后 `commitSettingsPatch({ launchAtLogin: v })` 双写第二份。注意 `update_settings` 带该字段时也会落系统侧（同文件搜 `autostart` 的另一个写入支） |
| ~~`SettingsResidentPanel.tsx` 的 `launchAtLogin` 行 + `Settings.tsx` 对应接线~~ | `launchAtLogin`（activity app settings 表） | — | **已移除**（B5c `7ece349`：该行与两个 prop 一并删除）。字段仍在，现由上一行的双写维护。链路备查：`commitSettingsPatch` → `deps.persistPatch = saveAppSettingsPatch`（`settingsRuntimeAdapterService.ts`，搜 `persistPatch`）→ `cmd_commit_app_settings`（`platform/persistence/appSettingsStore.ts`，搜 `COMMIT_APP_SETTINGS_COMMAND`）→ `useDesktopLaunchBehaviorSync.ts`（搜 `launchAtLogin`）→ `src-tauri/src/app/activity/desktop_behavior.rs`（搜 `app.autolaunch`）→ 同一个 tauri-plugin-autostart |
| `timing/components/settings/GeneralTab.tsx` 里 `showAutostart &&` 包着的「开机自启」行 | 同上（宿主版） | — | **当前不可达**：唯一生产调用点 `src/windows/timing/components/mobile/SettingsPage.tsx` 传 `showAutostart={false}` |

**为什么会互相覆盖（这是真正的隐患，不只是 UI 重复）**：

- OS 层只有一个真源：`src-tauri/src/infra/autostart.rs` 与 `desktop_behavior.rs` 的 `app.autolaunch()` 是**同一个插件、同一个 HKCU Run 值名**（值名 = `productName`；两处都搜 `app.autolaunch` 即命中，值名写在同一文件头注释里）。
- 但**持久化是两份**：`autostart_enabled` 在 timing 设置表，`launch_at_login` 在 activity app settings 表。
- 而 `launch_at_login` 出厂是 `true`（`shared/settings/releaseDefaultProfile.ts`，搜 `launchAtLogin`）。于是：用户在 (a) 关掉自启 → 注册表变 false；下次启动 `useDesktopLaunchBehaviorSync` 按 `launchAtLogin=true` 再写一次 → 自启被重新打开，且用户不知道自己点过两次。

**已落地的处理方案（B5c `7ece349` + `d1f3c31`）**：

1. **保留** `HostGeneralPanel` 的「开机自启」即改即存开关，作为**唯一 UI 入口**（它是唯一能立刻读回注册表实际状态的路径：`set_autostart` 返回 `actual`）。搬走「最短记录时长」后这张卡只剩这一行——属**启动**语义，「通用与启动」的组名仍贴题。
2. **移除** `SettingsResidentPanel` 的 `launchAtLogin` 行（连同 `Settings.tsx` 的接线与 `SettingsResidentPanelProps` 的对应两个 prop）。该卡现存三行（关闭到后台 / 显示托盘图标 / 静默启动），且已并为一组「运行行为」（该卡现在只有一个 `SettingsPreferenceGroup`，标题取 `runtimeBehaviorTitle`）。
3. **切换时双写**：一次用户操作同时写 `autostartEnabled`（`set_autostart`，权威、回读实际值）与 `launchAtLogin`（app settings，让 `useDesktopLaunchBehaviorSync` 不再拿旧值回写注册表）。两字段在 UI 上只出现一次，物理上永远同值。
4. **约束**：不新增 IPC 命令、不改 Rust、不改表结构、不改 `launchAtLogin` 的出厂值（改出厂值会影响未打开过设置页的用户，属于另一个决策）。
5. **已知技术债（不在本轮修）**：双写**不是原子的**——`set_autostart` 成功而 `commitSettingsPatch` 失败时，OS 与 `autostart_enabled` 已是新值、`launch_at_login` 仍是旧值，UI 亮红字让用户重试。真正原子化要后端在一张事务里改两张表，属后续独立批次。另有两个 i18n key 因此失去使用点（`settings.launchAtLoginLabel` / `accessibility.settings.toggleLaunchAtLogin`），**key 保留、生成物行数不动**，别顺手删。

> 验收时不要用"桌面只剩一个 `setAutostart(` 调用"来判 D5——真正的判据是 **UI 上只有一个开机自启开关** + **两个字段在切一次之后同值**（grep 只能挡回归，挡不住"字段漂移"）。

**同源技术债（本轮不修，只记现状与收敛建议，不是"下批必做"）**

| # | 现状 | 为什么本轮不修 | 收敛方向 |
|---|---|---|---|
| T1 | 「最短记录时长」在**两个窗各有一份实现、一份常量副本**：活动窗 `SettingsMinRecordRow.tsx`（`FALLBACK_MIN_RECORD_SEC` / `MIN_RECORD_SEC_MIN` / `MIN_RECORD_SEC_MAX` / `clampSec`）与主窗·移动端 `timing/components/settings/GeneralTab.tsx` 顶部同一组常量（搜 `MIN_RECORD_SEC_MAX` 即命中，两文件的这行几乎逐字相同）。**今天同值，但没有任何机制保证继续同值** | 主窗那份不在本次重构的改动面内：它只服务 Android，唯一调用点是 `timing/components/mobile/SettingsPage.tsx` 的 `<GeneralTab showAutostart={false} />`；收尾期扩大改动面不值 | 把四个常量与 `clampSec` 提到 `src/windows/shared/`（`handleCatalog.ts` 已在那里，跨窗共享有先例），两窗各引一份。届时两边可以各自换 UI，但**值域与钳制只留一处** |
| T2 | `timing/components/settings/GeneralTab.tsx` 里「开机自启」`Switch` 的 `onChange` 只调 `settingsActions.setAutostart(v)`，**没有 D5 的双写**。当前**不可达**（唯一调用点 `src/windows/timing/components/mobile/SettingsPage.tsx` 传 `showAutostart={false}`），但**有毒**：把它改成 `true` 会原样复现 D5 的分叉 bug | 同上（不在改动面内、当前无真实缺陷） | 开启该分支前必须先补 `commitSettingsPatch({ launchAtLogin: v })`。**技术细节不在此重复**，见该 `Switch` 上方的 ⚠️ 源码警告（搜 `测试覆盖不等于可达` 即命中） |

> 两条债的**共性**不是"复制粘贴没清"，而是"**同值靠巧合维持**"：常量两份、双写只在一处。任何"两份东西今天恰好一致"的地方，都要问一句"什么机制保证以后也一致"——没有机制，就是债。

### 3.4 可发现性补偿（把手绑定降级后）

把"把手绑定"从第一组降到第 3 组折叠高级区后，用首次引导补偿可发现性，而不是靠永久占位：
- 首次进入设置页，第 3 组"把手绑定"折叠块标题旁给一枚"新"标记（一次性，点开即消）。
- 悬浮条首次 hover 露出把手时，给一次性 tooltip「可在 设置 > 悬浮条与把手 自定义这些按钮」。
- 两处引导都只出现一次，写入本机偏好标志，不打扰老用户。

### 3.5 落地时会踩到的三条现状（实测，非提案）

改设置页的人（含以后的自己）在动任何一张卡之前必须先知道这三条。它们的共同点是：**不在分组表里，也不在任何一张卡内部，所以既不会被 grep 到，也不会被现有测试挡住。**

**(1) 同一个设置页里有三种保存范式并存，页头「保存 / 取消」只管其中一种。**

| 范式 | 卡片 | 生效时机 |
|---|---|---|
| 页头草稿 + 保存 | `SettingsTrackingPanel`（时间规则三行 / 记录选项两行；其中「最短记录时长」**自己是即改即存**，见下注）、`SettingsResidentPanel`（单组「运行行为」三行，D5 移除「开机自启动」后由四行变三行）、`SettingsAppearancePanel`（配色预设 / 语言 / 灵动视效） | 点页头「保存」，走 `saveSettingsPageStateWithDeps` |
| 卡内自带保存条 | `HostSyncPanel`（md 同步六块折叠） | 卡底自己的保存，与页头无关（`useMdSyncDraft`） |
| 即改即存 | `HostPillLookCard`、`HostThemeCard`、`HostHighlightCard`、`HostGeneralPanel`、`SettingsHandlesPanel`、`HostAiCard`、**`SettingsMinRecordRow`** | 控件一动就落库，没有草稿 |

> **注意「同一张卡里两种范式」这一例**：`SettingsTrackingPanel` 整体走页头草稿，但它内部的「最短记录时长」（`SettingsMinRecordRow`）是**失焦/回车即写库**（`updateReference`）。这不是不一致，是刻意：那一行走的是**宿主参考设置**（`get_reference_settings` / `update_reference`），与页面草稿对象不是同一张表。**但后果是页头「无未保存更改」对它无效**——与下面第三节同一个坑，改这一组时不要顺手把它改成草稿式。

后果：页头「保存 / 取消」由 `SettingsHeaderActions` 按 `hasUnsavedChanges` 算出 `locked`，**对后两类完全无效**。用户在即改即存卡上改了东西，页头仍然显示「无未保存更改」、「保存」是灰的——他会以为没保存成功。任何"合并卡片 / 挪组 / 加折叠"动作都会把这三种范式搅在一起，**动结构时必须同时决定该卡沿用哪种范式，不能只改 DOM 位置**。

**(2) 活动库备份 / 恢复已整块下线，「数据与同步」组的实际内容比文档写的少。**

`SettingsDataSafetyPanel` 的文件头注释记录了这次下线：`SettingsDataBackupGroup` / `SettingsBackupDialog` / `SettingsRemoteBackupPanel` / `SettingsRemoteUploadDialog` / `useRemoteBackupState` / `remoteBackup*` 服务与 `platform/backup/*` 全部删除，理由是"两份不同的备份语义、两套恢复策略、一条会覆盖整库的远端还原"。

该组现在实际只有：**md_sync 同步与备份**（`HostSyncPanel`，含 `MdSyncBackupCard`）+ **导出与导入四行**（`SettingsDataExportGroup`：数据导出 / 数据导入 / 定时导出 / 全额数据包）+ **本机目录**（`SettingsStoragePathsGroup`）+ **清理**（`SettingsDataCleanupGroup`）。

> **[已落地 `d09ffe4`] 定时导出不再是四级深挖**：它原先嵌在「数据导出」对话框里（导出弹窗 → 头部日历图标 → 定时导出弹窗），现在是同一个组里的**第三行**（`SettingsScheduledExportRow`），直接开配置弹窗；导出弹窗头部那个日历图标已删，**入口唯一**。判定它的位置不是 `s-sync` 而是数据安全卡：定时导出与导出/导入/完整数据包是同一个主体（"活动库的进出"），`s-sync` 管的是"计时记录 ↔ Markdown 同步"，另一件事。

**(3) `timing/components/settings/*` 只被移动端复用；该目录下的 `mdSync*.ts` 是转发壳，不是第二份实现。**

- 桌面药丸的内联设置面板（`SettingsPanel → ThemePicker`）已删；`ThemePicker` / `GeneralTab` / `PluginsTab` / `AppearanceCard` / `HighlightColorRow` / `SwatchRow` 的唯一生产消费者是 `mobile/SettingsPage.tsx`，而 `MobileShell` 由编译期 `__TIMING_MOBILE__` 分叉（该常量只在 `timing/lib/platform.ts` 声明并导出为 `IS_MOBILE`，搜 `__TIMING_MOBILE__`；`entry/App.tsx` 搜 `IS_MOBILE` 即见分叉点）。**桌面产物里这一整组组件不存在**——所以在桌面设置页里 grep 到"同名同功能"的实现时，先确认它是不是只服务 Android，不要急着合并。
- 该目录下 `mdSyncAuto.ts` / `mdSyncConfig.ts` / `mdSyncCopy.ts` 都是 **6 行 re-export 壳**（如 `mdSyncCopy.ts` 只有一行注释 + `export * from '../../../../../shared/settings/mdSyncCopy'`），真源已合并到 `shared/settings/mdSync*`；`features/settings/services/host/mdSync*.ts` 也是同样的壳。三处 **不是三份实现**，`mdSyncCopies.drift.test.ts` 专门盯着不许分叉——拆分或搬移这些文件时不要"顺手合并"，会把壳变回副本。

## 4. 键盘与无障碍

### 4.1 快捷键归纳（悬浮条聚焦时）

| 键 | 动作 | 等价入口 | 备注 |
|---|---|---|---|
| Space | 开始 / 暂停（切换） | 药丸主按钮 | 焦点在条本体时生效 |
| Enter | 打开计时面板（含"结束并保存"按钮） | 点数字区 | 不再直接结束（配合 A4 防误触）；结束在面板内再 Enter 确认 |
| Esc | 收起当前浮层 / 面板，回药丸；再按收成 dot | 面板关闭 | 逐层退出，不一次性全关 |
| Menu / Shift+F10 | 打开右键快捷菜单 | 右键 | 键盘用户的菜单入口 |
| Tab / Shift+Tab | 在把手簇按钮间移动焦点 | hover 露把手 | 键盘聚焦时把手须可见（见 4.2） |
| ↑ / ↓（armed 态） | 调倒计时时长 | 滚轮 | 仅倒计时待命态；步进与滚轮一致 |
| F2 | 进入事项名行内改名 | 双击事项名 | 键盘等价双击 |

> 全局快捷键（跨应用）属 ADR-022 范畴，本轮不扩展；以上为窗口内聚焦快捷键的归纳与补全。

### 4.2 焦点可达与顺序

- 把手簇默认靠 hover 露出，但**键盘聚焦（:focus-visible）时必须强制可见**，否则 Tab 到一个不可见按钮等于陷阱。
- 焦点顺序（pill 内）：事项名 → 主按钮 → 计时数字/面板触发 → 左把手各槽 → 右把手各槽。顺序跟随视觉从左到右，不跳序。
- 浮层弹出后焦点移入浮层首个可操作项；Esc 关闭后焦点**归还**到触发它的元素（focus return），不丢焦点到 body。
- 焦点环用 P1 的非文本 ≥3:1 焦点环令牌，深浅两套各自达标；不得用 `outline:none` 去掉而不给替代。

### 4.3 ARIA 与读屏

| 元素 | 角色/属性 | 说明 |
|---|---|---|
| 药丸整体 | 有可访问名「Timing 计时器 · {事项名}」 | 读屏进入即知这是什么 |
| 主按钮 | `aria-pressed` 反映 running/paused；可访问名随态变"开始/暂停/继续" | 状态可被读屏感知，不靠纯颜色 |
| 计时数字 | `aria-live="polite"`，但**按分钟而非每秒**播报 | 防读屏每秒刷屏；告警阈值切换时额外 polite 播报一次 |
| dot | 可访问名「{事项名} · 已计 {时长}」，等于其 tooltip 文本 | tooltip 内容必须同时是 aria-label，不能只有视觉 tooltip |
| 把手按钮 | 可访问名 = 绑定动作的 label（读 `handleCatalog.label`）；不可逆动作加 `aria-description`"不可撤销" | 复用目录 label，改名只改 label 不改 id |
| 结束按钮 | 面板内，可访问名「结束并保存（不可撤销）」 | 不可逆语义进可访问名 |
| 四态 | 不以颜色为唯一信号：running/paused 由主按钮可访问名 + aria-pressed 承载 | 满足"不靠颜色传达信息" |
| 把手绑定设置的 select | 每个 `<select>` 有 label「{形态}·{槽位}」、选项读 label | 读屏可完成绑定配置 |

### 4.4 prefers-reduced-motion

- morph（**窗口尺寸变化**，非 width 过渡，见 §2.2 与 §5.2）、把手淡入滑出、秒进位淡入、paused 呼吸、ended 闪烁——**全部退化为瞬切或静态**（P1 已定）。
- ended 在 reduced-motion 下用一次性静态高亮 900ms 后撤除（保留"结束了"的结果反馈），不做渐变。
- 退化后信息不丢：靠颜色静态值 + 可访问名，不依赖动画表达状态。

## 5. 交互验收清单（可勾选、可测判定）

> **判据纪律（三条，都是踩过坑换来的）**
> 1. **绿不等于对**：测试通过只说明**被断言的那部分**成立。`bf02` 曾用固定 `scrollHeight` 写"折叠块先展开再滚"，把 `flushSync` 换成异步派发仍然全绿——因为落点没经过夹取，顺序根本没被钉住。**用一条判据前，先问"把它做错，这条会不会红"**；不会红就不是判据，是装饰。
> 2. **覆盖不等于可达**：可达性只能看**调用点传的 props**，不能看测试是否覆盖。`GeneralTab` 的开机自启分支有单测、是绿的，却在桌面与 Android 双端不可达（调用点传 `showAutostart={false}`），且它缺 D5 双写（技术债 T2）。
> 3. **行号会漂，结构不会**：**凡能用结构命名的指针一律不写行号**（"哪个卡 / 哪个组 / 第几行 / 搜什么串"）；行号只在无处可锚时作辅助，并留余量。本批两次都是**真漂移**（内容没变，位置变了）：① `HostGeneralPanel` 搬走「最短记录时长」后整卡上移；② `GeneralTab.tsx` 插了 9 行注释，整个分支下移 9 行。所以本文指向 TSX 的位置改用「搜 `ariaLabel="开机自启"`」「搜 `测试覆盖不等于可达`」「`showAutostart &&` 包着的那一行」这类**搜得到就不会错**的锚。
> 　**判断"行号是原文写错，还是后来漂了"——看 HEAD，不看工作区**：`git show HEAD:<path> | grep -n '<结构特征>'`。HEAD 上对、工作区里错 = 未提交改动造成的漂移（本轮两次都是这类，不该记成"历史错误"）；HEAD 上就错才是原文写错。
> 　**本文已无行号指针**（§3.3 的「证据」列与 Rust / 令牌文件一律改成「文件 + 可搜索记号」）。判据本身必须能在**不看行号**的情况下判定——否则它测的是文件排版，不是行为。

### 5.1 信息架构与路径
- [ ] 开始/暂停仍为本体层单击 1 次（点击数 ≤1）。
- [ ] 切换事项路径 ≤ 悬停+2 次点击（左把手→事项窗→选）。
- [ ] 看今日记录路径 ≤ 悬停+1 次点击（右把手→记录面板）。
- [ ] "结束并保存"不出现在本体层单击直达；必经面板内按钮，且该按钮带确认语义。
- [ ] 同一动作（尤其 timer.stop）不在两层同时提供默认单击入口。
- [ ] 13 个 handleCatalog id 全部未改名（grep 比对 P1 前后 id 集合相等）。

### 5.2 形态与状态
- [ ] dot hover 时点本体尺寸不变（像素级），仅出 tooltip + 1px 微亮。
- [ ] **形态切换不得引入布局类过渡**（**[实测修正]** 取代原判据「仅动 width/opacity」——那条依赖一个不存在的 CSS 宽度动画）：`styles/dot.css` 里 `.dot` 的 `transition` 只允许 `color` 与 `transform`（搜 `.dot {` 的 transition 块）；`transform` 只允许按压反馈 `scale(0.94)`（搜 `.dot:active`，B4 明确保留），**`:hover` 下不得出现任何 `scale`**（B4c 已删掉 `scale(1.04)`，搜 `.dot:hover` 应无 `scale`）；前端不得为形态切换新增 `width` / `height` / `border-radius` 过渡（尺寸变化走 `useWindowAutoFit` → `win.setSize`，搜 `setSize`）。改法：grep `dot.css` / `pill*.css` 的 `transition` 声明 + 手测 hover 前后 `offsetWidth` 相等。
- [ ] 形态切换后条高与数字基线不变（像素级；这是「布局类过渡」判据的另一半，`height`/`line-height` 不得参与过渡）。
- [ ] 把手仅在 hover 药丸 / 键盘聚焦 / 有浮层展开时可见；**鼠标离开后延迟 200ms 再淡出**（**[实测修正]** 原写「不小于 150ms」与实现不符：隐藏侧的 transition 是「`opacity` 180ms + **`transition-delay` 200ms**」，即 `transition: opacity var(--dur-exit) var(--ease-standard) var(--dur-base)`，见 `styles/surfaces.css` 里 `.pill__handle svg` 的 `transition`（搜 `.pill__handle svg`），令牌值 `--dur-exit` / `--dur-base` 见 `tokens/01-primitives.css`（搜 `--dur-exit` / `--dur-base`）；露出侧 `transition-delay: 0ms`，同文件 hover 分支（搜 `transition-delay`））。判据：hover 移出后 200ms 内把手仍可点。
- [ ] 四态每态仅一处主信号；running 同屏强调色 ≤1 处。
- [ ] 倒计时告警是唯一数字变色场景，其余态数字不变色。

### 5.3 设置重组

> **[实测修正 2026-11-19]** 本节第 3、4 条按 §3.3 的口径改写：D1–D4 **本来就各只有一处入口**，"去重生效"这个措辞会让人误以为需要改动；第 5 条与「定时导出」的实际深度冲突（§3.5(2)），据此拆条。

- [ ] 设置为五组（计时行为 / 外观与主题 / 悬浮条与把手 / 数据与同步 / 通用与启动），顺序与 §3.1 一致；第 5 组沿用现名但**不把「关于」塞进去**（关于不在设置页）。
- [ ] 把手绑定、存储路径、AI 配置均在默认折叠的高级区；**定时导出已从导出弹窗提为数据组内的一行**（不再算高级折叠项，判据见下文两条）。`[已落地 d09ffe4]`
- [ ] 常驻形态、不透明度、高亮色、主题四色**在桌面各只有一处可编辑入口**——这是**现状已成立**的判据（grep 基线：`HostPillLookCard` / `HostThemeCard` / `HostHighlightCard` 各一处；不透明度只有一个 `setProperty` 写入点），验收目的是**防回归**而非推动改动；若发现第二处，先确认它是否只服务 Android（`IS_MOBILE`）。
- [ ] 开机自启在 UI 上只有一个开关（D5）：全文 grep「开机自启」「开机自启动」在**桌面**设置页内只命中一处——`host/HostGeneralPanel.tsx` 的「开机自启」行（搜 `ariaLabel="开机自启"`）；`SettingsResidentPanel` 里不再有该行；`timing/components/settings/GeneralTab.tsx` 里 `showAutostart &&` 包着的那份仍在，但桌面不可达（调用点传 `showAutostart={false}`），**不计入"两处"**——它只服务 Android。
- [ ] **D5 双写同值（必须是一次真实切换，不是 grep）**：① 打开设置，在「通用」卡把「开机自启」**关**一次 → ② 同时核对 `timing` 设置表 `autostart_enabled` 与 app settings `launch_at_login` **都是 false**（并确认 OS 侧 HKCU Run 项已消失）→ ③ **重启应用**后回来看「开机自启」仍是关、系统没有自启 → ④ 再打开一次、重启，确认仍为开。**为什么不能 grep**：`launchAtLogin` 出厂 `true`（`activity/shared/settings/releaseDefaultProfile.ts`，搜 `launchAtLogin`），两份表在"没动过"时天然同值，grep 会误判通过；只有真的切换一次才能暴露"只写了 ① `set_autostart`、漏了 ② `commitSettingsPatch`"这个半写状态。判据口径见 §3.3 D5 详述。
- [ ] 任一设置项到达路径 ≤ 2 层（组 → 卡/折叠块）——**没有例外**（定时导出原先是四级深挖的唯一例外，已提到 2 层：组 → 数据安全卡 → 「导出与导入」组内一行）。其余不得新增三级嵌套。
- [ ] **点导航能到达折叠块里的内容**：点「把手绑定」时折叠块**先展开再滚**（顺序不能反，展开会改 `scrollHeight`）；锚点 `#s-pill-handles` 落在折叠块的**可见头部**（`FoldBlock` 的 `id` 在 `<section>` 根节点、折叠体是 `${id}-body`），不得落在 `hidden` 的折叠体里（那样点了既不滚也不报错）。**键盘同路径**：导航是原生 `<button type="button">` + `onClick`（`SettingsGroupNav.tsx`，搜 `requestFoldReveal`），`Enter` / `Space` 由浏览器原生派发 click，与鼠标走同一个 `jump()`，`flushSync(requestFoldReveal)` 一样会跑——此项要**手测一次键盘**（Tab 到「把手绑定」→ Enter → 块展开且滚到位），不要只测鼠标。
- [ ] **「最短记录时长」在计时行为组内、与另两行同轴**（**判据限定活动窗设置页**）：活动窗设置 → 第 1 组「计时行为」→「时间规则」组，**第三行**是「最短记录时长」（单列，不套 `-pair`），与前两行的标签左边缘在同一条竖轴上、行间留白等距；数字输入外壳在位（26px 高 / 6px 圆角 / 浅底 / 1px 描边，数字区约 40px + 单位 `S`）。**反例排除**：主窗·移动端 `timing/components/settings/GeneralTab.tsx` 里也有一份同名行与同一组常量，**不在本判据范围内**——不限定窗口的话，这条既可判真也可判假，属于废判据（§5 判据纪律第 2 条）。若外壳缺失（裸数字 + S），那是 `.num-field` 的宿主令牌没解析，不是设计取舍。
- [ ] **「定时导出」的格式 / 字段取自已保存的导出偏好**：在「数据导出」弹窗里把格式改成 CSV 但**不点导出**、直接关掉 → 再打开「定时导出」→ 显示的应是**上次保存的偏好**，不是刚改的临时值（依据：`readExportFormat()` / `readExportFields()`，且每次打开重算）。同一行还要满足：行标题与弹窗标题逐字一致（「定时导出」，复用 `export.scheduledTitle`）、按钮 `compact` 档与另三行同尺寸、导出弹窗头部的日历图标已删（**入口唯一**）。

### 5.4 键盘与无障碍
- [ ] Space/Enter/Esc/Menu/F2/↑↓ 按 §4.1 可用，Esc 逐层退出且焦点归还触发元素。
- [ ] 把手按钮在 :focus-visible 下强制可见，Tab 顺序从左到右不跳序、无焦点陷阱。
- [ ] 主按钮 aria-pressed 与可访问名随态变化；状态不以颜色为唯一信号（读屏可辨 running/paused）。
- [ ] 计时数字 aria-live 按分钟播报，不每秒刷屏；告警切换播报一次。
- [ ] dot 的 tooltip 文本同时是其 aria-label。
- [ ] 不可逆动作（结束/把手绑定的 stop）可访问名含"不可撤销"。
- [ ] 焦点环深浅两套对比度 ≥3:1；无裸 outline:none 且无替代。
- [ ] prefers-reduced-motion 下全部过渡退化为瞬切/静态，状态信息不丢。

## 6. 给 fe 落地的约束（P3 注意）

- **分层 L1–L10**：把手目录 `handleCatalog.ts` 必须保持零 import（唯一跨窗共享载体在 `src/lib/`/`src/windows/shared/`）；设置重组不得让分析窗把主窗 stores/services 拖入包。
- **单文件 ≤600 行**：设置五组落地时每组独立文件，高级折叠块单独成文件；`settings.css` 1275 行须随分组拆分（B6），每版 size-allowlist 只减不增。
- **IPC 不碰**：本规范全部为前端交互/呈现层改动，默认绑定调整只改 `DEFAULT_HANDLE_BINDINGS` 常量，不新增命令、不改契约。
- **功能不可回退**：去重是"合并入口"不是"删功能"；迁移后每个原功能仍可达，验收按 §5.3 逐条核对。**[实测修正]** 本轮去重只剩 D5，且它删掉的是"重复的第二个开关"，不是能力本身——`launchAtLogin` 行移除后"开机自启"仍可在 `HostGeneralPanel` 一处开关完成（§3.3 D5 详述）。
- **只调默认与呈现**：把手 id、slot 枚举、三形态枚举均不可改；label 可改（会反映到 aria 名）。
- **视觉以 P1 为准**：本文不定任何像素/色值；morph 时长 280ms、dot ⌀33、一处强调等数值均引自 P1，fe 以 P1 令牌为准。**[实测修正]** dot 直径统一为 **⌀33**（`--dot-size: 33px`，搜 `--dot-size`；P1 §4.2 已按实测重写为 ⌀33 开口进度环 + 环身黄点，初稿 ⌀32 作废）；**⌀32 是 `--pill-h` 条高**（搜 `--pill-h`），两个数不要混——B6 判像素按 33。

---

## 7. 交付小结（给 team-lead）

1. **三层展开心智**：本体（开始/暂停/名/数字）→ 把手（切事项/便利贴/今日/主界面）→ 浮层（菜单/设置/面板）。每动作只属一层，消除"结束"的本体层误触。
2. **默认绑定重排**：高频（切事项、今日）提到单击，便利贴降中键，唤出主界面进双击；仅改默认值，13 个 id 不改名。
3. **最短路径**：开始/暂停保持 1 次；切事项、看今日各 −1 次；结束 +1 次换防误触。
4. **设置五组树**：计时行为 / 外观与主题 / 悬浮条与把手 / 数据与同步 / 通用与启动（**[实测修正] 第 5 组沿用现名、不改**：导航逐条渲染锚点名，组名不承担索引职责；「关于」不在设置页，它是壳级独立视图）；把手绑定、存储路径、AI 等降为折叠高级区；**[实测修正] 去重只剩 D5 一处**——D1–D4 经源码实测各只有一处入口、无需改动（§3.3）。
5. **无障碍**：快捷键归纳、焦点归还、aria 不靠颜色、aria-live 按分钟、reduced-motion 全退化。
6. 验收清单四节共 **29 条**（**§5.1 六条 / §5.2 六条 / §5.3 九条 / §5.4 八条 = 6 + 6 + 9 + 8 = 29**），均可被路径点击数 / grep id / 像素 diff / 读屏判定。**[实测修正]** 曾写"共 30 条"（估算）、后写"27 条"（B5c 后实测），B5d 两项结构改动使 §5.3 由 7 条增至 9 条（新增「最短记录时长同轴」「定时导选取已保存偏好」），故为 29。**再改条目时请同批改这四个分节数与总和**,并向 B6 报同一组数字。

