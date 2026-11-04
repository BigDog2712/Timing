# QA 报告 — Timing V0.2.0 批 1 回归 QA（**含定向复验终版**）

- 文档 ID：`docs/phase4/QA-REPORT-V0.2.0-BATCH1.md`（与 V0.1.0 报告 `QA-REPORT.md` 并列，不覆盖）
- 验证人：严过关（测试工程师，mvp-dev-expert-team-qa）
- 日期：2026-10-16（**复验更新**：2026-10-16，AC-32/53/54 + 保真定向复验后）
- 批次：V0.2.0 **批 1「一眼就是 Timing」**（Wave A 视觉对齐 + Wave B 待办 / 事项窗 / 自绘菜单）
- 唯一验收依据：`docs/Spec-V0.2.0.md` §9（AC-28~64，含**新增口径修订块**）/ `docs/phase1/PRD-V0.2.0.md` §4（EARS 全文）
- 辅助依据：`docs/phase1/ARCHITECTURE-V0.2.0.md`、`docs/phase2/schema-V0.2.0.sql`、`docs/Spec-v1.md`（AC-01~27 回归）、`docs/phase4/QA-REPORT.md`（V0.1.0 基线）、`docs/design/DESIGN-V0.2.0.md`（§8.2 对比度 / §10.2 派生）、`src/types/domain.ts` + `domain-v020.ts`（契约事实源）
- 复验小结：`docs/phase4/QA-V0.2.0-BATCH1-REVERIFY.md`
- 知识库引用（逐条读取并落地）：`01-standards/test-discipline.md`、`test-integrity-anti-gaming.md`、`verifier-critic-pattern.md`、`generated-code-failure-modes.md`、`production-readiness-scorecard.md`（专家包 2.1.1）
- 环境：Windows / node v22.22.2 / cargo 1.99.0（`-j 2`，规避 tokio-stream ICE）

---

## 0. 结论摘要（TL;DR）

| 项 | V0.1.0 基线 | 批 1（首轮） | **批 1（复验终版）** |
|----|------------|-------------|---------------------|
| 后端测试 | 68 passed / 0 failed | 122 passed / 0 failed / 0 ignored | **122 passed / 0 failed / 0 ignored**（`-j 2`，EXIT=0） |
| `cargo fmt --check` / `clippy` | — | EXIT=0 / 0 warning | **EXIT=0 / 0 warning** |
| 前端 `tsc --noEmit` / `npm run build` | EXIT=0 / EXIT=0 | EXIT=0 / EXIT=0 | **EXIT=0 / EXIT=0**（2011 modules） |
| P0 扫描（emoji / 紫粉 / 弹跳 / 模板味 / 裸色值） | 0 命中 | 0 命中 | **0 命中** |
| 本波 AC 判定（AC-28~37、51~60 共 20 条） | — | 通过 11 / 部分 6 / 不通过 1 | **通过 15 / 部分 4 / 不通过 0**（另 AC-56 相对 EARS 原文不通过、已由锁定 Spec 授权收缩） |
| 回归（V0.1.0 AC-01~27 相关测试） | — | 零回归 | **零回归**（68 基线测试全绿，逐一核验） |
| **P0 缺陷** | 0 | 0（AC-32 归 P1） | **0**（AC-32/53/54 三条 P0 级 AC **全部闭环**） |
| P1 缺陷 | 1 残余 | 2（D-B1-01/02） | **0 未闭环**（D-B1-01/02 均已修复复验） |
| **测试完整性反作弊** | 通过 | 通过 | **通过**（断言 321 未弱化、无 skip、无门禁篡改） |
| 生产就绪档 | Bronze | Bronze | **Bronze**（未达 Silver，不交付商业生产） |
| 批 1 门禁 | — | 有条件放行 | **通过**（含真机待验项） |

