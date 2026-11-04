# Spec — TickBar V0.2.0

> 生成日期：2026-10-16
> 依据：PRD-V0.2.0 + ARCHITECTURE-V0.2.0 + DESIGN-V0.2.0
> 上游方案：docs/CHANGE-PLAN-V0.2.0.md
> 状态：**已锁定**（用户已裁决 Q1~Q5）
> 说明：本 Spec 是 V0.2.0 团队内部**规格契约**——范围 / 接口 / 表 / 页面 / 令牌 / AC 以本文为准；细节展开见上游三文档与本契约引用的分册。

---

## 1. 产品定义

- **一句话**：TickBar 是一款 Windows 桌面悬浮药丸条时间记录工具——左键开始/暂停、右键结束、按事项归类时间；V0.2.0 起升级为「**桌面时间工作台**」（对标 Timing v1.7.0）。
- **目标用户**：自由职业者 / 知识工作者
- **核心问题**：忘记开始或停止计时；时间无法归到事项上
- **形态**：纯本地 SQLite、免登录、零网络、零遥测

---

## 2. V0.2.0 范围（锁定 — 不在此列表的功能一律不做）

> RICE 与用户故事全文见 `PRD-V0.2.0.md`。**拆两批交付**（用户已定 Q3）。

### 批 1「一眼就是 Timing」
| 优先级 | 功能 | 说明 | RICE |
|--------|------|------|------|
| P0 | N-8 深浅双主题 | 深/浅两套 Token，可切换 + system 跟随 | 5.00 |
| P0 | N-1 小条随事项名伸缩 | 宽 116–288，`taskW ≤ 164`；**空闲态不复刻"最宽"**（用户已定 Q2） | 5.00 |
| P0 | N-9 四色可配 | 计时中/提醒/完成/小条底色 | 4.50 |
| P0 | N-2 待办事项 | 新增/编辑/删除/勾选完成 | 3.20 |
| P0 | N-10 自绘玻璃菜单 | **应用内菜单**（小条右键/事项右键/便利贴右键）+ 键盘导航 | 3.00 |
| P0 | N-3 事项窗口 | 四状态清单 + 表头汇总 + 空态 | 2.88 |
| P0 | 已保留项视觉对齐 | 药丸条几何对齐 Timing | — |

### 批 2「重功能」
| 优先级 | 功能 | 说明 | RICE |
|--------|------|------|------|
| P1 | N-7 常用事项 / 固定任务 | 最近 5 + 固定任务；**是否上移批1可开发中定**（Q5） | 3.20 |
| P1 | N-6 倒计时 | 正计时 + 倒计时；到点默认通知+视觉，自动结束为开关且默认关 | 2.00 |
| P1 | N-4 便利贴 | 多窗口备注窗 | 1.20 |
| P1 | N-5 提醒铃 | 到点系统通知；±60s 聚合 | 0.96 |

---

## 3. 明确不做（Out-of-Scope — 锁定）

| 不做的功能 | 原因 | 何时考虑 |
|------------|------|----------|
| 插件系统（obsidian-sync / timer-window） | 与「数据保持 SQLite」本质冲突，需独立插件架构设计 | **v0.3（用户已定 Q4）** |
| Obsidian / Markdown 同步 | 数据格式锁定 SQLite | 不计划 |
| 番茄工作法（休息周期/专注屏蔽/白噪音） | 非核心，注意力分散 | 有用户反馈后 |
| 云同步 / 账号 / 团队协作 | 破坏「纯本地免登录」定位 | 不计划 |
| 全局快捷键 | 维持 P1（V0.1.0 已列） | P1 排期 |
| V0.1.0 原 Out-of-Scope 全部 | 继续不做 | — |

---

## 4. 技术架构（锁定 — 含版本锚定）

> **架构主干与 V0.1.0 完全一致**（ADR-001~008 继续有效）；V0.2.0 为增量扩展。

