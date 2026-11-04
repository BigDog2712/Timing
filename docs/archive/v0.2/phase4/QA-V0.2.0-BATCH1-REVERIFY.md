# QA 复验小结 — Timing V0.2.0 批 1（定向复验 · AC-32 / AC-53 / AC-54 + 保真）

- 文档 ID：`docs/phase4/QA-V0.2.0-BATCH1-REVERIFY.md`
- 验证人：严过关（测试工程师，mvp-dev-expert-team-qa）
- 日期：2026-10-16
- 复验对象：批 1 回归 QA 判「不通过/误判」的 **3 条 P0 级 AC** + 1 项像素保真，经 team-lead 深挖修复后
- 权威依据：`docs/Spec-V0.2.0.md` §9（含新增口径修订块）/ §10 / §13；`docs/phase1/PRD-V0.2.0.md` §4（AC-28~64 EARS）
- 上游报告：`docs/phase4/QA-REPORT-V0.2.0-BATCH1.md`（本复验后**已同步更新**）
- 知识库引用：`01-standards/` 下 `test-discipline.md`（定向复验/回归率）、`test-integrity-anti-gaming.md`（断言未弱化）、`verifier-critic-pattern.md`（解耦 + 结构化 verdict）、`generated-code-failure-modes.md`（消费者存在性 = 幻觉接口反面）、`production-readiness-scorecard.md`
- 环境：Windows / node v22.22.2 / cargo 1.99.0（**必须 `-j 2`**，否则编 `tokio-stream` ICE）

---

## 0. 一句话结论

**复验通过（pass）。** 上轮判「不通过」的 AC-32、判「部分通过」的 AC-53、以及上轮**误判通过**的 AC-54 三条 P0 级 AC，本轮均以**可复现的独立证据**判为**通过**；机械门禁全绿、后端 122 测试零失败、V0.1.0 **零回归**、测试完整性反作弊通过。**P0 缺陷归零。** 生产就绪档仍为 **Bronze**（短板为前端零自动化测试 / 无 CI，未达 Silver），故**通过复验 ≠ 可上商业生产**；真机项（GUI 渲染 / 300ms 时延 / 点色生效）明标**待真机**。

---

## 1. 复验结论表（3 条目标 AC + 保真）

| 目标 | 上轮判定 | **本轮复验判定** | 关键证据（本轮独立复跑） |
|---|---|---|---|
| **AC-32** 删除待办须提供短时 undo、禁阻塞确认 | ❌ 不通过 | **✅ 通过（改判）** | ① 无阻塞确认：`PendingRowMode='view'\|'edit'`（`TodosPendingRow.tsx:24`），`onDelete` 直达；`InlineConfirmBar` 仅剩 **事项** 删除用（`TodosRecordRow.tsx`），待办删除已移除确认态。② 3s 窗：`UNDO_WINDOW_MS=3000`（`domain.ts:62`）→ `remove()` 起窗。③ 撤销不调后端：`undoRemove()` 仅本地 `restore`。④ 超时/隐藏/退出落库：`setTimeout`（`todoStore.ts:147-149`）+ `useTodoDeleteFlush`（beforeunload / visibilitychange=hidden，挂载于 `TodosWindow.tsx:26`）。⑤ 连续删除只留最后一条：`remove()` 先 `commitPending()` 再置新 pending。⑥ 后端待办域**仍 5 命令**，无 `todo_restore`（`lib.rs:71-75`）。 |
| **AC-53** WCAG 2.1 AA（正文 ≥4.5 / 非文本 ≥3） | ⚠️ 部分通过 | **✅ 通过（改判）** | QA **独立复算**（自写脚本，不复用设计脚本）：浅色 ink-4 `#656E7D`=**4.636** / warn `#A05E00`=**4.618** / danger `#D02C33`=**4.624** / ok `#0C7E47`=**4.623**（均对最坏底 `--bg-plate #F2F3F5`）；深色 ink-4=4.961 / warn=8.887 / danger=4.897 / ok=8.652；**深色 `--danger-solid #E1292F` + 白字 = 4.606**（旧 `#E5484D` 仅 3.914，陷阱已修）；hover 可达态（`menu.css` 危险项文字回退 `--ink`）：深 15.52 / 浅 13.38，图标 4.40 / 3.87（≥3）。旧值对照：浅色四色 3.908–4.337（**<4.5**，证明修复前确不达标）。 |
| **AC-54** 四语义色「持久化 + 即时应用」 | ✅ 通过（**上轮误判**：只验了注入，漏验消费者） | **✅ 通过（静态证据充分；真机点色待验）** | `grep -rn "var(--color-" src/` 逐条确认**四个 `--color-*` 均有真实组件消费者**：`--color-running`→`.ring/.dot[data-state=running]`（药丸条色环/收起点）；`--color-done`→`.ring/.dot[data-state=ended]`；`--color-bar`→`--pill-bg`→`.pill` 底；**`--color-warn`（上轮 0 消费者）→ `--todo-overdue`（`design-tokens.css:362`）→ `.todo-pend[data-tone=overdue]` 文字（`todos-pending.css:108,127`）+ 提醒铃 `.todo-row__bell/.todo-pend__bell`（`todos-panel.css:147`）**，消费者 **0→2**。 |
| **保真**：默认态不得派生（出厂像素 = 审计值） | 新发现 | **✅ 通过** | `lib/theme.ts::applyAccents`：`值 == 出厂默认（isFactoryDefault）→ style.removeProperty()` 回落分主题令牌（`theme.ts:158-161`）；仅非默认值才派生写入。`DEFAULT_ACCENTS` 与设置默认同源（`theme.ts:34-39`）。 |