> **终版核心结论：** 机械门禁**全绿**；后端 122 测试（含批 1 新增 54）零失败，V0.1.0 **零回归**，P0 视觉规则零命中。首轮发现的 3 条 P0 级问题经 team-lead 深挖修复后，本轮**定向复验全部通过**：
> - **AC-32**（首轮判不通过）：删除待办改「**直接软删 + 3s 撤销条**」——无阻塞确认、撤销不落库、超时/隐藏/退出落库、后端**仍 5 命令**（守 Spec §5 → **改判通过**）。
> - **AC-53**（首轮部分通过）：浅色 `ink-4`/语义色 + **深色 `--danger-solid`** + **hover 可达态**复算全部 ≥ 目标（正文 4.5 / 非文本 3）→ **改判通过**。
> - **AC-54**（首轮**误判通过**：只验了「注入变量」漏验「消费者」）：`--color-warn` 消费者 **0→2**（`--todo-overdue` + 提醒铃），四语义色均有真实消费者 → **通过（静态；真机点色待验）**。
>
> **P0 缺陷归零**；批 1 由「fail（有条件放行）」转「**通过**」。仍为 Bronze（短板：前端零自动化测试 / 无 CI），故**通过 ≠ 可上商业生产**；真机项明标**待真机**。

---

## 0b. 定向复验摘要（本轮 · 3 条 P0 级 AC + 保真）

> 复验由 QA **独立复跑 + 独立复算**（不采信生产者自证脚本/转述数字）；详见 `QA-V0.2.0-BATCH1-REVERIFY.md`。

| 目标 | 首轮 | **复验** | 证据（独立复跑） |
|---|---|---|---|
| **AC-32** | ❌ 不通过 | **✅ 通过** | 无阻塞确认（`PendingRowMode` 去 `confirm`）；`UNDO_WINDOW_MS=3000`；`undoRemove()` 纯本地；`commitPending()` 落库 + `useTodoDeleteFlush`（hidden/beforeunload）兜底；连续删只留最后一条；`lib.rs` 待办 **5 命令**、无 `todo_restore` |
| **AC-53** | ⚠️ 部分 | **✅ 通过** | 浅色 ink-4/warn/danger/ok = 4.636/4.618/4.624/4.623（对 `--bg-plate`）；深色 `--danger-solid #E1292F` + 白字 = **4.606**（旧 3.914）；hover 危险项文字回退 `--ink`（深 15.52 / 浅 13.38，图标均 ≥3） |
| **AC-54** | ✅（误判） | **✅ 通过（静态）** | `var(--color-*)` 四令牌均有真实消费者；`--color-warn` 0→2（`--todo-overdue` → 逾期文字 + 提醒铃） |
| **保真** | — | **✅ 通过** | `applyAccents`：值 == 出厂默认 → `removeProperty()` 回落分主题令牌（出厂像素 = 审计值） |

> ⚠️ **AC-54 验证边界**：`--color-warn` 两处消费者**均条件渲染**（铃需 `remind_at`、逾期文字需 `planned_at < now`），而**批 1 UI 无入口设置 `planned_at`/`remind_at`** ⇒ 批 1 常规流程下改「提醒色」可能无可见像素变化。此为**可达性边界**（批 2 补输入后可达），非 AC-54 违反；**真机点色仍待验**。

---

## 1. 测试执行记录（真实命令 / 输出 / 退出码）

> 全部由 QA **独立执行**。耗时命令以 `run_in_background` 执行。

### 1.1 后端门禁（`cd src-tauri`）

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `cargo fmt --check` | **0** | 无 diff |
| `cargo clippy -j 2 --all-targets` | **0** | **0 warning**（touch `lib.rs` 触发重编后 `grep -c "^warning"` = 0） |
| `cargo test -j 2` | **0** | `test result: ok. 122 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out` |

> ⚠️ 依据 V0.1.0 结论（E-01），必须带 `-j 2`，否则默认并行编 `tokio-stream` 触发 `STATUS_ACCESS_VIOLATION`。

### 1.2 前端门禁（`cd timing`）

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `npx tsc --noEmit` | **0** | 无类型错误 |
| `npm run build` | **0** | `✓ 2011 modules transformed`；js 317.13 kB(gzip 97.35) / css 46.36 kB(gzip 8.91) |

### 1.3 测试分布（12 文件 / 122 用例）