| 层 | 技术 | 版本 | 说明 |
|----|------|------|------|
| 桌面框架 | Tauri | 2.12.4 | Rust 内核 |
| 前端 | React | 19.3.0 | + TypeScript ^5.9.3 |
| 构建 | Vite | 8.3.4 | `minify: 'oxc'`，target chrome105 |
| 状态 | Zustand | ^5.0.15 | |
| 数据库 | SQLite（tauri-plugin-sql / sqlx） | 2.4.1 / 0.8 | |
| 图标 | lucide-react | 1.57.0 | **全项目唯一图标库，禁 emoji** |
| Tauri 插件 | sql / store / autostart / window-state / single-instance | 同 V0.1.0 | |
| **新增依赖** | **tauri-plugin-notification** | **2.7.0**（npm + crates.io 双源核实） | 系统通知，仅此一个 |

**分层（不变）**：表现层 → 命令层 → 业务层 → 数据层（依赖只向下）；单文件 ≤300 行；入口只装配；**计时状态机归 Rust（单一事实来源）**；IPC = invoke 命令 + emit 事件（**无 REST**）。

### V0.2.0 新增架构能力（详见 ARCHITECTURE-V0.2.0.md §6）
| 能力 | ADR | 要点 |
|------|-----|------|
| 多窗口模型 | ADR-009 | 四类窗口统一目录：主小条 384×360 / 设置 392×660 / 事项 宽336 / 便利贴 320×232；label 路由 + 几何持久化+多屏钳制 + 防白闪三件套 + **主题广播各窗自订阅** |
| 后台提醒调度 | ADR-010 | Rust `tokio::interval(15s)` **查询式**扫描（`remind_at<=now`，天然抗休眠）；去重标记 `reminded_at` |
| 倒计时状态机 | ADR-011 | `mode/target_sec` 叠加在三态上；**到点判定归 Rust**（1s watcher）；`accumulated_sec` 钳到 target |
| 双主题 Token | ADR-012 | `<html data-theme>` + CSS 双套变量 + 四色运行时注入 + 内联引导脚本防白闪 |
| **托盘菜单** | **ADR-013** | **保留原生 Win32 菜单，不自绘**（用户裁决）；按状态重建；应用内菜单不受影响 |

---

## 5. IPC 契约（锁定 — 开发唯一依据）

> 完整签名与 DTO 见 `src/types/domain.ts`（`IpcApi` 接口）+ `domain-v020.ts`。**实现侧不得在签名之外新增方法。**

**Spec 锁定命令总数 52**（V0.1.0 的 29 + V0.2.0 的 23）；**实装 62** —— 下表之外的 10 个为 0.2.4–0.2.10 期间实装但未回写 Spec 的增量，见 `docs/phase2/IPC-CONTRACT-v2.md` §11：

| 增量命令 | 用途 |
|---|---|
| `daily_status_get` / `daily_status_set` | 今日计时逐行状态（待办/完成视图） |
| `diary_get_config` / `diary_set_config` / `diary_today` / `diary_open_today` | Obsidian 日记跳转 |
| `discard_timer` | 放弃当前会话（不落记录、不触发待办联动） |
| `get_reference_settings` / `update_reference_settings` | Timing 参考设置读写（仅 `defaultCountdownMinutes` 已消费） |
| `open_timer_window` | 只读 Timer 窗 |

> 这 10 个命令已进入 `IpcApi` / `generate_handler!` / `ipc.ts` 三处，并由 `npm run check:contract` 守护；Spec 不回写以保留 0.2.0 锁定口径。

| 分组 | 命令 | 数量 |
|------|------|------|
| 事项域（继承） | listItems / createItem / updateItem / archiveItem / unarchiveItem / deleteItem | 6 |
| 计时域（继承） | startTimer / pauseTimer / resumeTimer / stopTimer / undoStop / getTimerState / switchItem | 7 |
| 记录域（继承） | listRecords / statsSummary / updateRecord / deleteRecord | 4 |
| 崩溃恢复（继承） | resolveOpenRecord | 1 |
| 设置域（继承） | getSettings / updateSettings / setAutostart / getAutostart | 4 |
| 快捷键域（继承 P1） | registerShortcut | 1 |
| 窗口/系统（继承） | showWindow / hideWindow / toggleWindow / setAlwaysOnTop / saveWindowPosition / quitApp | 6 |
| **待办域（新）** | todoCreate / todoUpdate / todoDelete / todoList / todoToggle | 5 |
| **便利贴域（新）** | noteCreate / noteGet / noteList / noteUpdate / noteDelete | 5 |
| **多窗口域（新）** | openNoteWindow / closeNoteWindow / openTodosWindow / openSettingsWindow | 4 |
| **主题域（新）** | themeGet / themeSet / accentGet / accentSet | 4 |
| **倒计时（新）** | startCountdown / setCountdownPreset | 2 |
| **提醒域（新）** | reminderSet / reminderClear / reminderPending | 3 |