---

## 2. 关键复验证据（可复现）

### 2.1 AC-32 删除撤销链路（源码级逐条）

- 触发：`TodosTodoSection` → `onDelete(id)` → `TodosPanel.tsx:204` `todosActions.remove(id)` → `todoStore.remove()`（乐观删除，**同步**从列表移除，不 await 后端）。
- 撤销：`TodoUndoBar`（`TodosPanel.tsx:218` 常挂）读 `pendingDelete`，点「撤销」→ `undoRemove()`（**纯本地**，无 IPC）。
- 落库：`commitPending()` → `ipc.todoDelete`；失败回滚 + `commitError` 提示（4s 自消，`TodosPanel.tsx:86-90`）。
- 兜底提交：`useTodoDeleteFlush` 监听 `beforeunload` / `visibilitychange(hidden)`；**有意不监听窗口失焦**（注释说明：失焦即提交会收窄撤销窗，反而削弱 AC-32）。
- 契约：`lib.rs` 待办命令 = `todo_create/update/delete/list/toggle` 5 个，无 `todo_restore`（守 Spec §5 五命令锁）。

### 2.2 AC-53 对比度复算（QA 独立脚本，非设计脚本）

```
浅色 (对最坏底 --bg-plate #F2F3F5, 目标 4.5):
  ink-4 #656E7D = 4.636 PASS   warn #A05E00 = 4.618 PASS
  danger #D02C33 = 4.624 PASS  ok   #0C7E47 = 4.623 PASS
深色 (对 --bg-plate #0E0F12):
  ink-4 #7A8292 = 4.961  warn #E8A33D = 8.887  danger #E5484D = 4.897  ok #4CC38A = 8.652
实心 danger + 白字:
  dark  #FFFFFF on #E1292F = 4.606 PASS   light #FFFFFF on #D02C33 = 5.134 PASS
  [旧陷阱] #FFFFFF on #E5484D = 3.914 FAIL  ← 深色实心 danger 白字确曾不达标
hover 可达态 (menu.css data-danger:hover, danger-wash 12% 叠 plate):
  dark  text --ink on #281619 = 15.516 PASS ; icon --danger = 4.402 PASS(>=3)
  light text --ink on #EEDBDE = 13.381 PASS ; icon --danger = 3.869 PASS(>=3)
  [旧方案] danger 文字压 wash: light 3.869 / dark 4.402  ← 均 <4.5，证明「回退 --ink」修复必要
hover 纯图标按钮 (todos-pending.css .todo-pend__act--danger:hover，非文本门槛 3:1):
  dark icon --danger on #281619 = 4.402 PASS ; light icon --danger on #EEDBDE = 3.869 PASS
旧浅色值对照 (证明修复前 <4.5): ink-4 3.908 / warn 4.308 / danger 4.326 / ok 4.337
```

- 设计侧自检脚本 `docs/design/_ac53_selfcheck.mjs` 亦 **PASS**（三份令牌文件一致 + JSON 对齐 + 出厂像素审计 + 保色相 H 不变）——QA **仅作交叉印证，不作为唯一依据**（`test-integrity-anti-gaming.md`：不采信生产者自证脚本）。

### 2.3 AC-54 消费者链（`grep -rn "var(--color-" src/`）

| 令牌 | 定义（`design-tokens.css`） | **真实消费者（组件 CSS）** | 作用面 |
|---|---|---|---|
| `--color-running` | `var(--accent)` (:294) | `.ring[data-state=running]`（`surfaces.css:124-125`）、`.dot[data-state=running]`(:183) | **药丸条** 色环 / 收起点 |
| `--color-done` | `var(--ok)` (:296) | `.ring[data-state=ended]`(:134-135)、`.dot[data-state=ended]`(:191) | **药丸条** |
| `--color-bar` | `var(--bg-plate)` (:297) | `--pill-bg`(:305) → `.pill background`（`surfaces.css:21`）+ `--pill-hover-plate`(:307) | **药丸条** 底色 |
| `--color-warn` | `var(--warn)` (:295) | `--todo-overdue`(:362) → `.todo-pend[data-tone=overdue]` 文字（`todos-pending.css:108,127`）+ `.todo-row__bell/.todo-pend__bell`（`todos-panel.css:147`） | **事项窗口** 逾期文字 / 提醒铃 |