| 模块 | 文件 | 用例数 | 归属 |
|---|---|---|---|
| 计时状态机 | `tests/timer.rs` | 27 | V0.1.0 基线 |
| 事项业务 | `tests/item.rs` | 11 | V0.1.0 基线 |
| 记录域 | `tests/record.rs` | 11 | V0.1.0 基线 |
| 迁移与约束 | `tests/migration.rs` | 9 | V0.1.0 基线 |
| 多显示器几何 | `tests/window_geometry.rs` | 10 | V0.1.0 基线 |
| **基线小计** | | **68** | = V0.1.0 报告记录值（精确吻合） |
| 主题 / 四色 / 预设 | `tests/theme.rs` | 11 | 批 1 新增 |
| V1→V2 迁移 | `tests/migration_v2.rs` | 5 | 批 1 新增 |
| 待办域 | `tests/todo.rs` | 15 | 批 1 新增 |
| 托盘菜单构造 | `tests/tray_menu.rs` | 15 | 批 1 新增 |
| 多窗口规格 | `tests/window_spec.rs` | 8 | 批 1 新增 |
| **新增小计** | | **54** | |
| **合计** | | **122** | |

### 1.4 契约一致性（复核）

| 核验项 | 期望 | 实测 | 结论 |
|---|---|---|---|
| `lib.rs` 注册命令数 | 40（Spec §5 的 52 中批 1 交付 29+11） | **40** | ✅ |
| **待办域命令数** | **5**（`todo_create/update/delete/list/toggle`） | **5**，**无 `todo_restore`** | ✅（守 Spec §5 五命令锁） |
| `domain.ts::IpcApi` / `ipc.ts` 方法数 | 52 / 52 | 52 / 52 | ✅ |
| `error.rs` 错误码数 | 16（11+5） | 16 | ✅ |
| `theme-changed` 广播 | theme_set/accent_set 后 emit | `theme_cmd.rs:28,46` | ✅ |
| 组件内裸 `invoke` | 0（K-11） | 仅 `services/ipc.ts` | ✅ |
| 前端测试框架 | （应引入） | **无** | ❌ 短板（见 §9） |

---

## 2. 改动影响分析（复验波次）

### 复验波次改动范围（team-lead 深挖修复）
- **AC-32（前端）**：`stores/todoStore.ts`（`remove/undoRemove/commitPending` + `pendingDelete`）、`hooks/useTodoDeleteFlush.ts`（新）、`components/todos/{TodoUndoBar,TodosPendingRow,TodosPanel,TodosWindow}.tsx`、`styles/todos-pending.css`。
- **AC-53/54（设计 + 前端）**：`styles/design-tokens.css`（ink-4/warn/danger/ok 加深 + `--danger-solid` 分主题 + `--todo-overdue`）、`styles/todos-panel.css`（提醒铃 `var(--color-warn)`）、`styles/menu.css`（危险项 hover 文字回退 `--ink`）、`docs/design/{DESIGN-V0.2.0.md,design-tokens-V0.2.0.*}`。
- **保真（前端）**：`lib/theme.ts::applyAccents`（默认态不写内联）。

### 下游影响面（复验关注点）

| 旧行为 | 风险等级 | 复验结果 |
|---|---|---|
| 待办删除/列表/排序（批 1 新增） | **高** | ✅ 5 命令契约不变；`todo.rs` 15 例全绿 |
| 四色注入 → 主题切换（AC-51/52） | **高** | ✅ `applyAccents` 改为「默认不派生」；`tsc/build` 绿；`theme.rs` 11 例全绿 |
| 药丸条底色（`--pill-bg ← --color-bar`） | 中 | ✅ 消费者链完好（`surfaces.css:21`） |
| 事项窗逾期/铃铛（`--todo-overdue`/`--color-warn`） | 中 | ✅ 消费者链 0→2；⚠️ 批 1 UI 可达性受限（见 §0b 边界） |
| 迁移幂等 / 计时状态机（V0.1.0） | **高** | ✅ 122 全绿，**零回归** |

### 回归测试优先级
1. 待办域 + 四色/主题（高风险）→ **必测** ✅
2. 迁移幂等 + 计时状态机（高风险）→ **必测** ✅
3. 药丸条几何 / 事项窗渲染（中风险）→ **应测** ✅（渲染为真机项）

---

## 3. AC-28 ~ AC-37 与 AC-51 ~ AC-60 逐条判定（复验终版）