**新增错误码 5**：`NOTE_NOT_FOUND` / `TODO_NOT_FOUND` / `WINDOW_LIMIT_EXCEEDED` / `INVALID_TARGET_SEC` / `INVALID_COLOR`
**新增事件 5**：`countdown-finished` / `reminder-fired` / `theme-changed` / `note-window-opened` / `note-window-closed`

---

## 6. 数据库表清单（锁定 — 5 张表）

> 完整 DDL + 迁移见 `docs/phase2/schema-V0.2.0.sql`。

| 表 | 变更 | 核心字段 |
|----|------|----------|
| `items` | 改造 | id / name / archived / **remind_at** / **reminded_at** / **is_pinned** / created_at / updated_at |
| `time_records` | 改造 | id / item_id / start_at / end_at / accumulated_sec / status(`active\|saved`) / note / **mode**(countup\|countdown) / **target_sec** |
| `settings` | 扩展 | 新增键组：`theme.mode`(dark\|light\|system) / `accent.running·warn·done·bar` / `countdown.presets` |
| `notes` | **新增** | id / item_id(可空) / content / pos_x / pos_y / width / height / **is_open** / created_at / updated_at / deleted_at |
| `todos` | **新增** | id / title / planned_at / remind_at / **reminded_at** / done_at / sort_order / created_at / updated_at / deleted_at |

**迁移铁律**（SQLite 无 `ADD COLUMN IF NOT EXISTS`）：
```
0001_init → infra/migrate.rs::ensure_column（先加列，PRAGMA table_info 守卫幂等）
          → schema-V0.2.0.sql（建表+索引+seed，全 IF NOT EXISTS）→ 置 version=2
```
**约束**：`todos` 不与 `items` 建外键；`notes.item_id` 可空（可为独立随记）。

---

## 7. 页面清单（锁定 — 14 个视图）

| 视图 | 状态 | 对应命令 | 设计令牌主题 |
|------|------|----------|--------------|
| pill-bar 药丸条 | 改造 | startTimer/pause/resume/stopTimer/getTimerState | 双主题 |
| collapsed 收起态 | 保留 | — | 双主题 |
| context-menu 上下文菜单 | 改造（自绘玻璃） | — | 双主题 |
| **tray-menu 托盘菜单** | 改造（**原生 + 按状态裁剪**） | — | **跟随系统**（K-29） |
| records-panel 记录面板 | 保留 | listRecords/statsSummary | 双主题 |
| settings-panel 设置面板 | 改造（三页签：外观配色/扩展/通用） | getSettings/updateSettings/theme*/accent* | 双主题 |
| recover-dialog 崩溃恢复 | 保留 | resolveOpenRecord | 双主题 |
| undo-bar 撤销条 | 保留 | undoStop | 双主题 |
| **todos-panel 事项窗口** | 新增 | todo*/listRecords/statsSummary | 双主题 |
| **sticky-note 便利贴** | 新增（独立多窗口） | note*/openNoteWindow | 双主题 |
| **reminder-popover 提醒** | 新增 | reminder* | 双主题 |
| **theme-picker 主题/配色** | 新增 | theme*/accent* | 双主题 |
| **countdown-menu 时长菜单** | 新增 | startCountdown/setCountdownPreset | 双主题 |
| **common-items 常用事项** | 新增 | listItems/startTimer | 双主题 |

---

## 8. 设计 Token（锁定）