> **验证边界（必须明示）**：以上为**静态证据**（消费者存在），**不等于真机点色已验**。两点残余边界：
> 1. **真机点色未验**：无头环境无法打开设置页点色并观测像素变化 → 标「待真机」。
> 2. **`--color-warn` 两处消费者均条件渲染**：提醒铃需 `remind_at ≠ null`、逾期文字需 `planned_at < now`；而 **批 1 UI 无任何入口设置 `planned_at` / `remind_at`**（撰写待办仅传 title，`TodosPanel.tsx:205`；提醒输入属批 2），无 seed 待办（`0002_v020.sql` 无 `INSERT INTO todos`）。⇒ 批 1 常规流程下「改提醒色」**可能无可见像素变化**；建议真机验证时先经批 2 入口或直接注入带计划的待办。此为**可达性边界**，非 AC-54 违反（AC-54 只要求「至少作用于药丸条与事项窗口的状态表达」，该映射已完整）。

---

## 3. 机械门禁复跑（真实退出码）

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `cargo fmt --check` | **0** | 无 diff |
| `cargo clippy -j 2 --all-targets` | **0** | **0 warning**（touch 触发重编后计数） |
| `cargo test -j 2` | **0** | `122 passed; 0 failed; 0 ignored` |
| `npx tsc --noEmit` | **0** | 无类型错误 |
| `npm run build` | **0** | 2011 modules；js 317.13 kB(gzip 97.35) / css 46.36 kB(gzip 8.91) |
| emoji 全扫（src+index.html） | 0 命中 | 含 `FE0F/1F000-1F64F/1F680-1F6FF/1FA00-1FAFF/2713/2714/26A0/274C` |
| 紫粉渐变 | 0 命中 | — |
| 组件 CSS 裸色值 | 0 命中 | 仅 `design-tokens(.compat).css` 承载字面量 |
| 弹跳缓动 | 0 命中 | 仅 3 条标准 `cubic-bezier`，无 overshoot |
| 单文件 ≤300 | ⚠️ 3 个例外 | `types/domain.ts` 596（类型数据）/ `tests/timer.rs` 494（既有测试）/ `design-tokens.css` 432（令牌数据）→ P2 记录 |

---

## 4. 回归与测试完整性

- **回归率 = 0**：122 用例（12 文件）全绿；V0.1.0 基线 5 文件 68 例（27/11/11/9/10）逐一存活。
- **测试完整性反作弊**：断言总数 `assert!/assert_eq!/assert_ne!` = **321（与上轮一致，未弱化）**；`#[ignore]/skip/only/xfail` **0 命中**；12 测试文件、122 test 宏均在；`package.json` scripts 未变（无阈值可降）。**本波 QA 未改任何业务源码**（仅读 + 复跑）。
- 无 git 仓库 → 以「上轮记录基线 vs 当前实测」替代 diff（同前）。

---

## 5. 生产就绪（7 维 × 3 档）与总结论

| 维度 | 上轮 | **本轮** | 变化说明 |
|---|---|---|---|
| 测试 + 回归 | Bronze | **Bronze** | 后端 122 绿 / 回归 0；仍**无前端自动化测试、无 CI** → 距 Silver 缺此项 |
| 契约 | Silver | **Silver** | 不变 |
| 安全 | Silver | **Silver** | 不变 |
| 无障碍 | Bronze | **Bronze（对比度已达标）** | AC-53 修复后对比度**已达 AA**；距 Silver 仅差「自动扫描 0 阻断 / 屏读走查」 |
| 性能 | Bronze | **Bronze** | 未实测（真机项） |
| 可观测 | Bronze | **Bronze** | 不变 |
| 发布安全 | Bronze | **Bronze** | 不变 |
| **总档（取最低）** | Bronze | **Bronze** | 未达 Silver ⇒ **不交付商业生产** |

**总结论：复验通过（pass）—— P0 归零、回归归零、门禁全绿；批 1 由上轮「fail（有条件放行）」转为「通过（含真机待验项）」。生产就绪仍 Bronze，面向内测/迭代，非商业上线。**

### 复验清单勾选

- [x] **AC-32**：删除待办改「直接软删 + 3s 撤销条」，无阻塞确认、撤销不落库、超时/隐藏/退出落库、后端仍 5 命令 → **通过**
- [x] **AC-53**：浅色四色 + 深色 `--danger-solid` + hover 可达态复算全 ≥ 目标 → **通过**
- [x] **AC-54**：四语义色均有真实消费者，`--color-warn` 0→2 → **通过（静态；真机点色待验）**
- [x] **保真**：`applyAccents` 默认态不写内联 → **通过**
- [ ] **真机待验**：AC-01 启动即见药丸 / AC-34 面板 300ms / AC-35 灰度四态 / AC-37 铃铛可触发 / AC-51 各窗无白闪 / AC-54 点色即时生效