判定口径：**通过**=代码级可完全判定满足；**部分通过**=主体验收达标但含「无法无头观测」子句或条件可达边界；**不通过**=代码级可判定违反；**无法验证（待真机）**=纯 GUI 渲染/真实桌面交互（**如实标注，不凭代码存在判通过**）。

### N-1 小条随事项名伸缩

| 编号 | 判定 | 依据 / 证据 |
|---|---|---|
| **AC-28** P0 | **通过 ✅** | 令牌 `--pill-w-min:116` / `--pill-w-max:288` / `--task-w-max:164`（`design-tokens.css:72-74`）；`.pill{min/max-width}`、`.pill__name{max-width:var(--task-w-max); text-overflow:ellipsis}`（`surfaces.css`）。 |
| **AC-29** P0 | **通过 ✅** | `.timer-digits{font-variant-numeric:tabular-nums; min-width:53px; text-align:right}`；`[data-hours=true]{min-width:72px}`（`design-tokens.css:380-395`）。 |

### N-2 待办事项

| 编号 | 判定 | 依据 / 证据 |
|---|---|---|
| **AC-30** P0 | **通过 ✅** | `todos` 表持久化；`tests/todo.rs::create_persists_planned_and_remind_at` 往返同值；文件库。 |
| **AC-31** P0 | **通过 ✅** | `todo::toggle(id, done)` **显式传 done**（非盲翻转）；`toggle_is_state_idempotent_and_reversible`。 |
| **AC-32** P0 | **✅ 通过（复验改判）** | 删除 =「**直接软删 + 3s 撤销条**」：① 无阻塞确认（`PendingRowMode='view'\|'edit'`，`TodosPendingRow.tsx:24`；`InlineConfirmBar` 仅剩**事项**删除用）；② `UNDO_WINDOW_MS=3000`（`domain.ts:62`）起窗；③ 撤销 `undoRemove()` **纯本地**不落库；④ `commitPending()` 超时/隐藏/退出落库（`todoStore.ts:147-149` + `useTodoDeleteFlush`，挂载 `TodosWindow.tsx:26`）；⑤ 连续删除只留最后一条（`remove()` 先提交前一条）；⑥ 后端**仍 5 命令**、无 `todo_restore`。**首轮「不通过」作废。** |
| **AC-33** P0 | **通过 ✅** | `pendingTone()` 三分语气：`overdue→--todo-overdue`（=`--color-warn`）/`none→--todo-no-time`（ink-4）/`normal`；进行中由 `--accent` 竖条表达。 |

### N-3 事项窗口（四状态清单）

| 编号 | 判定 | 依据 / 证据 |
|---|---|---|
| **AC-34** P0 | **部分通过 ⚠️** | 表头结构 + 分层**通过**；**「300ms 内」→ 待真机**（无头不可测时延）；「待进行」并入待办区（§6 P-1，数据模型约束，语义可达）。 |
| **AC-35** P0 | **部分通过 ⚠️** | 四态视觉代码级齐备（已完成 `--ok` 实心 + 时长删除线；进行中竖条 + 提亮；待进行常规；待办三级语气）；**「灰度打印可区分」→ 待真机**。 |
| **AC-36** P0 | **通过 ✅** | `TodosEmpty` 图标块 + 两行文案 + 可点按钮；非空白页。 |
| **AC-37** P0 | **部分通过 ⚠️** | 源码级通过（`remindAt!=null` → lucide `BellIcon` 12px，**SVG 非 emoji**）；**触发态 → 待真机/批 2**（批 1 无设置提醒入口）。 |

### N-8 深浅双主题