> 完整 Token 见 `docs/design/design-tokens-V0.2.0.{json,css}`。前端**必须** import 引用，禁硬编码。

- **方向**：Ambient Instrument 玻璃仪表（深/浅双主题）
- **主色**：Accent Blue `#4DA3E8`（浅色派生 `#1669AD`）
- **语义色**：warn `#E8A33D` / danger `#E5484D` / ok `#4CC38A`
- **四色可配**：`--color-running / --color-warn / --color-done / --color-bar`
- **浮层令牌**：`--bg-plate #0E0F12` / `--bg-panel #0E1015` / `--bg-card #14161C` / `--bg-field #1B1E25` / `--bg-field-hi #232833`
- **ink 四档**：`#F2F3F5` / `#C9CED8` / `#8B93A2` / `#7A8292`
- **字体**：Microsoft YaHei UI（中文层级**只用 {400,700}** + 字号/颜色/字距承载；`font-synthesis-weight:none`）；等宽数字走 `--font-mono`
- **圆角**：6 / 10 / 12 / 14 + 胶囊 h/2
- **图标**：lucide-react，16 / 20 / 24px，**禁 emoji**
- **药丸条几何**：高 34 / 色环 ⌀22（stroke 2.6）/ 圆角 h/2 / 宽 116–288
- **玻璃范围**：应用内菜单 · 便利贴 · 事项窗口 · 提醒卡（**主小条、系统托盘菜单除外**）

---

## 9. 验收标准（锁定 — QA 唯一依据）

- **AC-01 ~ AC-27**：V0.1.0 既有（见 `docs/Spec-v1.md` §9，本次不重排）
- **AC-28 ~ AC-64**：V0.2.0 增量 **共 37 条**，EARS 格式全文见 `PRD-V0.2.0.md` §验收标准

> **口径修订（2026-10-16，批1 回归 QA 后 · team-lead 裁定）：**
> - **AC-56 收窄**：原「三处自绘（小条 / 事项 / **托盘**）」→ **仅小条右键 / 事项右键两处**使用同一套自绘玻璃菜单（键盘 `↑↓` / `Enter` / `Esc` 可达）；**托盘菜单保留系统原生**（按状态裁剪，键盘由 OS 提供）。依据 **ADR-013**（用户裁决）。原「三处」表述作废，`PRD-V0.2.0.md` §4 待 PM 同步。
> - **AC-53 口径**：`正文 ≥4.5:1` 覆盖**所有可达态**（含 hover / 强调态）；浅色 `ink-4` 与 `warn/danger/ok` 均已加深至对**最坏底 `--bg-plate`** ≥4.5:1（见 `DESIGN-V0.2.0.md` §8.2）。
> - **AC-32 落地方式**：删除待办 = 直接软删（乐观删除 + 延迟提交）+ 底部 3s 撤销条，**不弹阻塞式确认**；**不新增 `todoRestore`**（待办域锁定 5 命令）。

> **口径补充（2026-10-16，批2 回归 QA 后 · team-lead 裁定）：**
> - **AC-38 便利贴入口口径**：便利贴三个入口统一——① **小条右键「便利贴…」→ 绑当前计时事项**（`session.itemId`；空闲时绑当前选中事项）；② **事项右键「便利贴…」→ 绑该事项**；③ **托盘「便利贴…」/通用新建 → 随记**（`item_id=null`，页脚可再「关联事项」）。三条路径均满足「一便利贴仅关联一个事项或解绑为随记」（AC-63）。**AC-38「默认绑定当前计时事项」由入口①满足**（批2 回归 QA 首轮曾判此项字面未达标，据此补入口后达标）。

> **QA 测试时须逐条核对 AC-01~64（共 64 条）；P0 缺陷必须归零方可进入部署。**

---

## 10. 边界与约束

- 仅 Windows x64；不支持 IE/旧 Edge
- 响应式：非响应式（桌面固定窗口），但须适配 **DPI 0.8/1.0/1.4/1.5 四档**无重叠无裁切
- 性能：空闲内存 <80MB（含多窗口）、冷启动 <2s
- 便利贴：硬钳制 160×120–900×900（运行时再被 work_area 收窄）+ 舒适上限 640×480 软提示
- 多窗口上限：便利贴 **20 个**
- 无障碍：正文 ≥4.5:1，非文本 ≥3:1（深/浅两套均需过）
- 数据：迁移幂等，老库升级不丢数据