| 编号 | 判定 | 依据 / 证据 |
|---|---|---|
| **AC-51** P0 | **通过 ✅** | `<html data-theme>` + 双套变量；`theme_set/accent_set` → emit `theme-changed`；各窗自订阅（主窗/设置窗/事项窗）；即时生效 + 持久化；防白闪引导脚本。 |
| **AC-52** P0 | **通过 ✅** | `deepenForNonText` 保色相加深；`applyAccents` 仅浅色派生、仅写 CSS 变量、**不动用户原值**。 |
| **AC-53** P0 | **✅ 通过（复验改判）** | QA 独立复算（WCAG 2.1）：浅色 ink-4 `#656E7D`=**4.636** / warn `#A05E00`=4.618 / danger `#D02C33`=4.624 / ok `#0C7E47`=4.623（对最坏底 `--bg-plate`）；深色 ink-4=4.961 / warn=8.887 / danger=4.897 / ok=8.652；**深色 `--danger-solid #E1292F` + 白字=4.606**（旧 `#E5484D`=3.914 陷阱已修）；**hover 可达态**（危险项文字回退 `--ink`）深 15.52/浅 13.38、图标 4.40/3.87（≥3）；hover 纯图标按钮 `.todo-pend__act--danger:hover`（非文本）深 4.402/浅 3.869（≥3）。旧浅色值 3.908–4.337（证明修复前确不达标）。**首轮「部分通过」作废。** |

### N-9 四色可配

| 编号 | 判定 | 依据 / 证据 |
|---|---|---|
| **AC-54** P0 | **✅ 通过（静态证据充分；真机点色待验）** | `grep -rn "var(--color-" src/` 逐条确认**四语义色均有真实消费者**：`--color-running`→`.ring/.dot[data-state=running]`；`--color-done`→`.ring/.dot[data-state=ended]`；`--color-bar`→`--pill-bg`→`.pill` 底；**`--color-warn`→`--todo-overdue`→`.todo-pend[data-tone=overdue]` 文字 + 提醒铃**（0→2）。链路：`themeActions.setAccent`（前端拦非法 hex）→ `accent_set` 落库 → `themeStore.apply` 即时写 `--color-*` → emit 广播。⚠️ **边界**见 §0b：`--color-warn` 两处消费者条件渲染、批 1 无入口设 planned/remind → 真机点色待验。 |
| **AC-55** P0 | **通过 ✅** | `SwatchRow`：`.swatch__dot` + `.swatch__name` + `.swatch__hex`（独立元素，等宽 `--font-mono`）。 |

### N-10 自绘玻璃菜单

| 编号 | 判定 | 依据 / 证据 |
|---|---|---|
| **AC-56** P0 | **⚠️ EARS 原文不通过 / 已由锁定 Spec 授权收缩** | 小条右键 + 事项右键两处自绘玻璃菜单（键盘 ↑↓/Enter/Esc ✅）；**托盘保留系统原生 Win32**（ADR-013 / Spec §4 §7 / K-24 K-29，**用户裁决**）。→ 相对 EARS 原文不满足，相对**已锁定 Spec** 为**授权收缩**（见 §7），**不计缺陷**。 |
| **AC-57** P0 | **通过 ✅** | 外点关闭 + Esc/Tab 关闭；托盘按真实状态裁剪（`tests/tray_menu.rs`）。 |
| **AC-58** P0 | **部分通过 ⚠️** | 按最长项撑宽 + 不换行；但保留 `overflow:hidden; text-overflow:ellipsis` 截断兜底 → 极端长项仍会省略（批 1 项均短，长项属批 2）。 |

### 跨功能

| 编号 | 判定 | 依据 / 证据 |
|---|---|---|
| **AC-59** P0 | **通过 ✅** | emoji 正则扫 `src`+`index.html`（含 `FE0F/1F000-1F64F/1F680-1F6FF/1FA00-1FAFF/2713/2714/26A0/274C`）**0 命中**；图标全经 `lib/icons.ts`（lucide-react 唯一图标库）。 |
| **AC-60** P0 | **通过 ✅** | 三页签（外观配色/扩展/通用）；`SegmentedTabs` `role=tablist/tab` + ←→；控件自绘。 |

**统计（复验终版）：通过 15 / 部分通过 4 / 不通过 0（另 AC-56 = EARS 原文不通过但已授权收缩）—— 共 20 条。**
- 通过：AC-28,29,30,31,**32**,33,36,51,52,**53**,**54**,55,57,59,60 = **15**
- 部分通过：AC-34,35,37,58 = **4**（其中 AC-34/35/37 含「待真机」子句）
- 不通过：**0**
- 相对 EARS 原文不通过（已授权收缩）：AC-56 = 1

---

## 4. 回归结论（确认未破坏 V0.1.0）

- 全量 `cargo test -j 2` → **122/122 绿**；V0.1.0 基线 5 文件 68 例（27/11/11/9/10）**逐一存活且通过**（无删用例）。
- 关键回归用例存活核验：`unique_active_session_enforced`、`resolve_discard_frees_single_active_slot`、`undo_blocked_when_a_new_session_is_active`、`resolve_resume_resets_running_since_without_gap`、`resolve_close_uses_last_flushed_without_gap`、`fully_outside_moves_to_primary_workarea_center`、`rect_larger_than_workarea_is_shrunk_and_centered`、`clamped_result_is_stable`、`missing_primary_falls_back_to_first_monitor`、`migration_is_idempotent` —— **全部在**。
- **回归率 = 0**。
- 迁移幂等（K-13）：`migration_v2::v1_database_upgrades_in_place` + `init_pool_is_idempotent_at_v2` 全绿。

---

## 5. 失效模式核对（生成式代码 6 类）

| 失效模式 | 结果 | 说明 |
|---|---|---|
| Happy-path 偏差 | ✅ 未见 | 待办/主题错误分支有测试；前端 Loading/Empty/Error 态齐。 |
| **沉默逻辑错误** | ✅ 未见 | 强断言不变式：toggle 显式 done、`from` 含 `to` 不含、迁移列守卫、**AC-32 撤销不落库**（`undoRemove` 无 IPC）、**AC-54 消费者存在性**（消除了上轮「注入但零消费者」的沉默失效）。 |
| **幻觉依赖/接口** | ✅ 未见 | 版本锚定；`cargo check`/`tsc`/`build` 全绿；`--color-warn` 消费者已实存（非幻觉令牌）。 |
| 缺失系统上下文 | ✅ 已覆盖 | capabilities 最小白名单；多窗口工作区钳制；零网络。 |
| 性能盲区 | ⚠️ 未测 | AC-34「300ms」/冷启动/内存未实测（真机项）。 |
| 静默缺失（import/未用） | ✅ 未见 | `clippy 0 warning`、`tsc noUnusedLocals` 全绿；`useTodoDeleteFlush` 已挂载（非悬空 hook）。 |

---

## 6. 缺陷清单（复验终版）

### 6.1 P0（致命）—— **0 个** ✅

### 6.2 P1（严重）—— **0 个未闭环**（首轮 2 项均已修复复验）

| ID | 首轮描述 | **复验状态** | 证据 |
|---|---|---|---|
| **D-B1-01** | AC-32 未实现 undo | **✅ 已修复 → 关闭** | 删除待办改「直接软删 + 3s 撤销条」；AC-32 转通过（§3） |
| **D-B1-02** | 浅色主题对比度边界未达标 | **✅ 已修复 → 关闭** | 浅色四色 + 深色 `--danger-solid` + hover 可达态复算全部 ≥ 目标（§3/§0b） |

### 6.3 P2（一般 / 记录）

| ID | 描述 | 证据 |
|---|---|---|
| **D-B1-03** | 单文件 >300 行：`tests/timer.rs` 494（既有测试）/ `types/domain.ts` 596（类型数据）/ `styles/design-tokens.css` 432（令牌数据） | `wc -l` |
| **D-B1-04** | `components/records/RecordRow.tsx` 存在原生 `<select>`（V0.1.0 遗留，非批 1 范围） | grep |
| **D-B1-05** | AC-36 空态按钮文案/语义（「＋新增待办」vs PRD 措辞「开始按钮」） | `TodosEmpty.tsx` |
| **D-B1-06** | AC-52 运行时加深（`#4593D1`）与设计文档声称（`#1669AD`）不一致（均 ≥3:1，算法口径差异） | `deepen.mjs` |
| **D-B1-07（新）** | `--color-warn` 消费路径（铃铛 / 逾期文字）在**批 1 无 UI 入口触发**（planned/remind 输入属批 2）→ 真机点色可达性受限 | §0b 边界 |

### 6.4 待裁定项（沿用首轮，已归档）