---

## 11. 内嵌已知坑（从项目记忆与架构文档拉取）

| 编号 | 坑 | 修法 |
|------|----|------|
| K-1 | 透明窗首屏白闪 | `visible:false` + 就绪握手；`html{background:var(--bg)}`；内联引导脚本只设 `data-theme` |
| K-2 | drag-region 需 capabilities 放行 | 逐项放行 |
| K-13~K-18 | V0.2.0 新增（多窗口 label 冲突 / 几何 DPI / 主题广播 / 便利贴焦点…） | 见 ARCHITECTURE §9 |
| K-19 | 提醒重复弹（每 15s tick） | `reminded_at` 去重标记 |
| K-24 | 原生托盘菜单失去玻璃与状态块 | **已接受**（用户裁决） |
| K-25 | 方案 B 自绘（未采纳）的多屏/失焦风险 | 本期 N/A，仅 v0.3+ 启用时适用 |
| K-29 | 原生托盘菜单跟随 OS 明暗、**不随应用 data-theme** | **已接受的局限** |
| K-1~K-12 | V0.1.0 既有 | 见 Spec-v1 / ARCHITECTURE-v1 §9 |

> 完整 K-13 ~ K-29 见 `ARCHITECTURE-V0.2.0.md` §9。

---

## 12. 端到端验证步骤

```bash
# 1. 安装 + 构建
cd tickbar && npm install && npm run build
cd src-tauri && cargo check && cargo test

# 2. 启动（dev）
npm run tauri dev

# 3. 核心成功流
#    - 左键小条 → 开始计时；小条随事项名伸缩（116–288）
#    - 切换主题（深/浅/system）→ 所有已开窗口同步变色，无白闪
#    - 改四色可配 → 小条/提醒/完成色即时生效
#    - 新建待办 → 事项窗口出现该条；勾选完成 → 状态变
#    - 新建便利贴 → 独立窗口出现；拖动/缩放 → 重启后位置恢复
#    - 设提醒（+1min）→ 到点弹系统通知；再等 15s → 不重复弹

# 4. 关键错误流
#    - 便利贴超过 20 个 → 开第 21 个返回 WINDOW_LIMIT_EXCEEDED
#    - 倒计时目标 ≤0 → INVALID_TARGET_SEC
#    - accentSet 传非法 hex → INVALID_COLOR
#    - 运行中崩溃 → 重启走 recover-dialog，选 discard 后唯一槽释放

# 5. P0 门禁扫描
#    - emoji 正则扫全部 .tsx/.ts/.css/.html → 0 命中
#    - 裸色值扫描 → 0 命中（令牌层除外）
```

---

## 13. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-10-16 | V0.2.0 立项：UI 对标 Timing v1.7.0 + 新增 10 项功能 | 用户需求变更 | 全量：3→5 表、29→52 命令、9→14 视图、令牌整体重做 |
| 2026-10-16 | 托盘菜单裁定为「原生 + 按状态裁剪」 | 用户裁决（成本收益） | ADR-013 改方案 A；玻璃范围收紧；新增 K-24/K-29 |
| 2026-10-16 | 小条空闲态确立为「不复刻最宽」 | 用户裁决 | pill-bar 设计 |
| 2026-10-16 | 交付拆两批 | 用户裁决 | 排期 |
| 2026-10-16 | 插件系统缓到 v0.3 | 用户裁决 | Out-of-Scope |
| 2026-10-16 | 批1 回归 QA 后口径修订：AC-56 收窄为「两处自绘 + 托盘原生」、AC-53 明确覆盖 hover 等可达态、AC-32 落地为「软删 + 撤销条」 | QA 判 AC-56/AC-32 未达标，实质是 Spec/PRD 与 ADR/设计稿的跨文档冲突 | Spec §9 口径块；`PRD-V0.2.0.md` §4 待 PM 同步 |