- **P-1**：设计稿「待进行」分区 vs 实现并入待办区 → **不记缺陷**（数据模型约束，语义可达）。
- **OPEN-DECISIONS（title 超长复用 `ITEM_NAME_EMPTY`）**：**可接受的技术债**（错误码闭集契约硬约束 + 复用同码明确 message + 前端 maxLength 双保险）。

---

## 7. AC-56 与 Spec 的偏差说明（非缺陷）

- EARS 原文要求三处菜单统一自绘；**已锁定 Spec**（§4/§7/§11 K-24/K-29 + ADR-013，**用户裁决**）令**托盘保留原生**。QA 以锁定 Spec 为准 → 降级为「两处自绘 + 托盘原生」，**不记缺陷**，建议正式改写 AC-56 措辞。

---

## 8. 测试完整性反作弊（test integrity）

> 本仓库**非 git**；以「V0.1.0 报告记录基线 vs 当前实测」+「非业务改动显式披露」替代 diff。

| 检测项 | 结果 | 证据 |
|---|---|---|
| 测试文件/用例被删 | ✅ 无 | 基线 5 文件 68 例**精确仍在**；68 → 122 净增 54 |
| 保留测试的断言数下降 | ✅ 无 | `assert!/assert_eq!/assert_ne!` = **321（与首轮一致，未弱化）** |
| 新增 skip/xfail/.only/`#[ignore]` | ✅ 无 | grep → **0 命中** |
| 测试断言硬编码实现自身输出 | ✅ 无 | 断言取自契约（错误码、`from` 含 `to` 不含、几何 `Rect`、JSON 往返） |
| 测试框架配置篡改 | ✅ 无 | `package.json` scripts 仅 dev/build/typecheck/preview/tauri（无 test、无阈值可降）；`tsconfig` strict 未放松；`Cargo.toml` 未新增依赖 |
| 业务代码被 QA 改动 | ✅ 零 | 复验波 QA **仅读源码 + 复跑**，未改任何业务/测试文件 |
| 门禁阈值/豁免被调低 | ✅ 无 | 无覆盖率阈值、无 lint 豁免 |

> 复验波**未新增任何测试**（可自动化项已被现有 122 覆盖；AC-32 撤销链路属**前端交互**，仓库无前端测试框架 → 记入 §11 回归集建议）。**AC-53/54 的独立复算脚本与消费者 grep 为 QA 自建证据，未落业务测试目录。**

---

## 9. 生产就绪评级（7 维 × 3 档 · 复验终版）

| 维度 | V0.1.0 | 首轮 | **复验** | 证据 |
|------|--------|------|---------|------|
| 测试 + 回归 | Bronze | Bronze | **Bronze** | 后端 122 全绿、回归 0；**仍无前端自动化测试、无 CI** |
| 契约 | Silver | Silver | **Silver** | 52/52/40/16 契约核验；待办域 5 命令锁 |
| 安全 | Silver | Silver | **Silver** | 纯本地、capabilities 最小白名单、CSP、零网络 |
| 无障碍 | Bronze | Bronze | **Bronze（对比度已达标）** | AC-53 后对比度达 AA；距 Silver 差「自动扫描 0 阻断 / 屏读走查」 |
| 性能 | Bronze | Bronze | **Bronze** | 300ms/冷启动/内存未实测 |
| 可观测 | Bronze | Bronze | **Bronze** | 有错误态；无结构化日志/指标/SLO |
| 发布安全 | Bronze | Bronze | **Bronze** | 可卸载；无渐进发布/回滚演练 |
| **总档（取最低）** | Bronze | Bronze | **Bronze** | **未达 Silver ⇒ 不交付商业生产** |

---

## 10. 批 1 门禁结论（复验终版）

**判定：通过（含真机待验项）。**

- **无阻断项**：首轮 D-B1-01（AC-32）/ D-B1-02（AC-53）**均已闭环**；机械门禁全绿；回归率 0；P0 缺陷 0；AC-32/53/54 三条 P0 级 AC **全部转通过**。
- **放行范围**：允许进入**批 2 开发**；并可作为**内测基线**。
- **不放行范围**：**商业生产上线**（总档 Bronze，未达 Silver；且真机项未验）。
- **真机验收清单**：AC-01 启动即见药丸 / AC-34 面板 <300ms / AC-35 灰度四态可辨 / AC-37 铃铛可触发 / AC-51 各窗同步无白闪 / **AC-54 点色即时生效（尤其「提醒色」，建议先造带 planned/remind 的待办）**。

---

## 11. 回归集建议（沉淀）

| 建议回归用例 | 对应风险 | 落点 |
|---|---|---|
| 待办删除撤销（乐观删 + 撤销窗 + 兜底提交） | AC-32 / D-B1-01 | **前端组件测试**（需引入测试框架后补） |
| **四语义色消费者存在性**（`--color-*` 均被组件引用） | AC-54 / D-B1-07 | 可脚本化 grep 门（CI） |
| 浅色/深色令牌对比度（AC-53） | D-B1-02 | 扩展 `_ac53_selfcheck.mjs` 为 CI 门（令牌断言） |
| 迁移 v1→v2 幂等 | K-13 | 已在 `tests/migration_v2.rs` |
| 托盘按状态裁剪 | AC-57 | 已在 `tests/tray_menu.rs` |
| 冷启动可见（D-01/D-07） | AC-01 | 引入前端框架后补组件/E2E |

---

## 12. 上线建议（复验终版）

**判定：批 1 复验通过 —— 生产就绪档位 Bronze。**

1. 3 条 P0 级 AC（AC-32/53/54）**全部闭环**，P0 缺陷归零、回归归零、门禁全绿。
2. 首轮阻塞项消除；批 1 由「fail（有条件放行）」转「**通过**」。
3. 未达 Silver（前端零自动化测试 / 无 CI / 性能与可观测未量化）→ **不面向商业生产**，适合**内测 / 批 2 迭代**。
4. **真机项待验**（GUI 渲染 / 时延 / 点色生效）—— 不含糊为「已通过」。

**复验清单：**
- [x] **D-B1-01 / AC-32**：删除改「软删 + 3s 撤销条」→ 复验通过。
- [x] **D-B1-02 / AC-53**：浅色 + 深色 + hover 可达态对比度 ≥ 目标 → 复算通过。
- [x] **AC-54**：四语义色消费者存在（`--color-warn` 0→2）→ 静态通过。
- [x] **保真**：`applyAccents` 默认不派生 → 通过。
- [ ] **真机验收**：见 §10 清单。

---

## 附录 A：验证命令速查

```bash
# 后端（必须 -j 2）
cd src-tauri && cargo fmt --check && cargo clippy -j 2 --all-targets
cd src-tauri && cargo test -j 2                        # 122 passed, EXIT=0
# 前端
cd timing && npx tsc --noEmit && npm run build                # EXIT=0 / 2011 modules
# P0 门禁（emoji）
grep -rP '[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}\x{FE0F}\x{1F000}-\x{1F64F}\x{1F680}-\x{1F6FF}\x{1FA00}-\x{1FAFF}\x{2713}\x{2714}\x{26A0}\x{274C}]' src index.html   # 0 命中
# 紫粉渐变 / 弹跳缓动
grep -rniE '7C3AED|A855F7|EC4899|purple.*pink' src index.html   # 0 命中
grep -rniE 'bounce|elastic|spring|overshoot|ease-back' src/styles   # 0 命中
# AC-54 消费者存在性
grep -rn 'var(--color-' src/                                    # 四令牌均有引用
# AC-53 对比度（QA 独立脚本）
node <QA 自建脚本>   # 见 QA-V0.2.0-BATCH1-REVERIFY.md §2.2
```

## 附录 B：核验方法备注
- 契约计数：脚本解析 `IpcApi` / `ipc.ts` / `lib.rs::generate_handler!` / `error.rs` 错误码。
- 行数：`wc -l` 原始行。
- 对比度：严格 WCAG 2.1 相对亮度公式（QA **自写独立脚本**复算，设计 `_ac53_selfcheck.mjs` 仅作交叉印证）。
- AC-54：以 `grep -rn "var(--color-" src/` 的**静态消费者证据**判定，边界（真机点色/可达性）明示，不含糊为「通过」。
- 无 git 仓库：完整性以「首轮记录基线 vs 当前」替代 diff；复验波 QA 非业务改动为**零**。
